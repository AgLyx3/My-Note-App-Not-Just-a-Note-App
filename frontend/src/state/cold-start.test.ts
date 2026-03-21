import { describe, expect, it } from "vitest";
import type { PlacementSuggestionsResponse } from "../types/placement-suggestions.js";
import {
  coldStartSuggestedNames,
  isColdStartSuggestionResponse,
  normalizeColdStartReviewOptions,
} from "./cold-start.js";

const base: PlacementSuggestionsResponse = {
  entry_id: "ent_1",
  source: "cold_start",
  confidence: {
    score: 0.2,
    label: "uncertain",
    policy_version: "confidence_policy_v1",
  },
  top_option: {
    kind: "create_new",
    rank: 1,
    score: 0.5,
    suggested_name: "Trip ideas",
  },
  alternatives: [
    { kind: "create_new", rank: 2, score: 0.4, suggested_name: "Work notes" },
    { kind: "create_new", rank: 3, score: 0.35, suggested_name: "Reading list" },
  ],
  generated_at: "2026-03-20T09:15:01Z",
};

describe("isColdStartSuggestionResponse", () => {
  it("is true only for cold_start source", () => {
    expect(isColdStartSuggestionResponse("cold_start")).toBe(true);
    expect(isColdStartSuggestionResponse("model")).toBe(false);
    expect(isColdStartSuggestionResponse("fallback")).toBe(false);
  });
});

describe("coldStartSuggestedNames", () => {
  it("collects suggested_name from top create_new and create_new alternatives", () => {
    expect(coldStartSuggestedNames(base)).toEqual([
      "Trip ideas",
      "Work notes",
      "Reading list",
    ]);
  });

  it("deduplicates repeated names", () => {
    const dup: PlacementSuggestionsResponse = {
      ...base,
      top_option: { ...base.top_option, suggested_name: "Same" },
      alternatives: [
        { kind: "create_new", suggested_name: "Same" },
        { kind: "create_new", suggested_name: "Other" },
      ],
    };
    expect(coldStartSuggestedNames(dup)).toEqual(["Same", "Other"]);
  });

  it("returns empty when not cold_start", () => {
    expect(
      coldStartSuggestedNames({ ...base, source: "model" }),
    ).toEqual([]);
  });

  it("skips create_new rows without suggested_name", () => {
    const partial: PlacementSuggestionsResponse = {
      ...base,
      top_option: { kind: "create_new", rank: 1 },
      alternatives: [{ kind: "create_new", suggested_name: "Only" }],
    };
    expect(coldStartSuggestedNames(partial)).toEqual(["Only"]);
  });
});

describe("normalizeColdStartReviewOptions", () => {
  it("requires top_option.kind create_new per contract", () => {
    const bad: PlacementSuggestionsResponse = {
      ...base,
      top_option: {
        kind: "collection",
        rank: 1,
        collection: {
          id: "col_x",
          name: "X",
          last_activity_at: "2026-03-20T09:00:00Z",
        },
      },
    };
    expect(normalizeColdStartReviewOptions(bad).ok).toBe(false);
  });

  it("returns ordered create_new rows for review (top first, then alternatives)", () => {
    const res = normalizeColdStartReviewOptions(base);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.value.map((o) => o.suggested_name)).toEqual([
      "Trip ideas",
      "Work notes",
      "Reading list",
    ]);
  });
});
