const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

interface OpenAIEmbeddingItem {
  embedding?: number[];
  index?: number;
}

interface OpenAIEmbeddingsResponse {
  data?: OpenAIEmbeddingItem[];
  error?: { message?: string };
}

/**
 * Batch text embeddings via OpenAI. Preserves input order in returned vectors.
 */
export async function embedTextsOpenAI(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  if (texts.length === 0) return [];

  const model = process.env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;

  const res = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model, input: texts })
  });

  const data = (await res.json()) as OpenAIEmbeddingsResponse;

  if (!res.ok) {
    const msg = data?.error?.message ?? `OpenAI embeddings failed (${res.status})`;
    throw new Error(msg);
  }

  const items = data.data ?? [];
  const sorted = [...items].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    const emb = sorted[i]?.embedding;
    if (!emb?.length) {
      throw new Error("OpenAI embeddings response missing vector");
    }
    out.push(emb);
  }
  return out;
}
