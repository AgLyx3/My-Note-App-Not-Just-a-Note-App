import type { CreateCaptureBody } from "./capture-schema.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCollectionProfileText,
  buildQueryEmbeddingText,
  embedTextsDefault,
  fusedScoresToDisplayScores,
  rankCollectionsByEmbedding,
  ROLLING_NOTE_LIMIT
} from "./embedding-rank.js";
import { InMemoryNoteRepository, type CollectionSummary, type NoteRepository } from "./note-repository.js";
import type { SuggestionsRequest } from "./suggestion-schema.js";

export interface LabRun {
  run_id: string;
  created_at: string;
  tester_id: string;
  algorithm_version: string;
  dataset_source: "default_fixture" | "prompt_generated";
  embedding_mode: "openai_or_lexical";
  user_id: string;
}

export interface LabCandidateScore {
  rank: number;
  collection_id: string;
  collection_name: string;
  collection_note_count: number;
  score: number;
  semantic_score: number;
  fused_score: number;
}

export interface LabTrace {
  trace_id: string;
  run_id: string;
  created_at: string;
  entry_id: string;
  entry_text: string;
  source: "model" | "fallback" | "cold_start";
  latency_ms: number;
  top1_score: number | null;
  top2_score: number | null;
  margin: number | null;
  candidates: LabCandidateScore[];
}

export interface LabDecision {
  decision_id: string;
  trace_id: string;
  run_id: string;
  created_at: string;
  selected_kind: "collection" | "create_new";
  selected_collection_id: string | null;
  selected_collection_note_count: number | null;
  selected_rank: number | null;
  expected_collection_id: string | null;
  failure_reason: string | null;
}

export interface LabMetrics {
  traces: number;
  decisions: number;
  hit_at_1: number;
  hit_at_3: number;
  mrr: number;
  fallback_rate: number;
  p95_latency_ms: number;
}

type DatasetCase = { capture_text: string; expected_collection_name: string };
export interface LabBucketDetail {
  id: string;
  name: string;
  note_count: number;
  notes: string[];
}

const DEFAULT_DATASET = {
  collections: [
    {
      name: "Product Design",
      notes: [
        "improve onboarding copy for first-time users",
        "review friction in signup flow and reduce drop-off",
        "new layout for settings page with clearer hierarchy"
      ]
    },
    {
      name: "Growth Experiments",
      notes: [
        "a b test headline variants for landing page",
        "track referral conversion from invite banner",
        "optimize activation funnel metrics this week"
      ]
    },
    {
      name: "Engineering Backlog",
      notes: [
        "fix race condition in suggestion endpoint",
        "reduce latency in ranking pipeline",
        "investigate flaky test in placement flow"
      ]
    },
    {
      name: "Personal Errands",
      notes: [
        "buy groceries and pick up parcel",
        "book dentist appointment for next month",
        "renew gym membership and update billing"
      ]
    },
    {
      name: "Research Notes",
      notes: [
        "summarize paper on hierarchical text classification",
        "compare semantic routing approaches in rag",
        "collect baselines for few-shot label matching"
      ]
    }
  ],
  cases: [
    { capture_text: "signup drop off after first screen", expected_collection_name: "Product Design" },
    { capture_text: "need to speed up suggestion endpoint p95", expected_collection_name: "Engineering Backlog" },
    { capture_text: "compare few shot class prototype papers", expected_collection_name: "Research Notes" },
    { capture_text: "run onboarding headline experiment", expected_collection_name: "Growth Experiments" },
    { capture_text: "buy milk eggs and vegetables tonight", expected_collection_name: "Personal Errands" }
  ] as DatasetCase[]
};

