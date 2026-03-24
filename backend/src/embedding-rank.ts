import type { CollectionSummary } from "./note-repository.js";
import { embedTextsOpenAI } from "./openai-embed.js";

/** Notes sampled newest-first into the rolling profile (plan: 15–30). */
export const ROLLING_NOTE_LIMIT = 20;
const PROFILE_LINE_MAX = 300;
const PROFILE_TOTAL_MAX = 6000;

const WORD_RE = /[a-z0-9]+/gi;

function normalizeL2(vec: number[]): number[] {
  const n = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  if (n === 0 || !Number.isFinite(n)) {
    return vec.map(() => 0);
  }
  return vec.map((x) => x / n);
}

/**
 * Cheap bag-of-token embedding for dev/CI when `OPENAI_API_KEY` is unset.
 * Not a substitute for model embeddings in production quality terms.
 */
export function lexicalEmbedding(text: string, dimensions = 256): number[] {
  const vec = new Array(dimensions).fill(0);
  const matches = text.toLowerCase().match(WORD_RE);
  if (!matches) return normalizeL2(vec);
  for (const w of matches) {
    let h = 0;
    for (let i = 0; i < w.length; i++) {
      h = (h * 31 + w.charCodeAt(i)) >>> 0;
    }
    vec[h % dimensions] += 1;
  }
  return normalizeL2(vec);
}

/** Cosine similarity for L2-normalized vectors = dot product. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  if (!Number.isFinite(s)) return 0;
  return s;
}

export function buildQueryEmbeddingText(draftPreview: string): string {
  const t = draftPreview.trim() || "Notes";
  return `Capture:\n${t}`;
}

export function buildCollectionProfileText(name: string, previews: string[]): string {
  const header = `Collection: ${name.trim() || "Untitled"}`;
  if (previews.length === 0) return header;

  const lines = previews.map((p) => {
    const t = p.replace(/\s+/g, " ").trim();
    if (t.length <= PROFILE_LINE_MAX) return t;
    return `${t.slice(0, PROFILE_LINE_MAX)}…`;
  });

  const build = (subset: string[]) =>
    subset.length === 0 ? header : `${header}\nRecent notes:\n${subset.map((l) => `- ${l}`).join("\n")}`;

  let use = [...lines];
  while (use.length > 0 && build(use).length > PROFILE_TOTAL_MAX) {
    use.pop();
  }
  return build(use);
}

export interface RankedCollection {
  collection: CollectionSummary;
  fusedScore: number;
  semanticScore: number;
}

function recentCollectionBoost(collectionId: string, recentIds: string[] | undefined): number {
  if (!recentIds?.length) return 0;
  const idx = recentIds.indexOf(collectionId);
  if (idx === -1) return 0;
  return Math.max(0, 0.14 - idx * 0.035);
}

function activityBoostMs(lastActivityAt: string, maxTs: number, minTs: number): number {
  const t = new Date(lastActivityAt).getTime();
  if (!Number.isFinite(t)) return 0;
  if (maxTs <= minTs) return 0.02;
  const norm = (t - minTs) / (maxTs - minTs);
  return 0.02 * Math.max(0, Math.min(1, norm));
}

/**
 * Primary semantic score from embeddings, then behavioral boosts (recent hints + activity).
 */
export function rankCollectionsByEmbedding(
  collections: CollectionSummary[],
  queryEmbedding: number[],
  profileEmbeddings: number[][],
  recentCollectionIds?: string[]
): RankedCollection[] {
  if (collections.length !== profileEmbeddings.length) {
    throw new Error("COLLECTION_PROFILE_EMBEDDING_MISMATCH");
  }

  const times = collections.map((c) => new Date(c.last_activity_at).getTime());
  const valid = times.filter((t) => Number.isFinite(t));
  const maxTs = valid.length ? Math.max(...valid) : 0;
  const minTs = valid.length ? Math.min(...valid) : 0;

  const rows: RankedCollection[] = collections.map((c, i) => {
    const sem = cosineSimilarity(queryEmbedding, profileEmbeddings[i]!);
    const fused = sem + recentCollectionBoost(c.id, recentCollectionIds) + activityBoostMs(c.last_activity_at, maxTs, minTs);
    return { collection: c, fusedScore: fused, semanticScore: sem };
  });

  rows.sort((a, b) => b.fusedScore - a.fusedScore);
  return rows;
}

/**
 * Map fused scores to UI confidence scores in [minOut, maxOut] for policy thresholds.
 */
export function fusedScoresToDisplayScores(fusedScores: number[], minOut = 0.38, maxOut = 0.9): number[] {
  if (fusedScores.length === 0) return [];
  const min = Math.min(...fusedScores);
  const max = Math.max(...fusedScores);
  if (max <= min) {
    return fusedScores.map(() => (minOut + maxOut) / 2);
  }
  return fusedScores.map((f) => minOut + ((f - min) / (max - min)) * (maxOut - minOut));
}

/**
 * When `OPENAI_API_KEY` is set: remote embeddings. Otherwise lexical vectors (local).
 */
export async function embedTextsDefault(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (process.env.OPENAI_API_KEY?.trim()) {
    return embedTextsOpenAI(texts);
  }
  return texts.map((t) => lexicalEmbedding(t));
}
