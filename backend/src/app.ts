import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ZodError, z } from "zod";
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
import { updateEntrySchema } from "./entry-mutation-schemas.js";
import { confirmBodySchema, moveBodySchema, undoBodySchema } from "./placement-mutation-schemas.js";
import { suggestionsRequestSchema } from "./suggestion-schema.js";
import { SuggestionService, type SuggestionServiceOptions } from "./suggestion-service.js";
import { extractTextWithOpenAI, OpenAINotConfiguredError } from "./openai-extract.js";

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
  /** Override vision OCR (tests); default uses OPENAI_API_KEY on the server. */
  extractTextFromImage?: (input: { base64: string; mimeType: string }) => Promise<string>;
}

export function buildApp(deps?: BuildAppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const noteRepository = deps?.noteRepository ?? new InMemoryNoteRepository();
  const idempotencyStore = deps?.idempotencyStore ?? new InMemoryIdempotencyStore();
  const suggestionService = new SuggestionService(noteRepository, deps?.suggestionOptions);
  const extractImpl = deps?.extractTextFromImage ?? extractTextWithOpenAI;

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
      const payload = await suggestionService.buildSuggestions(userId, request.params.entryId, body);
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

  return app;
}
