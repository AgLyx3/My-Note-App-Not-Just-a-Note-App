import { describe, expect, it } from "vitest";
import { buildCategorizationPrompt } from "../src/categorization-prompt.js";

describe("buildCategorizationPrompt", () => {
  it("enforces strict JSON output requirements for parsers", () => {
    const prompt = buildCategorizationPrompt(
      { type: "text", text: "Book flights for Tokyo" },
      [{ id: "col_travel", name: "Travel Plans" }],
      []
    );

    expect(prompt.system).toContain("one JSON object only");
    expect(prompt.system).toContain("no code fences");
    expect(prompt.system).toContain("confidence_score must be a JSON number");
    expect(prompt.system).toContain('"top_choice"');
    expect(prompt.user).toContain("CREATE_NEW");
    expect(prompt.user).toContain("Candidate collections");
    expect(prompt.user).toContain("Output checklist");
  });

  it("includes correction hints to reduce repeated misclassification", () => {
    const prompt = buildCategorizationPrompt(
      { type: "text", text: "Great article on React hooks https://example.com/react-hooks" },
      [{ id: "col_dev", name: "Dev Notes" }],
      [{ from_collection: "Personal", to_collection: "Dev Notes", note: "Programming links belong in dev." }]
    );

    expect(prompt.user).toContain("Recent correction hints");
    expect(prompt.user).toContain("Programming links belong in dev.");
    expect(prompt.system).toContain("Correction hints override");
  });

  it("documents confidence bands for calibration", () => {
    const prompt = buildCategorizationPrompt(
      { type: "text", text: "Maybe something about work" },
      [{ id: "c1", name: "Work" }],
      []
    );

    expect(prompt.system).toMatch(/0\.85/);
    expect(prompt.system).toMatch(/0\.65/);
    expect(prompt.system).toMatch(/0\.45/);
    expect(prompt.system).toContain("never fake high confidence");
  });

  it("includes ambiguity handling when collections could tie", () => {
    const prompt = buildCategorizationPrompt({ type: "text", text: "idea" }, [{ id: "a", name: "A" }], []);

    expect(prompt.system).toContain("equally well");
    expect(prompt.system).toContain("CREATE_NEW");
    expect(prompt.system).toContain("Do not stretch");
  });

  it("adds URL- and image-aware guidance and optional url fields in payload", () => {
    const prompt = buildCategorizationPrompt(
      {
        type: "text",
        text: "Read this https://docs.example.com/api",
        urls_in_capture: ["https://docs.example.com/api"],
        url_context: [{ url: "https://docs.example.com/api", title_hint: "API reference" }]
      },
      [{ id: "col_api", name: "API docs" }],
      []
    );

    expect(prompt.system).toContain("url_context");
    expect(prompt.system).toContain("type \"image\"");
    expect(prompt.system).toContain("utm_");
    expect(prompt.user).toContain("urls_in_capture");
    expect(prompt.user).toContain("API reference");
  });

  it("serializes image captures with image-summary guidance in system prompt", () => {
    const prompt = buildCategorizationPrompt(
      { type: "image", image_summary: "Whiteboard with sprint tasks" },
      [{ id: "col_work", name: "Work" }],
      []
    );

    expect(prompt.user).toContain("image_summary");
    expect(prompt.system).toContain("image_summary");
  });
});
