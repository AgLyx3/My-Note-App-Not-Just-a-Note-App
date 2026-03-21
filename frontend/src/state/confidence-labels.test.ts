import { describe, expect, it } from "vitest";
import {
  confidenceLabelDisplayText,
  isConfidenceLabel,
} from "./confidence-labels.js";

describe("confidenceLabelDisplayText", () => {
  it('maps likely to "Likely match" (UI spec)', () => {
    expect(confidenceLabelDisplayText("likely")).toBe("Likely match");
  });

  it('maps possible to "Possible match"', () => {
    expect(confidenceLabelDisplayText("possible")).toBe("Possible match");
  });

  it('maps uncertain to "Uncertain"', () => {
    expect(confidenceLabelDisplayText("uncertain")).toBe("Uncertain");
  });
});

describe("isConfidenceLabel", () => {
  it("accepts contract labels", () => {
    expect(isConfidenceLabel("likely")).toBe(true);
    expect(isConfidenceLabel("possible")).toBe(true);
    expect(isConfidenceLabel("uncertain")).toBe(true);
  });

  it("rejects unknown strings", () => {
    expect(isConfidenceLabel("high")).toBe(false);
    expect(isConfidenceLabel("")).toBe(false);
  });
});
