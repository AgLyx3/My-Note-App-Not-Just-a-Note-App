/**
 * Offline ranking evaluation: seed fake user + collections + notes, run real SuggestionService,
 * score Hit@1 / Hit@3 / MRR vs labeled expected_collection_name.
 *
 * Usage (from backend/):
 *   npx tsx scripts/evaluate-ranking.ts
 *   npx tsx scripts/evaluate-ranking.ts --fixture test/fixtures/ranking-eval-smoke.json
 *   npx tsx scripts/evaluate-ranking.ts --stress --limit 5
 *   OPENAI_API_KEY=... npx tsx scripts/evaluate-ranking.ts   # uses embeddings
 *
 * Without OPENAI_API_KEY, uses lexical fallback inside embedTextsDefault (cheap, weaker signal).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateMetrics,
  type RankingEvalFixture,
  runRankingCase,
  seedRankingFixture
} from "../src/ranking-eval-harness.js";
import { InMemoryNoteRepository } from "../src/note-repository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STRESS_THEMES = [
  "astrophysics",
  "gardening",
  "jazz",
  "kubernetes",
  "watercolor",
  "marathon",
  "typescript",
  "fermentation",
  "blockchain",
  "origami",
  "sailing",
  "meditation",
  "robotics",
  "camping",
  "chess"
] as const;

function buildStressFixture(limitCollections: number, notesPerCollection: number): RankingEvalFixture {
  const n = Math.min(limitCollections, STRESS_THEMES.length);
  const collections = [];
  for (let c = 0; c < n; c++) {
    const theme = STRESS_THEMES[c]!;
    const name = `Bucket_${String(c).padStart(2, "0")}_${theme}`;
    const notes: string[] = [];
    for (let i = 0; i < notesPerCollection; i++) {
      notes.push(`${theme} note ${i}: context about ${theme} projects and ideas`);
    }
    collections.push({ name, notes });
  }
  const cases = collections.map((col, i) => ({
    id: `stress_${i}`,
    query: `Need to research ${STRESS_THEMES[i]} reading list and next steps`,
    expected_collection_name: col.name
  }));
  return { collections, cases };
}

function parseArgs(argv: string[]): {
  fixturePath: string | null;
  stress: boolean;
  stressLimit: number;
  notesPerCollection: number;
  json: boolean;
} {
  let fixturePath: string | null = null;
  let stress = false;
  let stressLimit = 15;
  let notesPerCollection = 15;
  let json = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--fixture" && argv[i + 1]) {
      fixturePath = argv[++i]!;
    } else if (a === "--stress") {
      stress = true;
    } else if (a === "--limit" && argv[i + 1]) {
      stressLimit = Number(argv[++i]!);
    } else if (a === "--notes-per-collection" && argv[i + 1]) {
      notesPerCollection = Number(argv[++i]!);
    } else if (a === "--json") {
      json = true;
    }
  }
  return { fixturePath, stress, stressLimit, notesPerCollection, json };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const defaultFixture = path.join(__dirname, "../test/fixtures/ranking-eval-smoke.json");

  let fixture: RankingEvalFixture;
  if (args.stress) {
    fixture = buildStressFixture(args.stressLimit, args.notesPerCollection);
  } else {
    const fp = args.fixturePath ?? defaultFixture;
    const raw = readFileSync(fp, "utf-8");
    fixture = JSON.parse(raw) as RankingEvalFixture;
  }

  const userId = "ranking_eval_user";
  const repo = new InMemoryNoteRepository({ seedDefaultCollections: false });
  const { nameToId } = await seedRankingFixture(repo, userId, fixture);

  const rows = [];
  for (const c of fixture.cases) {
    const row = await runRankingCase(repo, userId, nameToId, c);
    rows.push(row);
  }

  const agg = aggregateMetrics(rows);

  if (args.json) {
    console.log(JSON.stringify({ aggregate: agg, cases: rows }, null, 2));
    return;
  }

  console.log("Ranking evaluation");
  console.log("==================");
  console.log(`Cases: ${rows.length} | collections seeded: ${fixture.collections.length}`);
  console.log(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY?.trim() ? "set (embeddings API)" : "unset (lexical vectors)"}`);
  console.log("");
  for (const r of rows) {
    console.log(
      `[${r.caseId}] rank=${r.rank ?? "MISS"} hit@1=${r.hitAt1} | expected=${r.expectedName} | source=${r.source}`
    );
    console.log(`  query: ${r.query.slice(0, 80)}${r.query.length > 80 ? "…" : ""}`);
    console.log(`  top5:  ${r.top5Names.join(" → ")}`);
  }
  console.log("");
  console.log("Aggregate");
  console.log(`  Hit@1: ${(agg.hitAt1 * 100).toFixed(1)}%`);
  console.log(`  Hit@3: ${(agg.hitAt3 * 100).toFixed(1)}%`);
  console.log(`  Hit@5: ${(agg.hitAt5 * 100).toFixed(1)}%`);
  console.log(`  MRR:   ${agg.mrr.toFixed(3)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
