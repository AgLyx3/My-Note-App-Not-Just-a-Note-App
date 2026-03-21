const DEFAULT_MODEL = "gpt-4o-mini";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

export class OpenAINotConfiguredError extends Error {
  constructor() {
    super("OPENAI_NOT_CONFIGURED");
    this.name = "OpenAINotConfiguredError";
  }
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

/**
 * Uses OpenAI vision to extract readable text from an image (base64 + mime).
 */
export async function extractTextWithOpenAI(input: { base64: string; mimeType: string }): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new OpenAINotConfiguredError();
  }

  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
  const dataUrl = `data:${input.mimeType};base64,${input.base64}`;

  const res = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract all readable text from this image. Output plain text only, no markdown or commentary. If there is no text, return an empty string."
            },
            {
              type: "image_url",
              image_url: { url: dataUrl }
            }
          ]
        }
      ],
      max_tokens: 4096
    })
  });

  const data = (await res.json()) as OpenAIChatResponse;

  if (!res.ok) {
    const msg = data?.error?.message ?? `OpenAI request failed (${res.status})`;
    throw new Error(msg);
  }

  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  return text;
}
