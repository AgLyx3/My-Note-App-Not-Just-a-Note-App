import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("POST /v1/extract-text", () => {
  it("returns 401 when auth header is missing", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/extract-text",
      payload: { image_base64: "abc", mime_type: "image/jpeg" }
    });
    expect(response.statusCode).toBe(401);
  });

  it("returns extracted text when extractor is injected", async () => {
    const app = buildApp({
      extractTextFromImage: async () => "hello from mock"
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/extract-text",
      headers: { authorization: "Bearer u1" },
      payload: { image_base64: "abc", mime_type: "image/jpeg" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ text: "hello from mock" });
  });
});
