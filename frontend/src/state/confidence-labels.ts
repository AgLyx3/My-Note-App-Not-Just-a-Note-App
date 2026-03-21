import type { ConfidenceLabel } from "../types/placement-suggestions.js";

/** Mobile UI spec — qualitative labels (never color-only). */
const DISPLAY: Record<ConfidenceLabel, string> = {
  likely: "Likely match",
  possible: "Possible match",
  uncertain: "Uncertain",
};

export function confidenceLabelDisplayText(label: ConfidenceLabel): string {
  return DISPLAY[label];
}

export function isConfidenceLabel(value: string): value is ConfidenceLabel {
  return value === "likely" || value === "possible" || value === "uncertain";
}
