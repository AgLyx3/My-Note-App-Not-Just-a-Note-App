import type { PlacementSuggestionsResponse, SuggestionSource } from "../types/placement-suggestions.js";

export function isFallbackSuggestionResponse(
  source: SuggestionSource,
): boolean {
  return source === "fallback";
}

export type FallbackContractCheck =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not_fallback"
        | "confidence_not_uncertain"
        | "missing_create_new";
    };

/** Client-side guardrails matching contract §3.2 fallback notes. */
export function fallbackMeetsContractHints(
  response: PlacementSuggestionsResponse,
): FallbackContractCheck {
  if (response.source !== "fallback") {
    return { ok: false, reason: "not_fallback" };
  }
  if (response.confidence.label !== "uncertain") {
    return { ok: false, reason: "confidence_not_uncertain" };
  }
  const options = [response.top_option, ...response.alternatives];
  const hasCreateNew = options.some((o) => o.kind === "create_new");
  if (!hasCreateNew) {
    return { ok: false, reason: "missing_create_new" };
  }
  return { ok: true };
}