const FIXED_LAB_BUCKETS = [
  "ai hack",
  "birthdays",
  "book to read",
  "friends' pref",
  "movies!",
  "my new app ideas",
  "product thinking & learning",
  "shopping list",
  "some events",
  "TODO"
];

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_LAB_MODEL = "gpt-4o-mini";
const LAB_JSON_SYSTEM = [
  "You generate synthetic test data for note bucketing evaluation.",
  "Return valid JSON only.",
  "Schema:",
  "{",
  '  "buckets": [',
  "    {",
  '      "name": "1-3 words only",',
  '      "notes": ["note strings"]',
  "    }",
  "  ]",
  "}",
  "Rules:",
  "- Bucket names must be short (1-3 words).",
  "- Notes style and format should follow the user's style intent.",
  "- Keep notes readable enough for bucketing evaluation.",
  "- Never include markdown fences."
].join("\n");
const LAB_NOTES_SYSTEM = [
  "You generate realistic synthetic notes for ONE bucket.",
  "Return valid JSON only.",
  'Schema: { "notes": ["..."] }',
  "Rules:",
  "- Generate notes that clearly belong to the given bucket name.",
  "- Follow the user's style intent for note format and tone.",
  "- Do not copy/rephrase the style prompt verbatim.",
  "- Keep notes meaningful enough to classify into the bucket.",
  "- No markdown fences."
].join("\n");

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}


interface PersistedLabStateV1 {
  version: 1;
  runs: LabRun[];
  traces: Array<{ run_id: string; rows: LabTrace[] }>;
  decisions: Array<{ run_id: string; rows: LabDecision[] }>;
  cases: Array<{ run_id: string; rows: DatasetCase[] }>;
  run_bucket_ids: Array<{ run_id: string; ids: string[] }>;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function toPreviewText(text: string): string {
  const t = text.trim();
  if (t.length <= 280) return t;
  return `${t.slice(0, 280)}…`;
}

function titleCaseWord(w: string): string {
  return w.length === 0 ? w : `${w[0]!.toUpperCase()}${w.slice(1).toLowerCase()}`;
}

function cleanPromptWords(prompt: string): string[] {
  return (prompt.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2);
}

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function makeShortBucketName(seedWords: string[], idx: number): string {
  const defaults = [
    "work",
    "home",
    "health",
    "finance",
    "travel",
    "learning",
    "ideas",
    "projects",
    "tasks",
    "planning"
  ];
  const words = seedWords.length ? seedWords : defaults;
  const count = 1 + (idx % 3);
  const picked: string[] = [];
  for (let i = 0; i < count; i++) {
    picked.push(titleCaseWord(words[(idx + i * 5) % words.length]!));
  }
  return picked.join(" ");
}

function makeNoisyNote(baseWords: string[], idx: number): string {
  const fillers = ["hmm", "later", "quick", "draft", "todo", "revise", "maybe", "rough", "urgent", "context"];
  const words = baseWords.length ? baseWords : ["general", "note", "idea"];
  const short = idx % 3 === 0;
  if (short) {
    const n = 3 + (idx % 3);
    const tokens: string[] = [];
    for (let i = 0; i < n; i++) tokens.push(words[(idx + i) % words.length]!);
    if (idx % 2 === 0) tokens.push(randomFrom(fillers));
    return tokens.join(idx % 4 === 0 ? "  " : " ");
  }
  const s1 = `${titleCaseWord(words[idx % words.length]!)} ${randomFrom(words)} ${randomFrom(fillers)}.`;
  const s2 = `${titleCaseWord(randomFrom(words))} ${randomFrom(words)} ${randomFrom(words)} ${randomFrom(fillers)}.`;
  const s3 = `${titleCaseWord(randomFrom(words))} ${randomFrom(fillers)} ${randomFrom(words)}.`;
  return idx % 2 === 0 ? `${s1} ${s2}` : `${s1} ${s2} ${s3}`;
}

function buildStructuredSynthetic(prompt: string, bucketCount: number, notesPerBucket: number) {
  const seedWords = cleanPromptWords(prompt);
  const used = new Set<string>();
  const buckets: Array<{ name: string; notes: string[] }> = [];
  for (let i = 0; i < bucketCount; i++) {
    let name = makeShortBucketName(seedWords, i);
    let tries = 0;
    while (used.has(name) && tries < 10) {
      name = `${makeShortBucketName(seedWords, i + tries + 1)} ${titleCaseWord(seedWords[(i + tries) % (seedWords.length || 1)] ?? "Topic")}`.split(/\s+/).slice(0, 3).join(" ");
      tries++;
    }
    used.add(name);
    const noteBase = [...name.toLowerCase().split(/\s+/), ...seedWords];
    const notes = Array.from({ length: notesPerBucket }).map((_, j) => makeNoisyNote(noteBase, i * notesPerBucket + j));
    buckets.push({ name, notes });
  }
  return { buckets };
}

function parseStructuredJson(text: string): { buckets: Array<{ name: string; notes: string[] }> } {
  const trimmed = text.trim();
  const noFence = trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(noFence) as unknown;
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { buckets?: unknown }).buckets)) {
    throw new Error("LAB_JSON_INVALID_SHAPE");
  }
  const buckets = (parsed as { buckets: Array<{ name?: unknown; notes?: unknown }> }).buckets
    .map((b) => ({
      name: typeof b.name === "string" ? b.name.trim() : "",
      notes: Array.isArray(b.notes) ? b.notes.filter((n): n is string => typeof n === "string").map((n) => n.trim()) : []
    }))
    .filter((b) => b.name.length > 0);
  return { buckets };
}

