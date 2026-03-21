import { describe, expect, it } from "vitest";
import type { PlacementSuggestionsResponse } from "../types/placement-suggestions.js";
import { getDefaultReviewPreselection } from "./review-preselection.js";

function modelResponse(
  label: PlacementSuggestionsResponse["confidence"]["label"],
  overrides?: Partial<PlacementSuggestionsResponse>,
): PlacementSuggestionsResponse {
  return {
    entry_id: "ent_1",
    source: "model",
    confidence: { score: 0.82, label, policy_version: "confidence_policy_v1" },
    top_option: {
      kind: "collection",
      rank: 1,
      score: 0.82,
      collection: {
        id: "col_1",
        name: "Travel",
        last_activity_at: "2026-03-20T09:10:00Z",
      },
    },
    alternatives: [
      {
        kind: "collection",
        rank: 2,
        score: 0.55,
        collection: {
          id: "col_2",
          name: "Personal Admin",
          last_activity_at: "2026-03-19T18:30:00Z",
        },
      },
      {
        kind: "create_new",
        rank: 3,
        score: 0.48,
        suggested_name: "Tokyo Trip",
      },
    ],
    generated_at: "2026-03-20T09:15:01Z",
    ...overrides,
  };
}

describe("getDefaultReviewPreselection", () => {
  it("preselects top_option for likely (high confidence UI)", () => {
    expect(getDefaultReviewPreselection(modelResponse("likely"))).toEqual({
      role: "top",
    });
  });

  it("preselects top_option for possible (medium confidence UI)", () => {
    expect(getDefaultReviewPreselection(modelResponse("possible"))).toEqual({
      role: "top",
    });
  });

  it("preselects first create_new when uncertain and top is a collection", () => {
    expect(getDefaultReviewPreselection(modelResponse("uncertain"))).toEqual({
      role: "alternative",
      index: 1,
    });
  });

  it("preselects top when uncertain but top is already create_new", () => {
    const r = modelResponse("uncertain", {
      top_option: {
        kind: "create_new",
        rank: 1,
        score: 0.4,
        suggested_name: "Only new",
      },
      alternatives: [],
    });
    expect(getDefaultReviewPreselection(r)).toEqual({ role: "top" });
  });

  it("fallback: preselects create_new (contract uncertain + recents + create_new)", () => {
    const fallback: PlacementSuggestionsResponse = {
      entry_id: "ent_1",
      source: "fallback",
      confidence: { score: 0.1, label: "uncertain" },
      top_option: {
        kind: "collection",
        rank: 1,
        collection: {
          id: "col_recent",
          name: "Recent",
          last_activity_at: "2026-03-20T09:10:00Z",
        },
      },
      alternatives: [
        {
          kind: "create_new",
          rank: 2,
          suggested_name: "New",
        },
      ],
      generated_at: "2026-03-20T09:15:01Z",
    };
    expect(getDefaultReviewPreselection(fallback)).toEqual({
      role: "alternative",
      index: 0,
    });
  });

  it("cold_start: preselects top create_new row", () => {
    const cold: PlacementSuggestionsResponse = {
      entry_id: "ent_1",
      source: "cold_start",
      confidence: { score: 0.2, label: "uncertain" },
      top_option: {
        kind: "create_new",
        rank: 1,
        suggested_name: "First idea",
      },
      alternatives: [
        { kind: "create_new", rank: 2, suggested_name: "Second" },
      ],
      generated_at: "2026-03-20T09:15:01Z",
    };
    expect(getDefaultReviewPreselection(cold)).toEqual({ role: "top" });
  });

  it("if no create_new exists under uncertain, falls back to top (defensive)", () => {
    const r = modelResponse("uncertain", {
      alternatives: [
        {
          kind: "collection",
          rank: 2,
          collection: {
            id: "col_2",
            name: "Only alt",
            last_activity_at: "2026-03-19T18:30:00Z",
          },
        },
      ],
    });
    expect(getDefaultReviewPreselection(r)).toEqual({ role: "top" });
  });
});
