import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ZodError, z } from "zod";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createCaptureSchema } from "./capture-schema.js";
import { extractTextRequestSchema } from "./extract-schema.js";
import {
  hashRequestBody,
  InMemoryIdempotencyStore,
  routeKeyConfirm,
  routeKeyMove,
  routeKeyUndo,
  runWithIdempotency,
  type IdempotencyStore
} from "./idempotency.js";
import { InMemoryNoteRepository, type NoteRepository } from "./note-repository.js";
import { renameCollectionSchema, updateEntrySchema } from "./entry-mutation-schemas.js";
import { confirmBodySchema, moveBodySchema, undoBodySchema } from "./placement-mutation-schemas.js";
import { suggestionsRequestSchema } from "./suggestion-schema.js";
import { SuggestionService, type SuggestionServiceOptions } from "./suggestion-service.js";
import { extractTextWithOpenAI, OpenAINotConfiguredError } from "./openai-extract.js";
import { LabService } from "./lab.js";
import { TelemetryStore, type TelemetryEvent } from "./telemetry.js";

function toErrorBody(code: string, message: string, details?: Record<string, unknown>) {
  return {
    error: {
      code,
      message,
      details,
      request_id: crypto.randomUUID()
    }
  };
}

function requireAuth(authorization: string | undefined): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  return token || null;
}

const idempotencyKeySchema = z.string().uuid();

function parseIdempotencyKey(request: FastifyRequest): "missing" | "invalid" | string {
  const raw = request.headers["idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return "missing";
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) return "invalid";
  return parsed.data;
}

function mapPlacementStubError(error: unknown): { status: number; body: ReturnType<typeof toErrorBody> } {
  const msg = error instanceof Error ? error.message : "UNKNOWN";
  switch (msg) {
    case "ENTRY_NOT_FOUND":
      return { status: 404, body: toErrorBody("RESOURCE_NOT_FOUND", "Entry not found") };
    case "ENTRY_NOT_DRAFT":
      return { status: 422, body: toErrorBody("VALIDATION_ERROR", "Entry must be a draft to confirm") };
    case "ENTRY_NOT_PLACED":
      return { status: 422, body: toErrorBody("VALIDATION_ERROR", "Entry must be placed to move") };
    case "COLLECTION_NOT_FOUND":
      return { status: 404, body: toErrorBody("RESOURCE_NOT_FOUND", "Collection not found") };
    case "PLACEMENT_NOT_FOUND":
      return { status: 404, body: toErrorBody("RESOURCE_NOT_FOUND", "Placement not found") };
    case "UNDO_NOT_LATEST":
      return { status: 409, body: toErrorBody("UNDO_NOT_LATEST_ACTION", "Only the latest reversible placement can be undone") };
    case "UNDO_EXPIRED":
      return { status: 409, body: toErrorBody("UNDO_WINDOW_EXPIRED", "Undo window has expired") };
    case "UNDO_UNSUPPORTED":
      return { status: 422, body: toErrorBody("VALIDATION_ERROR", "This placement cannot be undone") };
    default:
      return { status: 500, body: toErrorBody("INTERNAL_ERROR", "Unexpected server error") };
  }
}

export interface BuildAppDeps {
  noteRepository?: NoteRepository;
  idempotencyStore?: IdempotencyStore;
  suggestionOptions?: SuggestionServiceOptions;
  /** Override suggestion embeddings (tests). */
  embedBatch?: (texts: string[]) => Promise<number[][]>;
  /** Override vision OCR (tests); default uses OPENAI_API_KEY on the server. */
  extractTextFromImage?: (input: { base64: string; mimeType: string }) => Promise<string>;
}

