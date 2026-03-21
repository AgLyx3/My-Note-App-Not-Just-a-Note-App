import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { InMemoryNoteRepository } from "../src/note-repository.js";

describe("POST /v1/captures", () => {
  it("returns 401 when auth header is missing", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/captures",
      payload: {
        type: "text",
        content: { text: "hello" }
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("creates a draft text capture with 201", async () => {
    const repo = new InMemoryNoteRepository();
    const createDraft = vi.spyOn(repo, "createDraft").mockResolvedValue({
      id: "ent_1",
      type: "text" as const,
      status: "draft" as const,
      created_at: "2026-03-20T10:00:00Z"
    });

    const app = buildApp({ noteRepository: repo });

    const response = await app.inject({
      method: "POST",
      url: "/v1/captures",
      headers: {
        authorization: "Bearer test-token"
      },
      payload: {
        type: "text",
        content: { text: "Need to book flights for Tokyo" }
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      entry: {
        id: "ent_1",
        type: "text",
        status: "draft",
        created_at: "2026-03-20T10:00:00Z"
      }
    });
    expect(createDraft).toHaveBeenCalledOnce();
  });

  it("creates a draft image capture with 201", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/captures",
      headers: {
        authorization: "Bearer test-token"
      },
      payload: {
        type: "image",
        content: {
          storage_path: "screenshots/user_1/abc.png"
        }
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().entry.type).toBe("image");
  });

  it("returns 422 when image storage_path is missing", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/captures",
      headers: {
        authorization: "Bearer test-token"
      },
      payload: {
        type: "image",
        content: {}
      }
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });
});
