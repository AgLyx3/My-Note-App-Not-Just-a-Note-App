import { describe, expect, it } from "vitest";
import { CONFIDENCE_POLICY_VERSION, scoreToLabelV1 } from "../src/confidence-policy.js";

describe("confidence_policy_v1", () => {
  it("maps scores to likely / possible / uncertain", () => {
    expect(scoreToLabelV1(0.82)).toBe("likely");
    expect(scoreToLabelV1(0.55)).toBe("possible");
    expect(scoreToLabelV1(0.25)).toBe("uncertain");
  });

  it("exports stable policy version for API envelope", () => {
    expect(CONFIDENCE_POLICY_VERSION).toBe("confidence_policy_v1");
  });
});
