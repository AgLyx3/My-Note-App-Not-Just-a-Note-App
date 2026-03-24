import { describe, expect, it } from "vitest";
import {
  buildCollectionProfileText,
  buildQueryEmbeddingText,
  cosineSimilarity,
  fusedScoresToDisplayScores,
  lexicalEmbedding,
  rankCollectionsByEmbedding
} from "../src/embedding-rank.js";
import type { CollectionSummary } from "../src/note-repository.js";

describe("embedding-rank", () => {
  it("buildCollectionProfileText uses name only when no previews", () => {
    expect(buildCollectionProfileText("Work", [])).toBe("Collection: Work");
  });

  it("buildCollectionProfileText includes bullet previews", () => {
    const t = buildCollectionProfileText("Travel", ["flight to NRT", "hotel"]);
    expect(t).toContain("Collection: Travel");
    expect(t).toContain("- flight to NRT");
    expect(t).toContain("- hotel");
  });

  it("buildQueryEmbeddingText wraps capture", () => {
    expect(buildQueryEmbeddingText("hello")).toContain("Capture:");
    expect(buildQueryEmbeddingText("hello")).toContain("hello");
  });

  it("cosineSimilarity is 1 for identical normalized vectors", () => {
    const v = lexicalEmbedding("same words same words");
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it("rankCollectionsByEmbedding orders by semantic score when no recent hints", () => {
    const collections: CollectionSummary[] = [
      { id: "a", name: "A", last_activity_at: "2026-03-20T12:00:00Z" },
      { id: "b", name: "B", last_activity_at: "2026-03-20T12:00:00Z" }
    ];
    const q = [1, 0, 0, 0];
    const pa = [1, 0, 0, 0];
    const pb = [0, 1, 0, 0];
    const ranked = rankCollectionsByEmbedding(collections, q, [pa, pb], undefined);
    expect(ranked[0]!.collection.id).toBe("a");
    expect(ranked[1]!.collection.id).toBe("b");
  });

  it("rankCollectionsByEmbedding boosts recent_collection_ids on ties", () => {
    const collections: CollectionSummary[] = [
      { id: "a", name: "A", last_activity_at: "2026-03-20T12:00:00Z" },
      { id: "b", name: "B", last_activity_at: "2026-03-20T12:00:00Z" }
    ];
    const v = [1, 0, 0, 0];
    const ranked = rankCollectionsByEmbedding(collections, v, [v, v], ["b", "a"]);
    expect(ranked[0]!.collection.id).toBe("b");
  });

  it("fusedScoresToDisplayScores spreads scores", () => {
    const out = fusedScoresToDisplayScores([0.5, 0.7, 0.9]);
    expect(out[0]!).toBeLessThan(out[2]!);
    expect(out[0]!).toBeGreaterThanOrEqual(0.38);
    expect(out[2]!).toBeLessThanOrEqual(0.9);
  });
});
