export interface PromptCollectionContext {
  id: string;
  name: string;
  summary?: string;
  last_activity_at?: string;
}

export interface PromptCorrectionHint {
  from_collection: string;
  to_collection: string;
  note: string;
}

/** Optional URL metadata (e.g. from UrlEnrichmentService) to ground link-heavy notes. */
export interface PromptUrlContextItem {
  url: string;
  title_hint?: string;
}

export interface PromptCaptureInput {
  type: "text" | "image";
  text?: string;
  image_summary?: string;
  /** Public URLs found in the capture; helps the model separate “link as reference” from topic. */
  urls_in_capture?: string[];
  /** Short hints per URL (titles or hostname-derived labels); prefer these over guessing from bare URLs. */
  url_context?: PromptUrlContextItem[];
}

export interface PromptMessages {
  system: string;
  user: string;
}

const JSON_SCHEMA_BLOCK = `{
  "top_choice": "<string: one collection id from candidates or exactly CREATE_NEW>",
  "alternatives": ["<string: same id rules, 0 to 4 entries, no duplicates>"],
  "confidence_score": <number between 0.0 and 1.0 inclusive, not a string>,
  "reason_short": "<string, max 140 characters, no newlines>"
}`;

function confidenceCalibrationBlock(): string {
  return [
    "Confidence calibration (use these bands; stay consistent):",
    "- 0.85–1.0: Clear, direct match (explicit topic/entities align with one collection name or summary).",
    "- 0.65–0.84: Good fit but some uncertainty (partial overlap, generic phrasing, or weak collection summaries).",
    "- 0.45–0.64: Weak or ambiguous; multiple collections plausible or evidence is thin.",
    "- Below 0.45: Prefer top_choice CREATE_NEW unless a candidate is still clearly best; never fake high confidence.",
    "If you would choose a different top_choice on a second read, cap confidence at 0.64 and put both ids in alternatives (before CREATE_NEW)."
  ].join("\n");
}

function structuredOutputRules(): string {
  return [
    "Structured output (machine parsing):",
    "- Reply with one JSON object only — no markdown, no code fences, no commentary before or after.",
    "- Use double-quoted keys and string values exactly as JSON requires.",
    "- confidence_score must be a JSON number (e.g. 0.72), not \"0.72\".",
    "- alternatives must be a JSON array (use [] if none). Max length 4; never repeat top_choice.",
    "- top_choice and every alternative must be either CREATE_NEW or an id that appears in Candidate collections.",
    "- Include all four keys; use empty alternatives [] when there are no plausible runners-up.",
    "- reason_short: state the strongest evidence in ≤140 characters; if ambiguous, say what is ambiguous."
  ].join("\n");
}

function ambiguityRules(): string {
  return [
    "Ambiguity and conflicts:",
    "- If two collections fit equally well, pick the narrower/more specific one when clearly warranted; otherwise prefer CREATE_NEW with confidence ≤0.64.",
    "- Correction hints override loose keyword overlap: if a hint says X→Y for this kind of content, favor Y (or CREATE_NEW if none match Y).",
    "- Short or generic notes (“todo”, “idea”, “link”) → lower confidence and often CREATE_NEW unless a collection summary clearly defines scope.",
    "- Do not stretch a collection name to fit; when in doubt, CREATE_NEW."
  ].join("\n");
}

function urlAndImageRules(): string {
  return [
    "URLs and images:",
    "- Treat URLs in text as evidence: path segments, query topics, registrable domain, and any url_context title_hint carry semantic weight.",
    "- A URL alone without surrounding text is weak evidence; combine with hostname/path hints and url_context if present.",
    "- Ignore tracking noise (utm_*, hash-only fragments) when inferring topic.",
    "- For type \"image\", rely on image_summary as partial evidence; it may be incomplete — lower confidence when the summary is vague.",
    "- Do not fetch or invent page content beyond what is provided in capture text, image_summary, or url_context."
  ].join("\n");
}

function formatCaptureForPrompt(capture: PromptCaptureInput): Record<string, unknown> {
  const { urls_in_capture, url_context, ...rest } = capture;
  const out: Record<string, unknown> = { ...rest };
  if (urls_in_capture?.length) out.urls_in_capture = urls_in_capture;
  if (url_context?.length) out.url_context = url_context;
  return out;
}

export function buildCategorizationPrompt(
  capture: PromptCaptureInput,
  collections: PromptCollectionContext[],
  correctionHints: PromptCorrectionHint[]
): PromptMessages {
  const system = [
    "You classify one captured note into exactly one primary bucket: an existing collection id from the candidate list, or CREATE_NEW.",
    structuredOutputRules(),
    ambiguityRules(),
    confidenceCalibrationBlock(),
    urlAndImageRules(),
    "Never invent collection ids. Only use ids present in the user message candidate list or CREATE_NEW.",
    "Favor the collection whose name/summary best matches the user's probable intent, not incidental wording.",
    "Required JSON shape (example placeholders, not literal values):",
    JSON_SCHEMA_BLOCK
  ].join("\n\n");

  const user = [
    "Capture payload (classify this):",
    JSON.stringify(formatCaptureForPrompt(capture), null, 2),
    "",
    "Candidate collections (ids are authoritative):",
    JSON.stringify(collections, null, 2),
    "",
    "Recent correction hints (higher priority than vague keyword matches):",
    JSON.stringify(correctionHints, null, 2),
    "",
    "Output checklist:",
    "- Set top_choice to the single best collection id or CREATE_NEW.",
    "- alternatives: up to 4 other plausible ids or CREATE_NEW, ordered by plausibility; must not include top_choice.",
    "- If top_choice is CREATE_NEW, alternatives may list the closest near-miss collections (still max 4).",
    "- Apply confidence bands from the system message; use CREATE_NEW when no candidate reaches at least a 0.45-level fit.",
    "- reason_short must justify top_choice in one line (≤140 chars)."
  ].join("\n");

  return { system, user };
}
