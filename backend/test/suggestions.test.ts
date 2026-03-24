import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { InMemoryNoteRepository } from "../src/note-repository.js";

describe("POST /v1/captures/:entryId/suggestions", () => {
  it("returns 401 when auth header is missing", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/captures/ent_1/suggestions",
      payload: {}
    });
    expect(response.statusCode).toBe(401);
  });

  it("returns 404 when entry does not exist", async () => {
    const repo = new InMemoryNoteRepository();
    const app = buildApp({ noteRepository: repo });
    const response = await app.inject({
      method: "POST",
      url: "/v1/captures/ent_missing/suggestions",
      headers: { authorization: "Bearer t" },
      payload: {}
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("returns cold_start when user has no collections", async () => {
    const repo = new InMemoryNoteRepository({ seedDefaultCollections: false });
    const entry = await repo.createDraft(
      {
        type: "text",
        content: { text: "Plan Tokyo trip flights" }
      },
      "u1"
    );
    const app = buildApp({ noteRepository: repo });
    const response = await app.inject({
      method: "POST",
      url: `/v1/captures/${entry.id}/suggestions`,
      headers: { authorization: "Bearer u1" },
      payload: {}
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source).toBe("cold_start");
    expect(body.entry_id).toBe(entry.id);
    expect(body.confidence.policy_version).toBe("confidence_policy_v1");
    expect(body.top_option.kind).toBe("create_new");
    expect(body.top_option.suggested_name).toBeTruthy();
    const createNewAlts = body.alternatives.filter((a: { kind: string }) => a.kind === "create_new");
    expect(createNewAlts.length).toBeGreaterThanOrEqual(1);
    expect(createNewAlts.length).toBeLessThanOrEqual(3);
  });

  it("returns model source with collection options and confidence from policy", async () => {
    const repo = new InMemoryNoteRepository();
    const colA = repo.seedCollection("u1", { name: "Travel", last_activity_at: "2026-03-20T09:10:00Z" });
    const colB = repo.seedCollection("u1", { name: "Admin", last_activity_at: "2026-03-19T18:30:00Z" });
    const entry = await repo.createDraft({ type: "text", content: { text: "Book flights" } }, "u1");
    const app = buildApp({ noteRepository: repo });
    const response = await app.inject({
      method: "POST",
      url: `/v1/captures/${entry.id}/suggestions`,
      headers: { authorization: "Bearer u1" },
      payload: {
        hints: { recent_collection_ids: [colA, colB] }
      }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source).toBe("model");
    expect(body.top_option.kind).toBe("collection");
    expect(body.top_option.collection.id).toBe(colA);
    expect(["likely", "possible", "uncertain"]).toContain(body.confidence.label);
    expect(body.confidence.score).toBeGreaterThanOrEqual(0);
    expect(body.confidence.score).toBeLessThanOrEqual(1);
    const kinds = [body.top_option.kind, ...body.alternatives.map((a: { kind: string }) => a.kind)];
    expect(kinds).toContain("create_new");
  });

  it("returns fallback with uncertain confidence when forced", async () => {
    const repo = new InMemoryNoteRepository();
    repo.seedCollection("u1", { name: "Travel" });
    const entry = await repo.createDraft({ type: "text", content: { text: "x" } }, "u1");
    const app = buildApp({
      noteRepository: repo,
      suggestionOptions: { forceFallback: true }
    });
    const response = await app.inject({
      method: "POST",
      url: `/v1/captures/${entry.id}/suggestions`,
      headers: { authorization: "Bearer u1" },
      payload: {}
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source).toBe("fallback");
    expect(body.confidence.label).toBe("uncertain");
  });

  it("adds link-enrichment hint when text includes URLs", async () => {
    const repo = new InMemoryNoteRepository();
    repo.seedCollection("u1", { name: "Learning" });
    const entry = await repo.createDraft(
      {
        type: "text",
        content: { text: "Read this later https://example.com/react-hooks" }
      },
      "u1"
    );
    const app = buildApp({ noteRepository: repo });
    const response = await app.inject({
      method: "POST",
      url: `/v1/captures/${entry.id}/suggestions`,
      headers: { authorization: "Bearer u1" },
      payload: {}
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.reason_short).toContain("1 link");
  });

  it("returns 403 when entry belongs to another user", async () => {
    const repo = new InMemoryNoteRepository();
    const entry = await repo.createDraft({ type: "text", content: { text: "a" } }, "user_a");
    const app = buildApp({ noteRepository: repo });
    const response = await app.inject({
      method: "POST",
      url: `/v1/captures/${entry.id}/suggestions`,
      headers: { authorization: "Bearer user_b" },
      payload: {}
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
  });

  it("returns fallback when embed batch throws", async () => {
    const repo = new InMemoryNoteRepository();
    repo.seedCollection("u1", { name: "Travel" });
    const entry = await repo.createDraft({ type: "text", content: { text: "x" } }, "u1");
    const app = buildApp({
      noteRepository: repo,
      embedBatch: async () => {
        throw new Error("embed down");
      }
    });
    const response = await app.inject({
      method: "POST",
      url: `/v1/captures/${entry.id}/suggestions`,
      headers: { authorization: "Bearer u1" },
      payload: {}
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source).toBe("fallback");
    expect(body.confidence.label).toBe("uncertain");
  });

  it("ranks by injected embeddings (semantic beats order)", async () => {
    const repo = new InMemoryNoteRepository({ seedDefaultCollections: false });
    const colMatch = repo.seedCollection("u1", { name: "Match", last_activity_at: "2026-03-01T12:00:00Z" });
    const colOther = repo.seedCollection("u1", { name: "Other", last_activity_at: "2026-03-20T12:00:00Z" });
    const entry = await repo.createDraft({ type: "text", content: { text: "query text" } }, "u1");
    const basis = (i: number) => {
      const v = new Array(8).fill(0);
      v[i] = 1;
      return v;
    };
    const app = buildApp({
      noteRepository: repo,
      // listCollections is newest-first: colOther then colMatch — profiles must align.
      embedBatch: async (texts) => {
        expect(texts.length).toBe(3);
        return [basis(0), basis(1), basis(0)];
      }
    });
    const response = await app.inject({
      method: "POST",
      url: `/v1/captures/${entry.id}/suggestions`,
      headers: { authorization: "Bearer u1" },
      payload: { hints: { recent_collection_ids: [colOther, colMatch] } }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source).toBe("model");
    expect(body.top_option.kind).toBe("collection");
    expect(body.top_option.collection.id).toBe(colMatch);
    expect(body.reason_short).toContain("similarity");
  });
});
