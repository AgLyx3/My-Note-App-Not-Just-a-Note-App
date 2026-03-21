import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { InMemoryIdempotencyStore } from "../src/idempotency.js";
import { InMemoryNoteRepository } from "../src/note-repository.js";

describe("idempotency foundation (confirm / move / undo)", () => {
  it("returns IDEMPOTENCY_KEY_REQUIRED when confirm is missing header", async () => {
    const repo = new InMemoryNoteRepository();
    const entry = await repo.createDraft({ type: "text", content: { text: "hi" } }, "u1");
    const app = buildApp({ noteRepository: repo });
    const response = await app.inject({
      method: "POST",
      url: `/v1/captures/${entry.id}/confirm`,
      headers: { authorization: "Bearer u1" },
      payload: { selection: { kind: "create_new", new_collection_name: "Col" } }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("replays identical confirm response for same idempotency key and body", async () => {
    const repo = new InMemoryNoteRepository();
    const store = new InMemoryIdempotencyStore();
    const entry = await repo.createDraft({ type: "text", content: { text: "hi" } }, "u1");
    const app = buildApp({ noteRepository: repo, idempotencyStore: store });
    const key = "550e8400-e29b-41d4-a716-446655440000";
    const payload = { selection: { kind: "create_new", new_collection_name: "Tokyo Trip" } };
    const first = await app.inject({
      method: "POST",
      url: `/v1/captures/${entry.id}/confirm`,
      headers: { authorization: "Bearer u1", "idempotency-key": key },
      payload
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: "POST",
      url: `/v1/captures/${entry.id}/confirm`,
      headers: { authorization: "Bearer u1", "idempotency-key": key },
      payload
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
  });

  it("returns IDEMPOTENCY_REPLAY_MISMATCH when same key but different body", async () => {
    const repo = new InMemoryNoteRepository();
    const store = new InMemoryIdempotencyStore();
    const entry = await repo.createDraft({ type: "text", content: { text: "hi" } }, "u1");
    const app = buildApp({ noteRepository: repo, idempotencyStore: store });
    const key = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    await app.inject({
      method: "POST",
      url: `/v1/captures/${entry.id}/confirm`,
      headers: { authorization: "Bearer u1", "idempotency-key": key },
      payload: { selection: { kind: "create_new", new_collection_name: "A" } }
    });
    const clash = await app.inject({
      method: "POST",
      url: `/v1/captures/${entry.id}/confirm`,
      headers: { authorization: "Bearer u1", "idempotency-key": key },
      payload: { selection: { kind: "create_new", new_collection_name: "B" } }
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code).toBe("IDEMPOTENCY_REPLAY_MISMATCH");
  });

  it("scopes idempotency records per user and route", async () => {
    const repo = new InMemoryNoteRepository();
    const store = new InMemoryIdempotencyStore();
    const e1 = await repo.createDraft({ type: "text", content: { text: "a" } }, "alice");
    const e2 = await repo.createDraft({ type: "text", content: { text: "b" } }, "bob");
    const app = buildApp({ noteRepository: repo, idempotencyStore: store });
    const key = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    const body = { selection: { kind: "create_new", new_collection_name: "Same" } };
    const alice = await app.inject({
      method: "POST",
      url: `/v1/captures/${e1.id}/confirm`,
      headers: { authorization: "Bearer alice", "idempotency-key": key },
      payload: body
    });
    const bob = await app.inject({
      method: "POST",
      url: `/v1/captures/${e2.id}/confirm`,
      headers: { authorization: "Bearer bob", "idempotency-key": key },
      payload: body
    });
    expect(alice.statusCode).toBe(200);
    expect(bob.statusCode).toBe(200);
    expect(alice.json()).not.toEqual(bob.json());
  });

  it("requires idempotency key for move and undo stubs", async () => {
    const repo = new InMemoryNoteRepository();
    const entry = await repo.createDraft({ type: "text", content: { text: "hi" } }, "u1");
    const placed = await repo.confirmPlacementStub("u1", entry.id, {
      kind: "create_new",
      new_collection_name: "C1"
    });
    const app = buildApp({ noteRepository: repo });
    const moveRes = await app.inject({
      method: "POST",
      url: `/v1/entries/${entry.id}/move`,
      headers: { authorization: "Bearer u1" },
      payload: { target: { kind: "create_new", new_collection_name: "C2" } }
    });
    expect(moveRes.statusCode).toBe(400);
    expect(moveRes.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");

    const undoRes = await app.inject({
      method: "POST",
      url: `/v1/placements/${placed.placement.id}/undo`,
      headers: { authorization: "Bearer u1" },
      payload: {}
    });
    expect(undoRes.statusCode).toBe(400);
    expect(undoRes.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("replays move for same key and body", async () => {
    const repo = new InMemoryNoteRepository();
    const store = new InMemoryIdempotencyStore();
    const entry = await repo.createDraft({ type: "text", content: { text: "hi" } }, "u1");
    await repo.confirmPlacementStub("u1", entry.id, { kind: "create_new", new_collection_name: "C1" });
    const app = buildApp({ noteRepository: repo, idempotencyStore: store });
    const key = "8c9e6679-7425-40de-944b-e07fc1f90ae7";
    const payload = { target: { kind: "create_new", new_collection_name: "C2" } };
    const first = await app.inject({
      method: "POST",
      url: `/v1/entries/${entry.id}/move`,
      headers: { authorization: "Bearer u1", "idempotency-key": key },
      payload
    });
    const second = await app.inject({
      method: "POST",
      url: `/v1/entries/${entry.id}/move`,
      headers: { authorization: "Bearer u1", "idempotency-key": key },
      payload
    });
    expect(first.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
  });
});