function parseNotesJson(text: string): { notes: string[] } {
  const trimmed = text.trim();
  const noFence = trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(noFence) as unknown;
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { notes?: unknown }).notes)) {
    throw new Error("LAB_JSON_INVALID_NOTES_SHAPE");
  }
  const notes = (parsed as { notes: unknown[] }).notes
    .filter((n): n is string => typeof n === "string")
    .map((n) => n.replace(/\s+/g, " ").trim())
    .filter((n) => n.length > 0);
  return { notes };
}

function hasHighPromptEcho(stylePrompt: string, notes: string[]): boolean {
  const p = stylePrompt.toLowerCase().replace(/\s+/g, " ").trim();
  if (!p) return false;
  const longPart = p.split(/[.,;:!?]/).map((x) => x.trim()).find((x) => x.length > 24) ?? p;
  return notes.some((n) => n.toLowerCase().includes(longPart));
}

async function generateNotesForBucketWithOpenAI(input: {
  bucketName: string;
  stylePrompt: string;
  count: number;
}): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_NOT_CONFIGURED");
  const model = process.env.OPENAI_LAB_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || DEFAULT_LAB_MODEL;
  const userPrompt = [
    `Bucket name: ${input.bucketName}`,
    `Style intent: ${input.stylePrompt || "balanced realistic notes"}`,
    `Generate exactly ${input.count} notes for this bucket.`,
    "Return JSON only."
  ].join("\n");
  const res = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.9,
      messages: [
        { role: "system", content: LAB_NOTES_SYSTEM },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    })
  });
  const data = (await res.json()) as OpenAIChatResponse;
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `OPENAI_REQUEST_FAILED_${res.status}`);
  }
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  const parsed = parseNotesJson(content);
  if (parsed.notes.length < input.count) {
    throw new Error("LAB_NOTES_TOO_FEW");
  }
  if (hasHighPromptEcho(input.stylePrompt, parsed.notes)) {
    throw new Error("LAB_NOTES_PROMPT_ECHO");
  }
  return parsed.notes.slice(0, input.count);
}

async function generateStructuredWithOpenAI(input: {
  prompt: string;
  bucketCount: number;
  notesPerBucket: number;
}): Promise<{ buckets: Array<{ name: string; notes: string[] }> }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_NOT_CONFIGURED");
  const model = process.env.OPENAI_MODEL?.trim() || process.env.OPENAI_LAB_MODEL?.trim() || DEFAULT_LAB_MODEL;
  const userPrompt = [
    `Style intent: ${input.prompt || "general realistic notes"}`,
    `Generate exactly ${input.bucketCount} buckets.`,
    `Generate exactly ${input.notesPerBucket} notes per bucket.`,
    "Output JSON only, matching the required schema."
  ].join("\n");

  const res = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.9,
      messages: [
        { role: "system", content: LAB_JSON_SYSTEM },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    })
  });
  const data = (await res.json()) as OpenAIChatResponse;
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `OPENAI_REQUEST_FAILED_${res.status}`);
  }
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  return parseStructuredJson(content);
}

