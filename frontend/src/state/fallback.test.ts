import { describe, expect, it } from "vitest";
import type { PlacementSuggestionsResponse } from "../types/placement-suggestions.js";
import {
  fallbackMeetsContractHints,
  isFallbackSuggestionResponse,
} from "./fallback.js";

describe("isFallbackSuggestionResponse", () => {
  it("is true only for fallback source", () => {
    expect(isFallbackSuggestionResponse("fallback")).toBe(true);
    expect(isFallbackSuggestionResponse("model")).toBe(false);
    expect(isFallbackSuggestionResponse("cold_start")).toBe(false);
  });
});

describe("fallbackMeetsContractHints", () => {
  const response: PlacementSuggestionsResponse = {
    entry_id: "ent_1",
    source: "fallback",
    confidence: { score: 0.1, label: "uncertain" },
    top_option: {
      kind: "collection",
      rank: 1,
      score: 0.5,
      collection: {
        id: "col_recent",
        name: "Recent",
        last_activity_at: "2026-03-20T09:10:00Z",
      },
    },
    alternatives: [
      {
        kind: "collection",
        rank: 2,
        collection: {
          id: "col_other",
          name: "Other",
          last_activity_at: "2026-03-19T18:30:00Z",
        },
      },
      { kind: "create_new", rank: 3, score: 0.2, suggested_name: "New bucket" },
    ],
    generated_at: "2026-03-20T09:15:01Z",
  };

  it("passes when uncertain and at least one create_new exists", () => {
    expect(fallbackMeetsContractHints(response)).toEqual({ ok: true });
  });

  it("fails when confidence is not uncertain for fallback", () => {
    expect(
      fallbackMeetsContractHints({
        ...response,
        confidence: { ...response.confidence, label: "likely" },
      }),
    ).toMatchObject({ ok: false });
  });

  it("fails when no create_new option is present", () => {
    expect(
      fallbackMeetsContractHints({
        ...response,
        alternatives: response.alternatives.filter((a) => a.kind !== "create_new"),
      }),
    ).toMatchObject({ ok: false });
  });

  it("allows create_new only on top_option", () => {
    const topOnly: PlacementSuggestionsResponse = {
      ...response,
      top_option: {
        kind: "create_new",
        rank: 1,
        suggested_name: "Fresh",
      },
      alternatives: [],
    };
    expect(fallbackMeetsContractHints(topOnly)).toEqual({ ok: true });
  });
});