export function buildApp(deps?: BuildAppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const storagePath = resolve(fileURLToPath(new URL("../.data/note-state.json", import.meta.url)));
  const noteRepository =
    deps?.noteRepository ?? new InMemoryNoteRepository({ persistenceFilePath: storagePath });
  const idempotencyStore = deps?.idempotencyStore ?? new InMemoryIdempotencyStore();
  const suggestionService = new SuggestionService(noteRepository, {
    ...deps?.suggestionOptions,
    ...(deps?.embedBatch ? { embedBatch: deps.embedBatch } : {})
  });
  const extractImpl = deps?.extractTextFromImage ?? extractTextWithOpenAI;
  const labService = new LabService(noteRepository);
  const telemetry = new TelemetryStore();
  const dashboardToken = process.env.DASHBOARD_TOKEN?.trim() || null;

  function track(event: { distinctId: string; event: string; properties?: Record<string, unknown> }) {
    const row: TelemetryEvent = {
      timestamp: new Date().toISOString(),
      distinct_id: event.distinctId,
      event: event.event,
      properties: event.properties ?? {}
    };
    telemetry.record(row);
  }

  function requireDashboardAccess(request: FastifyRequest): boolean {
    if (!dashboardToken) return true;
    const raw = request.headers["x-dashboard-token"];
    const provided = (Array.isArray(raw) ? raw[0] : raw) ?? "";
    return provided === dashboardToken;
  }

  app.post("/v1/extract-text", { bodyLimit: 15 * 1024 * 1024 }, async (request, reply) => {
    const userId = requireAuth(request.headers.authorization);
    if (!userId) {
      return reply.status(401).send(toErrorBody("UNAUTHORIZED", "Authentication required"));
    }

    try {
      const body = extractTextRequestSchema.parse(request.body);
      const text = await extractImpl({
        base64: body.image_base64,
        mimeType: body.mime_type
      });
      return reply.status(200).send({ text });
    } catch (error) {
      if (error instanceof ZodError) {
        const firstIssue = error.issues[0];
        return reply.status(422).send(
          toErrorBody("VALIDATION_ERROR", "Invalid request payload", {
            field: firstIssue?.path?.join("."),
            reason: firstIssue?.message
          })
        );
      }
      if (error instanceof OpenAINotConfiguredError) {
        return reply
          .status(503)
          .send(toErrorBody("SERVICE_UNAVAILABLE", "OpenAI is not configured (set OPENAI_API_KEY in backend .env)"));
      }
      if (error instanceof Error) {
        return reply.status(502).send(toErrorBody("OPENAI_ERROR", error.message));
      }
      return reply.status(500).send(toErrorBody("INTERNAL_ERROR", "Unexpected server error"));
    }
  });

  app.post("/v1/captures", async (request, reply) => {
    const userId = requireAuth(request.headers.authorization);
    if (!userId) {
      return reply.status(401).send(toErrorBody("UNAUTHORIZED", "Authentication required"));
    }

    try {
      const body = createCaptureSchema.parse(request.body);
      const entry = await noteRepository.createDraft(body, userId);
      track({
        distinctId: userId,
        event: "capture_created",
        properties: {
          entry_id: entry.id,
          type: body.type,
          text_length: body.type === "text" ? body.content.text.length : 0,
          has_image_context: body.type === "text" ? Boolean(body.content.image_context) : false
        }
      });
      return reply.status(201).send({ entry });
    } catch (error) {
      if (error instanceof ZodError) {
        const firstIssue = error.issues[0];
        return reply.status(422).send(
          toErrorBody("VALIDATION_ERROR", "Invalid request payload", {
            field: firstIssue?.path?.join("."),
            reason: firstIssue?.message
          })
        );
      }

      return reply.status(500).send(toErrorBody("INTERNAL_ERROR", "Unexpected server error"));
    }
  });

  app.post<{ Params: { entryId: string } }>("/v1/captures/:entryId/suggestions", async (request, reply) => {
    const userId = requireAuth(request.headers.authorization);
    if (!userId) {
      return reply.status(401).send(toErrorBody("UNAUTHORIZED", "Authentication required"));
    }

    try {
      const access = await noteRepository.getEntryAccess(userId, request.params.entryId);
      if (access.status === "not_found") {
        return reply.status(404).send(toErrorBody("RESOURCE_NOT_FOUND", "Entry not found"));
      }
      if (access.status === "forbidden") {
        return reply.status(403).send(toErrorBody("FORBIDDEN", "You cannot access this entry"));
      }

      const body = suggestionsRequestSchema.parse(request.body ?? {});
      const started = Date.now();
      track({
        distinctId: userId,
        event: "suggestions_requested",
        properties: {
          entry_id: request.params.entryId,
          has_recent_hints: Boolean(body.hints?.recent_collection_ids?.length)
        }
      });
      const payload = await suggestionService.buildSuggestions(userId, request.params.entryId, body);
      track({
        distinctId: userId,
        event: "suggestions_succeeded",
        properties: {
          entry_id: request.params.entryId,
          source: payload.source,
          confidence_score: payload.confidence.score,
          confidence_label: payload.confidence.label,
          top_kind: payload.top_option.kind,
          top_score: payload.top_option.score,
          alternatives_count: payload.alternatives.length,
          latency_ms: Date.now() - started
        }
      });
      return reply.status(200).send(payload);
    } catch (error) {
      if (error instanceof ZodError) {
        const firstIssue = error.issues[0];
        return reply.status(422).send(
          toErrorBody("VALIDATION_ERROR", "Invalid request payload", {
            field: firstIssue?.path?.join("."),
            reason: firstIssue?.message
          })
        );
      }
      return reply.status(500).send(toErrorBody("INTERNAL_ERROR", "Unexpected server error"));
    }
  });

  app.get("/v1/collections", async (request, reply) => {
    const userId = requireAuth(request.headers.authorization);
    if (!userId) {
      return reply.status(401).send(toErrorBody("UNAUTHORIZED", "Authentication required"));
    }

    try {
      const collections = await noteRepository.listCollections(userId);
      const withCounts = await Promise.all(
        collections.map(async (collection) => {
          const entries = await noteRepository.listCollectionEntries(userId, collection.id);
          return { ...collection, note_count: entries.length };
        })
      );
      return reply.status(200).send({ collections: withCounts });
    } catch {
      return reply.status(500).send(toErrorBody("INTERNAL_ERROR", "Unexpected server error"));
    }
  });

  app.get<{ Params: { collectionId: string } }>("/v1/collections/:collectionId/entries", async (request, reply) => {
    const userId = requireAuth(request.headers.authorization);
    if (!userId) {
      return reply.status(401).send(toErrorBody("UNAUTHORIZED", "Authentication required"));
    }

    try {
      const collections = await noteRepository.listCollections(userId);
      const target = collections.find((c) => c.id === request.params.collectionId);
      if (!target) {
        return reply.status(404).send(toErrorBody("RESOURCE_NOT_FOUND", "Collection not found"));
      }
      const entries = await noteRepository.listCollectionEntries(userId, request.params.collectionId);
      return reply.status(200).send({ collection: target, entries });
    } catch {
      return reply.status(500).send(toErrorBody("INTERNAL_ERROR", "Unexpected server error"));
    }
  });

  app.post<{ Params: { entryId: string } }>("/v1/captures/:entryId/confirm", async (request, reply) => {
    const userId = requireAuth(request.headers.authorization);
    if (!userId) {
      return reply.status(401).send(toErrorBody("UNAUTHORIZED", "Authentication required"));
    }

    const keyState = parseIdempotencyKey(request);
    if (keyState === "missing") {
      return reply.status(400).send(toErrorBody("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required"));
    }
    if (keyState === "invalid") {
      return reply.status(422).send(toErrorBody("VALIDATION_ERROR", "Idempotency-Key must be a UUID"));
    }

    let parsedBody: unknown = request.body;
    try {
      parsedBody = confirmBodySchema.parse(request.body);
    } catch (error) {
      if (error instanceof ZodError) {
        const firstIssue = error.issues[0];
        return reply.status(422).send(
          toErrorBody("VALIDATION_ERROR", "Invalid request payload", {
            field: firstIssue?.path?.join("."),
            reason: firstIssue?.message
          })
        );
      }
      throw error;
    }

    const entryId = request.params.entryId;
    const routeKey = routeKeyConfirm(entryId);
    const outcome = await runWithIdempotency({
      store: idempotencyStore,
      userId,
      routeKey,
      idempotencyKey: keyState,
      requestBody: parsedBody,
      execute: async () => {
        const access = await noteRepository.getEntryAccess(userId, entryId);
        if (access.status === "not_found") {
          return { statusCode: 404, body: toErrorBody("RESOURCE_NOT_FOUND", "Entry not found") };
        }
        if (access.status === "forbidden") {
          return { statusCode: 403, body: toErrorBody("FORBIDDEN", "You cannot access this entry") };
        }
        try {
          const body = confirmBodySchema.parse(parsedBody);
          const result = await noteRepository.confirmPlacementStub(userId, entryId, body.selection);
          let selectedCollectionNoteCount: number | null = null;
          if (body.selection.kind === "collection") {
            const entries = await noteRepository.listCollectionEntries(userId, body.selection.collection_id);
            selectedCollectionNoteCount = entries.length;
          }
          track({
            distinctId: userId,
            event: "placement_confirmed",
            properties: {
              entry_id: entryId,
              selected_kind: body.selection.kind,
              selected_collection_id: body.selection.kind === "collection" ? body.selection.collection_id : null,
              selected_collection_note_count: selectedCollectionNoteCount,
              created_collection_name:
                body.selection.kind === "create_new" ? body.selection.new_collection_name : null
            }
          });
          return { statusCode: 200, body: result };
        } catch (error) {
          const mapped = mapPlacementStubError(error);
          return { statusCode: mapped.status, body: mapped.body };
        }
      }
    });

    if (outcome.kind === "mismatch") {
      return reply.status(409).send(
        toErrorBody("IDEMPOTENCY_REPLAY_MISMATCH", "Idempotency key was reused with a different request body", {
          expected_request_hash: idempotencyStore.get(userId, routeKey, keyState)?.requestHash,
          actual_request_hash: hashRequestBody(parsedBody)
        })
      );
    }

    return reply.status(outcome.statusCode).send(outcome.body);
  });

  app.post<{ Params: { entryId: string } }>("/v1/entries/:entryId/move", async (request, reply) => {
    const userId = requireAuth(request.headers.authorization);
    if (!userId) {
      return reply.status(401).send(toErrorBody("UNAUTHORIZED", "Authentication required"));
    }

    const keyState = parseIdempotencyKey(request);
    if (keyState === "missing") {
      return reply.status(400).send(toErrorBody("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required"));
    }
    if (keyState === "invalid") {
      return reply.status(422).send(toErrorBody("VALIDATION_ERROR", "Idempotency-Key must be a UUID"));
    }

    let parsedBody: unknown = request.body;
    try {
      parsedBody = moveBodySchema.parse(request.body);
    } catch (error) {
      if (error instanceof ZodError) {
        const firstIssue = error.issues[0];
        return reply.status(422).send(
          toErrorBody("VALIDATION_ERROR", "Invalid request payload", {
            field: firstIssue?.path?.join("."),
            reason: firstIssue?.message
          })
        );
      }
      throw error;
    }

    const entryId = request.params.entryId;
    const routeKey = routeKeyMove(entryId);
    const outcome = await runWithIdempotency({
      store: idempotencyStore,
      userId,
      routeKey,
      idempotencyKey: keyState,
      requestBody: parsedBody,
      execute: async () => {
        const access = await noteRepository.getEntryAccess(userId, entryId);
        if (access.status === "not_found") {
          return { statusCode: 404, body: toErrorBody("RESOURCE_NOT_FOUND", "Entry not found") };
        }
        if (access.status === "forbidden") {
          return { statusCode: 403, body: toErrorBody("FORBIDDEN", "You cannot access this entry") };
        }
        try {
          const body = moveBodySchema.parse(parsedBody);
          const result = await noteRepository.moveEntryStub(userId, entryId, body.target);
          return { statusCode: 200, body: result };
        } catch (error) {
          const mapped = mapPlacementStubError(error);
          return { statusCode: mapped.status, body: mapped.body };
        }
      }
    });

    if (outcome.kind === "mismatch") {
      return reply.status(409).send(
        toErrorBody("IDEMPOTENCY_REPLAY_MISMATCH", "Idempotency key was reused with a different request body", {
          expected_request_hash: idempotencyStore.get(userId, routeKey, keyState)?.requestHash,
          actual_request_hash: hashRequestBody(parsedBody)
        })
      );
    }

    return reply.status(outcome.statusCode).send(outcome.body);
  });

  app.post<{ Params: { placementId: string } }>("/v1/placements/:placementId/undo", async (request, reply) => {
    const userId = requireAuth(request.headers.authorization);
    if (!userId) {
      return reply.status(401).send(toErrorBody("UNAUTHORIZED", "Authentication required"));
    }

    const keyState = parseIdempotencyKey(request);
    if (keyState === "missing") {
      return reply.status(400).send(toErrorBody("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required"));
    }
    if (keyState === "invalid") {
      return reply.status(422).send(toErrorBody("VALIDATION_ERROR", "Idempotency-Key must be a UUID"));
    }

    let parsedBody: unknown;
    try {
      parsedBody = undoBodySchema.parse(request.body ?? {});
    } catch (error) {
      if (error instanceof ZodError) {
        const firstIssue = error.issues[0];
        return reply.status(422).send(
          toErrorBody("VALIDATION_ERROR", "Invalid request payload", {
            field: firstIssue?.path?.join("."),
            reason: firstIssue?.message
          })
        );
      }
      throw error;
    }

    const routeKey = routeKeyUndo(request.params.placementId);
    const outcome = await runWithIdempotency({
      store: idempotencyStore,
      userId,
      routeKey,
      idempotencyKey: keyState,
      requestBody: parsedBody,
      execute: async () => {
        try {
          const result = await noteRepository.undoPlacementStub(userId, request.params.placementId);
          return { statusCode: 200, body: result };
        } catch (error) {
          const mapped = mapPlacementStubError(error);
          return { statusCode: mapped.status, body: mapped.body };
        }
      }
    });

    if (outcome.kind === "mismatch") {
      return reply.status(409).send(
        toErrorBody("IDEMPOTENCY_REPLAY_MISMATCH", "Idempotency key was reused with a different request body", {
          expected_request_hash: idempotencyStore.get(userId, routeKey, keyState)?.requestHash,
          actual_request_hash: hashRequestBody(parsedBody)
        })
      );
    }

    return reply.status(outcome.statusCode).send(outcome.body);
  });

  app.patch<{ Params: { entryId: string } }>("/v1/entries/:entryId", async (request, reply) => {
    const userId = requireAuth(request.headers.authorization);
    if (!userId) {
      return reply.status(401).send(toErrorBody("UNAUTHORIZED", "Authentication required"));
    }

    try {
      const body = updateEntrySchema.parse(request.body);
      const entry = await noteRepository.updateEntryText(userId, request.params.entryId, body.content.text);
      return reply.status(200).send({ entry });
    } catch (error) {
      if (error instanceof ZodError) {
        const firstIssue = error.issues[0];
        return reply.status(422).send(
          toErrorBody("VALIDATION_ERROR", "Invalid request payload", {
            field: firstIssue?.path?.join("."),
            reason: firstIssue?.message
          })
        );
      }
      if (error instanceof Error && error.message === "ENTRY_NOT_FOUND") {
        return reply.status(404).send(toErrorBody("RESOURCE_NOT_FOUND", "Entry not found"));
      }
      return reply.status(500).send(toErrorBody("INTERNAL_ERROR", "Unexpected server error"));
    }
  });

  app.patch<{ Params: { collectionId: string } }>("/v1/collections/:collectionId", async (request, reply) => {
    const userId = requireAuth(request.headers.authorization);
    if (!userId) {
      return reply.status(401).send(toErrorBody("UNAUTHORIZED", "Authentication required"));
    }

    try {
      const body = renameCollectionSchema.parse(request.body);
      const collection = await noteRepository.renameCollection(userId, request.params.collectionId, body.name);
      return reply.status(200).send({ collection });
    } catch (error) {
      if (error instanceof ZodError) {
        const firstIssue = error.issues[0];
        return reply.status(422).send(
          toErrorBody("VALIDATION_ERROR", "Invalid request payload", {
            field: firstIssue?.path?.join("."),
            reason: firstIssue?.message
          })
        );
      }
      if (error instanceof Error && error.message === "COLLECTION_NOT_FOUND") {
        return reply.status(404).send(toErrorBody("RESOURCE_NOT_FOUND", "Collection not found"));
      }
      return reply.status(500).send(toErrorBody("INTERNAL_ERROR", "Unexpected server error"));
    }
  });

  app.delete<{ Params: { entryId: string } }>("/v1/entries/:entryId", async (request, reply) => {
    const userId = requireAuth(request.headers.authorization);
    if (!userId) {
      return reply.status(401).send(toErrorBody("UNAUTHORIZED", "Authentication required"));
    }
    try {
      await noteRepository.deleteEntry(userId, request.params.entryId);
      return reply.status(204).send();
    } catch (error) {
      if (error instanceof Error && error.message === "ENTRY_NOT_FOUND") {
        return reply.status(404).send(toErrorBody("RESOURCE_NOT_FOUND", "Entry not found"));
      }
      return reply.status(500).send(toErrorBody("INTERNAL_ERROR", "Unexpected server error"));
    }
  });

  app.post("/v1/lab/runs", async (request, reply) => {
    try {
      const body = z
        .object({
          tester_id: z.string().min(1).max(80).optional(),
          algorithm_version: z.string().min(1).max(120).optional(),
          dataset_source: z.enum(["default_fixture", "prompt_generated"]).optional()
        })
        .parse(request.body ?? {});
      const run = labService.createRun(body);
      return reply.status(201).send({ run });
    } catch (error) {
      if (error instanceof ZodError) {
        const firstIssue = error.issues[0];
        return reply.status(422).send(
          toErrorBody("VALIDATION_ERROR", "Invalid request payload", {
            field: firstIssue?.path?.join("."),
            reason: firstIssue?.message
          })
        );
      }
      const mapped = LabService.mapError(error);
      return reply.status(mapped.status).send(toErrorBody(mapped.code, mapped.message));
    }
  });

  app.get("/v1/lab/runs", async (request, reply) => {
    try {
      const runs = labService.listRuns();
      return reply.status(200).send({ runs });
    } catch (error) {
      const mapped = LabService.mapError(error);
      return reply.status(mapped.status).send(toErrorBody(mapped.code, mapped.message));
    }
  });

  app.post<{ Params: { runId: string } }>("/v1/lab/runs/:runId/datasets/default", async (request, reply) => {
    return reply.status(410).send(
      toErrorBody(
        "LAB_GENERATION_DISABLED",
        "Synthetic dataset generation is disabled. Use manual bucket and note entry in the dashboard."
      )
    );
  });

  app.post<{ Params: { runId: string } }>("/v1/lab/runs/:runId/datasets/generate", async (request, reply) => {
    return reply.status(410).send(
      toErrorBody(
        "LAB_GENERATION_DISABLED",
        "Synthetic dataset generation is disabled. Use manual bucket and note entry in the dashboard."
      )
    );
  });

  app.post<{ Params: { runId: string } }>("/v1/lab/runs/:runId/capture-test", async (request, reply) => {
    try {
      const body = z
        .object({
          capture_text: z.string().min(1).max(5000),
          hints: suggestionsRequestSchema.shape.hints.optional()
        })
        .parse(request.body ?? {});
      const trace = await labService.runCaptureTest(request.params.runId, body);
      return reply.status(200).send({ trace });
    } catch (error) {
      if (error instanceof ZodError) {
        const firstIssue = error.issues[0];
        return reply.status(422).send(
          toErrorBody("VALIDATION_ERROR", "Invalid request payload", {
            field: firstIssue?.path?.join("."),
            reason: firstIssue?.message
          })
        );
      }
      const mapped = LabService.mapError(error);
      return reply.status(mapped.status).send(toErrorBody(mapped.code, mapped.message));
    }
  });

  app.post<{ Params: { runId: string } }>("/v1/lab/runs/:runId/decisions", async (request, reply) => {
    try {
      const body = z
        .object({
          trace_id: z.string().min(1),
          selected_kind: z.enum(["collection", "create_new"]),
          selected_collection_id: z.string().min(1).nullable().optional(),
          selected_collection_note_count: z.number().int().min(0).nullable().optional(),
          selected_rank: z.number().int().positive().nullable().optional(),
          expected_collection_id: z.string().min(1).nullable().optional(),
          failure_reason: z.string().max(120).nullable().optional()
        })
        .parse(request.body ?? {});
      const decision = await labService.submitDecision(request.params.runId, {
        trace_id: body.trace_id,
        selected_kind: body.selected_kind,
        selected_collection_id: body.selected_collection_id ?? null,
        selected_collection_note_count: body.selected_collection_note_count ?? null,
        selected_rank: body.selected_rank ?? null,
        expected_collection_id: body.expected_collection_id ?? null,
        failure_reason: body.failure_reason ?? null
      });
      return reply.status(201).send({ decision });
    } catch (error) {
      if (error instanceof ZodError) {
        const firstIssue = error.issues[0];
        return reply.status(422).send(
          toErrorBody("VALIDATION_ERROR", "Invalid request payload", {
            field: firstIssue?.path?.join("."),
            reason: firstIssue?.message
          })
        );
      }
      const mapped = LabService.mapError(error);
      return reply.status(mapped.status).send(toErrorBody(mapped.code, mapped.message));
    }
  });

  app.get<{ Params: { runId: string } }>("/v1/lab/runs/:runId/metrics", async (request, reply) => {
    try {
      const run = labService.getRun(request.params.runId);
      if (!run) {
        return reply.status(404).send(toErrorBody("RUN_NOT_FOUND", "Run not found"));
      }
      const metrics = labService.getMetrics(request.params.runId);
      return reply.status(200).send({ run, metrics });
    } catch (error) {
      const mapped = LabService.mapError(error);
      return reply.status(mapped.status).send(toErrorBody(mapped.code, mapped.message));
    }
  });

  app.get<{ Params: { runId: string } }>("/v1/lab/runs/:runId/traces", async (request, reply) => {
    try {
      const run = labService.getRun(request.params.runId);
      if (!run) {
        return reply.status(404).send(toErrorBody("RUN_NOT_FOUND", "Run not found"));
      }
      return reply.status(200).send({
        run,
        traces: labService.listTraces(request.params.runId),
        decisions: labService.listDecisions(request.params.runId),
        cases: labService.listCases(request.params.runId)
      });
    } catch (error) {
      const mapped = LabService.mapError(error);
      return reply.status(mapped.status).send(toErrorBody(mapped.code, mapped.message));
    }
  });

  app.get<{ Params: { runId: string } }>("/v1/lab/runs/:runId/state", async (request, reply) => {
    try {
      const run = labService.getRun(request.params.runId);
      if (!run) {
        return reply.status(404).send(toErrorBody("RUN_NOT_FOUND", "Run not found"));
      }
      const buckets = await labService.listBuckets(request.params.runId);
      return reply.status(200).send({
        run,
        buckets,
        cases: labService.listCases(request.params.runId)
      });
    } catch (error) {
      const mapped = LabService.mapError(error);
      return reply.status(mapped.status).send(toErrorBody(mapped.code, mapped.message));
    }
  });

  app.post<{ Params: { runId: string } }>("/v1/lab/runs/:runId/buckets", async (request, reply) => {
    try {
      const body = z.object({ name: z.string().min(1).max(120) }).parse(request.body ?? {});
      const bucket = await labService.addBucket(request.params.runId, body.name);
      return reply.status(201).send({ bucket });
    } catch (error) {
      if (error instanceof ZodError) {
        const firstIssue = error.issues[0];
        return reply.status(422).send(
          toErrorBody("VALIDATION_ERROR", "Invalid request payload", {
            field: firstIssue?.path?.join("."),
            reason: firstIssue?.message
          })
        );
      }
      const mapped = LabService.mapError(error);
      return reply.status(mapped.status).send(toErrorBody(mapped.code, mapped.message));
    }
  });

  app.post<{ Params: { runId: string } }>("/v1/lab/runs/:runId/notes", async (request, reply) => {
    try {
      const body = z
        .object({
          collection_id: z.string().min(1),
          text: z.string().min(1).max(5000)
        })
        .parse(request.body ?? {});
      const note = await labService.addNoteToBucket(request.params.runId, body);
      return reply.status(201).send({ note });
    } catch (error) {
      if (error instanceof ZodError) {
        const firstIssue = error.issues[0];
        return reply.status(422).send(
          toErrorBody("VALIDATION_ERROR", "Invalid request payload", {
            field: firstIssue?.path?.join("."),
            reason: firstIssue?.message
          })
        );
      }
      const mapped = LabService.mapError(error);
      return reply.status(mapped.status).send(toErrorBody(mapped.code, mapped.message));
    }
  });

  app.post<{ Params: { runId: string } }>("/v1/lab/runs/:runId/notes/generate", async (request, reply) => {
    return reply.status(410).send(
      toErrorBody(
        "LAB_GENERATION_DISABLED",
        "Synthetic note generation is disabled. Add notes manually in the dashboard."
      )
    );
  });

  app.get<{ Querystring: { hours?: string } }>("/v1/metrics/summary", async (request, reply) => {
    if (!requireDashboardAccess(request)) {
      return reply.status(401).send(toErrorBody("UNAUTHORIZED", "Dashboard token is invalid"));
    }
    const windowHours = z.coerce.number().int().min(1).max(24 * 30).catch(24).parse(request.query.hours);
    const summary = telemetry.getSummary(windowHours);
    return reply.status(200).send({ summary });
  });

  app.get<{ Querystring: { hours?: string; limit?: string } }>("/v1/metrics/events", async (request, reply) => {
    if (!requireDashboardAccess(request)) {
      return reply.status(401).send(toErrorBody("UNAUTHORIZED", "Dashboard token is invalid"));
    }
    const windowHours = z.coerce.number().int().min(1).max(24 * 30).catch(24).parse(request.query.hours);
    const limit = z.coerce.number().int().min(10).max(5000).catch(200).parse(request.query.limit);
    const events = telemetry.listRecentEvents(windowHours, limit);
    return reply.status(200).send({ events });
  });

  app.get<{ Querystring: { hours?: string; limit?: string } }>("/v1/metrics/production-traces", async (request, reply) => {
    if (!requireDashboardAccess(request)) {
      return reply.status(401).send(toErrorBody("UNAUTHORIZED", "Dashboard token is invalid"));
    }
    const windowHours = z.coerce.number().int().min(1).max(24 * 30).catch(24).parse(request.query.hours);
    const limit = z.coerce.number().int().min(10).max(5000).catch(200).parse(request.query.limit);
    const traces = telemetry.getProductionTraces(windowHours, limit);
    return reply.status(200).send({ traces });
  });

  app.get<{ Querystring: { hours?: string; bucket_minutes?: string } }>(
    "/v1/metrics/timeseries",
    async (request, reply) => {
      if (!requireDashboardAccess(request)) {
        return reply.status(401).send(toErrorBody("UNAUTHORIZED", "Dashboard token is invalid"));
      }
      const windowHours = z.coerce.number().int().min(1).max(24 * 30).catch(24).parse(request.query.hours);
      const bucketMinutes = z.coerce.number().int().min(5).max(24 * 60).catch(60).parse(request.query.bucket_minutes);
      const points = telemetry.getTimeseries(windowHours, bucketMinutes);
      return reply.status(200).send({ points });
    }
  );

  return app;
}