export class LabService {
  private runs = new Map<string, LabRun>();
  private traces = new Map<string, LabTrace[]>();
  private decisions = new Map<string, LabDecision[]>();
  private cases = new Map<string, DatasetCase[]>();
  private runBucketIds = new Map<string, Set<string>>();
  private readonly storagePath: string;

  constructor(private readonly noteRepository: NoteRepository) {
    const here = dirname(fileURLToPath(import.meta.url));
    this.storagePath = resolve(here, "../.lab-data/lab-state.json");
    this.loadFromDisk();
  }

  private loadFromDisk() {
    try {
      if (!existsSync(this.storagePath)) return;
      const raw = readFileSync(this.storagePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedLabStateV1;
      if (!parsed || parsed.version !== 1) return;
      this.runs = new Map(parsed.runs.map((r) => [r.run_id, r]));
      this.traces = new Map(parsed.traces.map((r) => [r.run_id, r.rows]));
      this.decisions = new Map(parsed.decisions.map((r) => [r.run_id, r.rows]));
      this.cases = new Map(parsed.cases.map((r) => [r.run_id, r.rows]));
      this.runBucketIds = new Map(parsed.run_bucket_ids.map((r) => [r.run_id, new Set(r.ids)]));
    } catch {
      // Ignore corrupted/missing state and continue with fresh in-memory storage.
    }
  }

  private persistToDisk() {
    try {
      mkdirSync(dirname(this.storagePath), { recursive: true });
      const payload: PersistedLabStateV1 = {
        version: 1,
        runs: [...this.runs.values()],
        traces: [...this.traces.entries()].map(([run_id, rows]) => ({ run_id, rows })),
        decisions: [...this.decisions.entries()].map(([run_id, rows]) => ({ run_id, rows })),
        cases: [...this.cases.entries()].map(([run_id, rows]) => ({ run_id, rows })),
        run_bucket_ids: [...this.runBucketIds.entries()].map(([run_id, ids]) => ({ run_id, ids: [...ids] }))
      };
      writeFileSync(this.storagePath, JSON.stringify(payload, null, 2), "utf8");
    } catch {
      // Non-fatal for lab flows; keep app usable even if disk write fails.
    }
  }

  createRun(input: {
    tester_id?: string;
    algorithm_version?: string;
    dataset_source?: "default_fixture" | "prompt_generated";
  }): LabRun {
    const run_id = `run_${crypto.randomUUID()}`;
    const user_id = `lab_user_${run_id}`;
    const run: LabRun = {
      run_id,
      created_at: new Date().toISOString(),
      tester_id: input.tester_id?.trim() || "local-tester",
      algorithm_version: input.algorithm_version?.trim() || "dev",
      dataset_source: input.dataset_source ?? "default_fixture",
      embedding_mode: "openai_or_lexical",
      user_id
    };
    this.runs.set(run_id, run);
    this.traces.set(run_id, []);
    this.decisions.set(run_id, []);
    this.cases.set(run_id, []);
    const runBucketSet = new Set<string>();
    this.runBucketIds.set(run_id, runBucketSet);
    if (this.noteRepository instanceof InMemoryNoteRepository) {
      for (const name of FIXED_LAB_BUCKETS) {
        const id = this.noteRepository.seedCollection(user_id, { name });
        runBucketSet.add(id);
      }
    }
    this.persistToDisk();
    return run;
  }

  getRun(runId: string): LabRun | null {
    return this.runs.get(runId) ?? null;
  }

  listRuns(): LabRun[] {
    return [...this.runs.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async loadDefaultDataset(runId: string): Promise<{ collections_created: number; cases_created: number }> {
    const run = this.runs.get(runId);
    if (!run) throw new Error("RUN_NOT_FOUND");
    const repo = this.noteRepository;
    if (!(repo instanceof InMemoryNoteRepository)) {
      throw new Error("LAB_REQUIRES_INMEMORY_REPOSITORY");
    }
    const collectionIds: { name: string; id: string }[] = [];
    const runBuckets = this.runBucketIds.get(runId)!;
    for (const c of DEFAULT_DATASET.collections) {
      const id = repo.seedCollection(run.user_id, { name: c.name });
      runBuckets.add(id);
      collectionIds.push({ name: c.name, id });
      for (const noteText of c.notes) {
        const body: CreateCaptureBody = { type: "text", content: { text: noteText } };
        const entry = await repo.createDraft(body, run.user_id);
        await repo.confirmPlacementStub(run.user_id, entry.id, { kind: "collection", collection_id: id });
      }
    }
    const datasetCases = DEFAULT_DATASET.cases.map((c) => {
      const match = collectionIds.find((x) => x.name === c.expected_collection_name);
      return { ...c, expected_collection_name: match?.name ?? c.expected_collection_name };
    });
    this.cases.set(runId, datasetCases);
    this.persistToDisk();
    return { collections_created: collectionIds.length, cases_created: datasetCases.length };
  }

  async generateDataset(
    runId: string,
    input: { prompt: string; bucket_count?: number; notes_per_bucket?: number }
  ): Promise<{
    collections_created: number;
    cases_created: number;
    generation_source: "llm" | "fallback";
    generated: { buckets: Array<{ name: string; notes: string[] }> };
  }> {
    const run = this.runs.get(runId);
    if (!run) throw new Error("RUN_NOT_FOUND");
    const repo = this.noteRepository;
    if (!(repo instanceof InMemoryNoteRepository)) {
      throw new Error("LAB_REQUIRES_INMEMORY_REPOSITORY");
    }
    const bucketCount = Math.min(30, Math.max(3, input.bucket_count ?? 8));
    const notesPerBucket = Math.min(50, Math.max(3, input.notes_per_bucket ?? 12));
    let structured: { buckets: Array<{ name: string; notes: string[] }> };
    let generationSource: "llm" | "fallback" = "llm";
    try {
      structured = await generateStructuredWithOpenAI({
        prompt: input.prompt.trim() || "general productivity",
        bucketCount,
        notesPerBucket
      });
    } catch {
      generationSource = "fallback";
      structured = buildStructuredSynthetic(
        input.prompt.trim() || "general productivity",
        bucketCount,
        notesPerBucket
      );
    }
    const runBuckets = this.runBucketIds.get(runId)!;
    const bucketsWithoutNotes = structured.buckets.map((b) => ({ name: b.name, notes: [] as string[] }));
    for (const bucket of structured.buckets) {
      const name = bucket.name
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .slice(0, 3)
        .join(" ");
      const id = repo.seedCollection(run.user_id, { name });
      runBuckets.add(id);
    }
    this.cases.set(runId, []);
    this.persistToDisk();
    return {
      collections_created: structured.buckets.length,
      cases_created: 0,
      generation_source: generationSource,
      generated: { buckets: bucketsWithoutNotes }
    };
  }

  listCases(runId: string): DatasetCase[] {
    return this.cases.get(runId) ?? [];
  }

  async listBuckets(runId: string): Promise<LabBucketDetail[]> {
    const run = this.runs.get(runId);
    if (!run) throw new Error("RUN_NOT_FOUND");
    const collections = await this.noteRepository.listCollections(run.user_id);
    const include = this.runBucketIds.get(runId) ?? new Set<string>();
    const rows = await Promise.all(
      collections.filter((c) => include.has(c.id)).map(async (c) => {
        const entries = await this.noteRepository.listCollectionEntries(run.user_id, c.id);
        return {
          id: c.id,
          name: c.name,
          note_count: entries.length,
          notes: entries.map((e) => (e.content_text?.trim() || e.preview || "").trim()).filter((x) => x.length > 0)
        } satisfies LabBucketDetail;
      })
    );
    return rows.sort((a, b) => b.note_count - a.note_count || a.name.localeCompare(b.name));
  }

  async addBucket(runId: string, name: string): Promise<CollectionSummary> {
    const run = this.runs.get(runId);
    if (!run) throw new Error("RUN_NOT_FOUND");
    const repo = this.noteRepository;
    if (!(repo instanceof InMemoryNoteRepository)) {
      throw new Error("LAB_REQUIRES_INMEMORY_REPOSITORY");
    }
    const id = repo.seedCollection(run.user_id, { name: name.trim() || "Untitled bucket" });
    this.runBucketIds.get(runId)?.add(id);
    const all = await this.noteRepository.listCollections(run.user_id);
    const created = all.find((c) => c.id === id);
    if (!created) throw new Error("LAB_INTERNAL_ERROR");
    this.persistToDisk();
    return created;
  }

  async addNoteToBucket(runId: string, input: { collection_id: string; text: string }) {
    const run = this.runs.get(runId);
    if (!run) throw new Error("RUN_NOT_FOUND");
    const collections = await this.noteRepository.listCollections(run.user_id);
    const allowed = this.runBucketIds.get(runId) ?? new Set<string>();
    const target = collections.find((c) => c.id === input.collection_id && allowed.has(c.id));
    if (!target) throw new Error("COLLECTION_NOT_FOUND");
    const entry = await this.noteRepository.createDraft(
      { type: "text", content: { text: input.text.trim() } },
      run.user_id
    );
    await this.noteRepository.confirmPlacementStub(run.user_id, entry.id, {
      kind: "collection",
      collection_id: target.id
    });
    this.persistToDisk();
    return { entry_id: entry.id, collection_id: target.id };
  }

  async generateNotesForBucket(
    runId: string,
    input: { collection_id: string; prompt: string; count?: number }
  ): Promise<{ inserted: number }> {
    const run = this.runs.get(runId);
    if (!run) throw new Error("RUN_NOT_FOUND");
    const collections = await this.noteRepository.listCollections(run.user_id);
    const allowed = this.runBucketIds.get(runId) ?? new Set<string>();
    const target = collections.find((c) => c.id === input.collection_id && allowed.has(c.id));
    if (!target) throw new Error("COLLECTION_NOT_FOUND");
    const count = Math.min(30, Math.max(1, input.count ?? 8));
    const baseWords = cleanPromptWords(input.prompt.trim() || target.name);
    let notes: string[];
    try {
      notes = await generateNotesForBucketWithOpenAI({
        bucketName: target.name,
        stylePrompt: input.prompt,
        count
      });
    } catch {
      notes = Array.from({ length: count }).map((_, i) =>
        makeNoisyNote([...target.name.toLowerCase().split(/\s+/), ...baseWords], i)
      );
    }
    for (const text of notes) {
      const entry = await this.noteRepository.createDraft(
        { type: "text", content: { text } },
        run.user_id
      );
      await this.noteRepository.confirmPlacementStub(run.user_id, entry.id, {
        kind: "collection",
        collection_id: target.id
      });
    }
    this.persistToDisk();
    return { inserted: count };
  }

  async generateNotesForBuckets(
    runId: string,
    input: { collection_ids: string[]; prompt: string; count_per_bucket?: number }
  ): Promise<{ inserted: number; buckets_touched: number }> {
    const run = this.runs.get(runId);
    if (!run) throw new Error("RUN_NOT_FOUND");
    const collections = await this.noteRepository.listCollections(run.user_id);
    const allowed = this.runBucketIds.get(runId) ?? new Set<string>();
    const validIds = [...new Set(input.collection_ids)].filter((id) =>
      collections.some((c) => c.id === id && allowed.has(c.id))
    );
    if (validIds.length === 0) throw new Error("COLLECTION_NOT_FOUND");
    const count = Math.min(30, Math.max(1, input.count_per_bucket ?? 8));
    let inserted = 0;
    const promptWords = cleanPromptWords(input.prompt);
    for (const collectionId of validIds) {
      const target = collections.find((c) => c.id === collectionId)!;
      const baseWords = [...target.name.toLowerCase().split(/\s+/), ...promptWords];
      let notes: string[];
      try {
        notes = await generateNotesForBucketWithOpenAI({
          bucketName: target.name,
          stylePrompt: input.prompt,
          count
        });
      } catch {
        notes = Array.from({ length: count }).map((_, i) => makeNoisyNote(baseWords, i + inserted));
      }
      for (const text of notes) {
        const entry = await this.noteRepository.createDraft(
          { type: "text", content: { text } },
          run.user_id
        );
        await this.noteRepository.confirmPlacementStub(run.user_id, entry.id, {
          kind: "collection",
          collection_id: target.id
        });
        inserted += 1;
      }
    }
    this.persistToDisk();
    return { inserted, buckets_touched: validIds.length };
  }

  async runCaptureTest(runId: string, input: { capture_text: string; hints?: SuggestionsRequest["hints"] }): Promise<LabTrace> {
    const run = this.runs.get(runId);
    if (!run) throw new Error("RUN_NOT_FOUND");
    const start = Date.now();
    const entry = await this.noteRepository.createDraft(
      { type: "text", content: { text: input.capture_text } },
      run.user_id
    );
    const allowed = this.runBucketIds.get(runId) ?? new Set<string>();
    const collections = (await this.noteRepository.listCollections(run.user_id)).filter((c) => allowed.has(c.id));
    const entryText = toPreviewText(input.capture_text);
    if (collections.length === 0) {
      const trace: LabTrace = {
        trace_id: `trace_${crypto.randomUUID()}`,
        run_id: runId,
        created_at: new Date().toISOString(),
        entry_id: entry.id,
        entry_text: entryText,
        source: "cold_start",
        latency_ms: Date.now() - start,
        top1_score: null,
        top2_score: null,
        margin: null,
        candidates: []
      };
      this.traces.get(runId)?.push(trace);
      this.persistToDisk();
      return trace;
    }

    const queryInput = buildQueryEmbeddingText(entryText);
    const profileTexts = await Promise.all(
      collections.map(async (c) => {
        const previews = await this.noteRepository.listRecentPlacedPreviews(run.user_id, c.id, ROLLING_NOTE_LIMIT);
        return buildCollectionProfileText(c.name, previews);
      })
    );
    const vectors = await embedTextsDefault([queryInput, ...profileTexts]);
    const ranked = rankCollectionsByEmbedding(
      collections,
      vectors[0] ?? [],
      vectors.slice(1),
      input.hints?.recent_collection_ids
    );
    const displayScores = fusedScoresToDisplayScores(ranked.map((r) => r.fusedScore));
    const topCandidates = ranked.slice(0, 10);
    const noteCounts = await Promise.all(
      topCandidates.map(async (r) => {
        const entries = await this.noteRepository.listCollectionEntries(run.user_id, r.collection.id);
        return entries.length;
      })
    );
    const candidates: LabCandidateScore[] = topCandidates.map((r, i) => ({
      rank: i + 1,
      collection_id: r.collection.id,
      collection_name: r.collection.name,
      collection_note_count: noteCounts[i] ?? 0,
      score: displayScores[i] ?? 0,
      semantic_score: r.semanticScore,
      fused_score: r.fusedScore
    }));
    const trace: LabTrace = {
      trace_id: `trace_${crypto.randomUUID()}`,
      run_id: runId,
      created_at: new Date().toISOString(),
      entry_id: entry.id,
      entry_text: entryText,
      source: "model",
      latency_ms: Date.now() - start,
      top1_score: candidates[0]?.score ?? null,
      top2_score: candidates[1]?.score ?? null,
      margin:
        candidates[0]?.score !== undefined && candidates[1]?.score !== undefined
          ? (candidates[0].score - candidates[1].score)
          : null,
      candidates
    };
    this.traces.get(runId)?.push(trace);
    this.persistToDisk();
    return trace;
  }

  async submitDecision(
    runId: string,
    input: Omit<LabDecision, "decision_id" | "run_id" | "created_at">
  ): Promise<LabDecision> {
    const run = this.runs.get(runId);
    if (!run) throw new Error("RUN_NOT_FOUND");
    const allowed = this.runBucketIds.get(runId) ?? new Set<string>();
    let selectedCount: number | null = null;
    if (input.selected_kind === "collection" && input.selected_collection_id && allowed.has(input.selected_collection_id)) {
      const entries = await this.noteRepository.listCollectionEntries(run.user_id, input.selected_collection_id);
      selectedCount = entries.length;
    } else if (input.selected_kind === "create_new") {
      selectedCount = null;
    } else {
      selectedCount = input.selected_collection_note_count ?? null;
    }
    const row: LabDecision = {
      decision_id: `decision_${crypto.randomUUID()}`,
      run_id: runId,
      created_at: new Date().toISOString(),
      ...input,
      selected_collection_note_count: selectedCount
    };
    this.decisions.get(runId)?.push(row);
    this.persistToDisk();
    return row;
  }

  listTraces(runId: string): LabTrace[] {
    if (!this.runs.has(runId)) throw new Error("RUN_NOT_FOUND");
    return this.traces.get(runId) ?? [];
  }

  listDecisions(runId: string): LabDecision[] {
    if (!this.runs.has(runId)) throw new Error("RUN_NOT_FOUND");
    return this.decisions.get(runId) ?? [];
  }

  getMetrics(runId: string): LabMetrics {
    if (!this.runs.has(runId)) throw new Error("RUN_NOT_FOUND");
    const traces = this.traces.get(runId) ?? [];
    const decisions = this.decisions.get(runId) ?? [];
    const traceById = new Map(traces.map((t) => [t.trace_id, t]));
    const judged = decisions.filter((d) => traceById.has(d.trace_id));
    const top1 = judged.filter((d) => d.selected_rank === 1).length;
    const hit3 = judged.filter((d) => (d.selected_rank ?? 999) <= 3).length;
    const mrr = judged.length
      ? judged.reduce((s, d) => s + (d.selected_rank ? 1 / d.selected_rank : 0), 0) / judged.length
      : 0;
    const fallbackRate = traces.length
      ? traces.filter((t) => t.source === "fallback").length / traces.length
      : 0;
    return {
      traces: traces.length,
      decisions: decisions.length,
      hit_at_1: judged.length ? top1 / judged.length : 0,
      hit_at_3: judged.length ? hit3 / judged.length : 0,
      mrr,
      fallback_rate: fallbackRate,
      p95_latency_ms: percentile(traces.map((t) => t.latency_ms), 95)
    };
  }

  static mapError(error: unknown): { status: number; code: string; message: string } {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (message === "RUN_NOT_FOUND") return { status: 404, code: "RUN_NOT_FOUND", message: "Run not found" };
    if (message === "COLLECTION_NOT_FOUND") {
      return { status: 404, code: "COLLECTION_NOT_FOUND", message: "Collection not found" };
    }
    if (message === "LAB_REQUIRES_INMEMORY_REPOSITORY") {
      return {
        status: 422,
        code: "LAB_UNSUPPORTED_REPOSITORY",
        message: "Lab endpoints currently require InMemoryNoteRepository"
      };
    }
    return { status: 500, code: "LAB_INTERNAL_ERROR", message: "Unexpected lab error" };
  }
}

export function isInMemoryRepository(repo: NoteRepository): repo is InMemoryNoteRepository {
  return repo instanceof InMemoryNoteRepository;
}

