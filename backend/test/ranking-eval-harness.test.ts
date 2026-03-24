import { describe, expect, it } from "vitest";
import {
  aggregateMetrics,
  rankOfCollectionId,
  runRankingCase,
  seedRankingFixture,
  type RankingEvalFixture
} from "../src/ranking-eval-harness.js";
import { InMemoryNoteRepository } from "../src/note-repository.js";

describe("ranking-eval-harness", () => {
  it("computes rank and aggregate metrics", () => {
    expect(rankOfCollectionId(["a", "b", "c"], "b")).toBe(2);
    expect(rankOfCollectionId(["a"], "x")).toBeNull();
    const agg = aggregateMetrics([
      {
        caseId: "1",
        query: "q",
        expectedName: "E",
        rank: 1,
        hitAt1: true,
        hitAt3: true,
        hitAt5: true,
        reciprocalRank: 1,
        top5Names: ["E"],
        source: "model"
      },
      {
        caseId: "2",
        query: "q2",
        expectedName: "E2",
        rank: 3,
        hitAt1: false,
        hitAt3: true,
        hitAt5: true,
        reciprocalRank: 1 / 3,
        top5Names: ["a", "b", "E2"],
        source: "model"
      }
    ]);
    expect(agg.n).toBe(2);
    expect(agg.hitAt1).toBe(0.5);
    expect(agg.mrr).toBeCloseTo((1 + 1 / 3) / 2, 5);
  });

  it("runRankingCase respects injectable embedBatch (deterministic)", async () => {
    const fixture: RankingEvalFixture = {
      collections: [
        {
          name: "Travel",
          notes: ["flight to NYC"],
          last_activity_at: "2026-03-20T12:00:00.000Z"
        },
        {
          name: "Work",
          notes: ["sprint planning"],
          last_activity_at: "2026-03-19T12:00:00.000Z"
        }
      ],
      cases: [{ id: "t1", query: "book hotel", expected_collection_name: "Travel" }]
    };

    const repo = new InMemoryNoteRepository({ seedDefaultCollections: false });
    const userId = "u1";
    const { nameToId } = await seedRankingFixture(repo, userId, fixture);

    const basis = (i: number) => {
      const v = new Array(8).fill(0);
      v[i] = 1;
      return v;
    };

    const embedBatch = async (texts: string[]) => {
      expect(texts.length).toBe(3);
      const q = basis(0);
      const profiles = texts.slice(1).map((t) => (t.includes("Collection: Travel") ? basis(0) : basis(1)));
      return [q, ...profiles];
    };

    const row = await runRankingCase(repo, userId, nameToId, fixture.cases[0]!, { embedBatch });
    expect(row.hitAt1).toBe(true);
    expect(row.rank).toBe(1);
    expect(row.expectedName).toBe("Travel");
  });
});
