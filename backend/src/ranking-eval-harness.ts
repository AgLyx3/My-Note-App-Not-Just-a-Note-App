import type { SuggestionsResponseBody } from "./suggestion-service.js";
import { SuggestionService, type SuggestionServiceOptions } from "./suggestion-service.js";
import type { InMemoryNoteRepository } from "./note-repository.js";
import type { SuggestionsRequest } from "./suggestion-schema.js";

/** One collection bucket with placed text notes (rolling profile source). */
export interface RankingEvalCollectionSeed {
  name: string;
  notes: string[];
  /** ISO time; defaults to staggered recent times so list order is stable. */
  last_activity_at?: string;
}

export interface RankingEvalCase {
  id?: string;
  /** Draft note text used for ranking (like a new capture). */
  query: string;
  /** Must match a seeded `collection.name` exactly. */
  expected_collection_name: string;
  /** Collection names → resolved to ids after seeding. */
  recent_collection_names?: string[];
}

export interface RankingEvalFixture {
  collections: RankingEvalCollectionSeed[];
  cases: RankingEvalCase[];
}

export interface SeedRankingFixtureResult {
  nameToId: Map<string, string>;
}

/**
 * Seed placed notes per collection. Uses `InMemoryNoteRepository` + confirm stub.
 * Caller should use `{ seedDefaultCollections: false }` unless mixing with defaults.
 */
export async function seedRankingFixture(
  repo: InMemoryNoteRepository,
  userId: string,
  fixture: RankingEvalFixture,
  options?: { timeBaseMs?: number }
): Promise<SeedRankingFixtureResult> {
  const nameToId = new Map<string, string>();
  const base = options?.timeBaseMs ?? Date.now();

  for (let i = 0; i < fixture.collections.length; i++) {
    const col = fixture.collections[i]!;
    const at = col.last_activity_at ?? new Date(base - i * 60_000).toISOString();
    const id = repo.seedCollection(userId, { name: col.name, last_activity_at: at });
    nameToId.set(col.name, id);

    for (const noteText of col.notes) {
      const entry = await repo.createDraft({ type: "text", content: { text: noteText } }, userId);
      await repo.confirmPlacementStub(userId, entry.id, { kind: "collection", collection_id: id });
    }
  }

  return { nameToId };
}

/** Collection ids in suggestion order (top first), ignoring create_new rows. */
export function orderedCollectionIdsFromSuggestions(body: SuggestionsResponseBody): string[] {
  const ids: string[] = [];
  if (body.top_option.kind === "collection") {
    ids.push(body.top_option.collection.id);
  }
  for (const a of body.alternatives) {
    if (a.kind === "collection") {
      ids.push(a.collection.id);
    }
  }
  return ids;
}

export function rankOfCollectionId(orderedIds: string[], targetId: string): number | null {
  const i = orderedIds.indexOf(targetId);
  return i === -1 ? null : i + 1;
}

export interface CaseMetric {
  caseId: string;
  query: string;
  expectedName: string;
  rank: number | null;
  hitAt1: boolean;
  hitAt3: boolean;
  hitAt5: boolean;
  reciprocalRank: number;
  top5Names: string[];
  source: string;
}

export async function runRankingCase(
  repo: InMemoryNoteRepository,
  userId: string,
  nameToId: Map<string, string>,
  evalCase: RankingEvalCase,
  serviceOptions?: SuggestionServiceOptions
): Promise<CaseMetric> {
  const expectedId = nameToId.get(evalCase.expected_collection_name);
  if (!expectedId) {
    throw new Error(`Unknown expected_collection_name: ${evalCase.expected_collection_name}`);
  }

  const draft = await repo.createDraft({ type: "text", content: { text: evalCase.query } }, userId);
  const recentIds =
    evalCase.recent_collection_names?.map((n) => {
      const id = nameToId.get(n);
      if (!id) throw new Error(`Unknown recent_collection_name: ${n}`);
      return id;
    }) ?? [];

  const body: SuggestionsRequest = {
    hints: recentIds.length > 0 ? { recent_collection_ids: recentIds } : {}
  };

  const svc = new SuggestionService(repo, serviceOptions);
  const result = await svc.buildSuggestions(userId, draft.id, body);
  const orderedIds = orderedCollectionIdsFromSuggestions(result);
  const rank = rankOfCollectionId(orderedIds, expectedId);

  const idToName = new Map([...nameToId.entries()].map(([n, id]) => [id, n]));
  const top5Names = orderedIds.slice(0, 5).map((id) => idToName.get(id) ?? id);

  const hitAt1 = rank === 1;
  const hitAt3 = rank !== null && rank <= 3;
  const hitAt5 = rank !== null && rank <= 5;

  return {
    caseId: evalCase.id ?? evalCase.query.slice(0, 24),
    query: evalCase.query,
    expectedName: evalCase.expected_collection_name,
    rank,
    hitAt1,
    hitAt3,
    hitAt5,
    reciprocalRank: rank === null ? 0 : 1 / rank,
    top5Names,
    source: result.source
  };
}

export function aggregateMetrics(rows: CaseMetric[]): {
  n: number;
  hitAt1: number;
  hitAt3: number;
  hitAt5: number;
  mrr: number;
} {
  const n = rows.length;
  if (n === 0) return { n: 0, hitAt1: 0, hitAt3: 0, hitAt5: 0, mrr: 0 };
  const hitAt1 = rows.filter((r) => r.hitAt1).length / n;
  const hitAt3 = rows.filter((r) => r.hitAt3).length / n;
  const hitAt5 = rows.filter((r) => r.hitAt5).length / n;
  const mrr = rows.reduce((s, r) => s + r.reciprocalRank, 0) / n;
  return { n, hitAt1, hitAt3, hitAt5, mrr };
}
