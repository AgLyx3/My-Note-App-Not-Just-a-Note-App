import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("entry mutations", () => {
  it("updates entry text with PATCH /v1/entries/:entryId", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/v1/captures",
      headers: { authorization: "Bearer test-token" },
      payload: {
        type: "text",
        content: { text: "initial" }
      }
    });
    expect(create.statusCode).toBe(201);
    const entryId = create.json().entry.id as string;

    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/entries/${entryId}`,
      headers: { authorization: "Bearer test-token" },
      payload: { content: { text: "updated text" } }
    });

    expect(patch.statusCode).toBe(200);
    expect(patch.json().entry.preview).toContain("updated text");
  });

  it("deletes entry with DELETE /v1/entries/:entryId", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/v1/captures",
      headers: { authorization: "Bearer test-token" },
      payload: {
        type: "text",
        content: { text: "to delete" }
      }
    });
    expect(create.statusCode).toBe(201);
    const entryId = create.json().entry.id as string;

    const remove = await app.inject({
      method: "DELETE",
      url: `/v1/entries/${entryId}`,
      headers: { authorization: "Bearer test-token" }
    });
    expect(remove.statusCode).toBe(204);

    const patchAfterDelete = await app.inject({
      method: "PATCH",
      url: `/v1/entries/${entryId}`,
      headers: { authorization: "Bearer test-token" },
      payload: { content: { text: "should fail" } }
    });
    expect(patchAfterDelete.statusCode).toBe(404);
  });
});
