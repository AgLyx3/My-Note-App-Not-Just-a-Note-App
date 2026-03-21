import type { PlacementSuggestionsResponse } from "../types/placement-suggestions.js";

/** Pointer to a row in the review sheet: top suggestion vs alternatives[index]. */
export type ReviewOptionPointer =
  | { role: "top" }
  | { role: "alternative"; index: number };

function firstCreateNewPointer(
  response: PlacementSuggestionsResponse,
): ReviewOptionPointer {
  if (response.top_option.kind === "create_new") return { role: "top" };
  const idx = response.alternatives.findIndex((o) => o.kind === "create_new");
  if (idx >= 0) return { role: "alternative", index: idx };
  return { role: "top" };
}

/**
 * Default focused/preselected row per mobile UI spec:
 * - High (likely): top preselected
 * - Medium (possible): top preselected
 * - Low (uncertain): create-new preselected when available
 * - Fallback: contract says uncertain → treat as low / prefer create_new
 * - Cold start: top create_new is the primary path
 */
export function getDefaultReviewPreselection(
  response: PlacementSuggestionsResponse,
): ReviewOptionPointer {
  if (response.source === "fallback") {
    return firstCreateNewPointer(response);
  }
  if (response.source === "cold_start") {
    return { role: "top" };
  }
  switch (response.confidence.label) {
    case "likely":
    case "possible":
      return { role: "top" };
    case "uncertain":
      return firstCreateNewPointer(response);
    default:
      return { role: "top" };
  }
}
