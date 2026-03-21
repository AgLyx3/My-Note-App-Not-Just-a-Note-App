/** Maps model score to label for `confidence_policy_v1` (API contract; thresholds are implementation-defined). */
export const CONFIDENCE_POLICY_VERSION = "confidence_policy_v1";

export type ConfidenceLabel = "likely" | "possible" | "uncertain";

export function scoreToLabelV1(score: number): ConfidenceLabel {
  if (score >= 0.72) return "likely";
  if (score >= 0.4) return "possible";
  return "uncertain";
}

export function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.min(1, Math.max(0, score));
}
