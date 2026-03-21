import type {
  PlacementSuggestionsResponse,
  SuggestionOption,
  SuggestionSource,
} from "../types/placement-suggestions.js";

export function isColdStartSuggestionResponse(
  source: SuggestionSource,
): boolean {
  return source === "cold_start";
}

/** Names usable for inline create-new field (deduped, stable order). */
export function coldStartSuggestedNames(
  response: PlacementSuggestionsResponse,
): string[] {
  if (response.source !== "cold_start") return [];
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (name: string | undefined) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    ordered.push(name);
  };
  if (response.top_option.kind === "create_new") {
    push(response.top_option.suggested_name);
  }
  for (const alt of response.alternatives) {
    if (alt.kind === "create_new") push(alt.suggested_name);
  }
  return ordered;
}

export type ColdStartNormalization =
  | { ok: true; value: SuggestionOption[] }
  | { ok: false; reason: "not_cold_start" | "top_not_create_new" };

/** Ordered create_new rows for the review sheet (top first). */
export function normalizeColdStartReviewOptions(
  response: PlacementSuggestionsResponse,
): ColdStartNormalization {
  if (response.source !== "cold_start") {
    return { ok: false, reason: "not_cold_start" };
  }
  if (response.top_option.kind !== "create_new") {
    return { ok: false, reason: "top_not_create_new" };
  }
  const value: SuggestionOption[] = [response.top_option];
  for (const alt of response.alternatives) {
    if (alt.kind === "create_new") value.push(alt);
  }
  return { ok: true, value };
}
