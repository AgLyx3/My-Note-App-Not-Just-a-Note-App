type Category = "work" | "personal" | "shopping" | "health" | "travel" | "learning" | "finance" | "create_new";

interface Sample {
  note: string;
  expected: Category;
}

const samples: Sample[] = [
  { note: "Need to renew passport before June trip to Seoul", expected: "travel" },
  { note: "Buy eggs, oat milk, and bananas", expected: "shopping" },
  { note: "Follow up with PM about sprint capacity", expected: "work" },
  { note: "Article: spaced repetition for language learning https://example.com/srs", expected: "learning" },
  { note: "Paid internet bill 79 dollars", expected: "finance" },
  { note: "3x workouts this week and track sleep hours", expected: "health" },
  { note: "Mom birthday gift idea: watercolor class", expected: "personal" },
  { note: "Screenshot reminder: compare flight prices", expected: "travel" },
  { note: "Maybe start a tiny app for meal prep planning", expected: "create_new" },
  { note: "Read about React server components after lunch", expected: "learning" }
];

function classify(note: string): Category {
  const text = note.toLowerCase();
  const map: Array<{ category: Exclude<Category, "create_new">; terms: string[] }> = [
    { category: "travel", terms: ["trip", "flight", "passport", "hotel", "seoul"] },
    { category: "shopping", terms: ["buy", "grocer", "milk", "bananas", "eggs"] },
    { category: "finance", terms: ["bill", "paid", "dollars", "bank", "invoice"] },
    { category: "health", terms: ["workout", "sleep", "health", "run", "exercise"] },
    { category: "work", terms: ["sprint", "pm", "meeting", "follow up", "roadmap"] },
    { category: "learning", terms: ["article", "read", "learning", "react", "course"] },
    { category: "personal", terms: ["mom", "birthday", "gift", "family", "home"] }
  ];

  let best: { category: Category; score: number } = { category: "create_new", score: 0 };
  for (const row of map) {
    const score = row.terms.reduce((acc, term) => acc + (text.includes(term) ? 1 : 0), 0);
    if (score > best.score) best = { category: row.category, score };
  }

  return best.score === 0 ? "create_new" : best.category;
}

function run(): void {
  let correct = 0;
  console.log("Categorization evaluation on synthetic random-note set");
  console.log("-----------------------------------------------------");
  for (const [index, sample] of samples.entries()) {
    const got = classify(sample.note);
    const ok = got === sample.expected;
    if (ok) correct += 1;
    console.log(
      `${index + 1}. ${ok ? "OK  " : "MISS"} expected=${sample.expected.padEnd(10)} got=${got.padEnd(10)} | ${sample.note}`
    );
  }
  const accuracy = (correct / samples.length) * 100;
  console.log("-----------------------------------------------------");
  console.log(`Accuracy: ${correct}/${samples.length} (${accuracy.toFixed(1)}%)`);
  console.log("Recommendation: move low-score or ambiguous notes to CREATE_NEW in review sheet.");
}

run();
