import { clampScore, CONFIDENCE_POLICY_VERSION, scoreToLabelV1 } from "./confidence-policy.js";
import type { CollectionSummary, NoteRepository } from "./note-repository.js";
import type { SuggestionsRequest } from "./suggestion-schema.js";
import { UrlEnrichmentService, type EnrichedUrl } from "./url-enrichment.js";

export interface SuggestionOptionCollection {
  kind: "collection";
  collection: CollectionSummary;
  rank: number;
  score: number;
}

export interface SuggestionOptionCreateNew {
  kind: "create_new";
  rank: number;
  score: number;
  suggested_name: string;
}

export type SuggestionOption = SuggestionOptionCollection | SuggestionOptionCreateNew;

export interface SuggestionsResponseBody {
  entry_id: string;
  source: "model" | "fallback" | "cold_start";
  confidence: { score: number; label: string; policy_version: string };
  top_option: SuggestionOption;
  alternatives: SuggestionOption[];
  reason_short: string;
  generated_at: string;
}

export interface SuggestionServiceOptions {
  forceFallback?: boolean;
}

function suggestedNamesFromText(text: string | undefined): string[] {
  const raw = (text ?? "").trim() || "Notes";
  const words = raw.split(/\s+/).slice(0, 8).join(" ");
  const primary = words.length > 56 ? `${words.slice(0, 53)}...` : words;
  const secondary = primary.length > 0 ? `${primary} (shortlist)` : "Quick capture";
  return [primary, secondary, "Inbox"].filter((n, i, a) => a.indexOf(n) === i).slice(0, 3);
}

function orderCollections(
  collections: CollectionSummary[],
  recentIds: string[] | undefined
): CollectionSummary[] {
  const byId = new Map(collections.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const ordered: CollectionSummary[] = [];
  for (const id of recentIds ?? []) {
    const c = byId.get(id);
    if (c && !seen.has(c.id)) {
      ordered.push(c);
      seen.add(c.id);
    }
  }
  const rest = collections.filter((c) => !seen.has(c.id)).sort((a, b) => (a.last_activity_at < b.last_activity_at ? 1 : -1));
  return [...ordered, ...rest];
}

function scoreCollection(index: number, fallback: boolean): number {
  const base = Math.max(0.15, 0.88 - index * 0.11);
  return clampScore(fallback ? base * 0.65 : base);
}

export class SuggestionService {
  private readonly urlEnrichment = new UrlEnrichmentService();

  constructor(
    private readonly repo: NoteRepository,
    private readonly options?: SuggestionServiceOptions
  ) {}

  async buildSuggestions(
    userId: string,
    entryId: string,
    body: SuggestionsRequest
  ): Promise<SuggestionsResponseBody> {
    const collections = await this.repo.listCollections(userId);
    const preview = await this.repo.getDraftTextPreview(userId, entryId);
    const enrichedUrls = preview ? await this.urlEnrichment.enrichFromText(preview) : [];
    const generated_at = new Date().toISOString();

    if (this.options?.forceFallback) {
      return this.buildFallback(entryId, collections, body, preview, enrichedUrls, generated_at);
    }

    if (collections.length === 0) {
      return this.buildColdStart(entryId, preview, generated_at);
    }

    return this.buildModel(entryId, collections, body, preview, enrichedUrls, generated_at);
  }

  private buildColdStart(entryId: string, preview: string | undefined, generated_at: string): SuggestionsResponseBody {
    const names = suggestedNamesFromText(preview);
    const topName = names[0] ?? "Notes";
    const restNames = names.slice(1);
    const topScore = clampScore(0.42);
    const top_option: SuggestionOptionCreateNew = {
      kind: "create_new",
      rank: 1,
      score: topScore,
      suggested_name: topName
    };
    const alternatives: SuggestionOption[] = restNames.map((name, i) => ({
      kind: "create_new" as const,
      rank: i + 2,
      score: clampScore(topScore - 0.04 * (i + 1)),
      suggested_name: name
    }));
    return {
      entry_id: entryId,
      source: "cold_start",
      confidence: {
        score: topScore,
        label: scoreToLabelV1(topScore),
        policy_version: CONFIDENCE_POLICY_VERSION
      },
      top_option,
      alternatives,
      reason_short: "No collections yet — start with a new list.",
      generated_at
    };
  }

  private buildFallback(
    entryId: string,
    collections: CollectionSummary[],
    body: SuggestionsRequest,
    preview: string | undefined,
    enrichedUrls: EnrichedUrl[],
    generated_at: string
  ): SuggestionsResponseBody {
    const ordered = orderCollections(collections, body.hints?.recent_collection_ids);
    const confScore = clampScore(0.3);
    const collectionOptions: SuggestionOptionCollection[] = ordered.map((c, i) => ({
      kind: "collection",
      collection: c,
      rank: i + 1,
      score: scoreCollection(i, true)
    }));
    const suggested = (preview ?? "Notes").split(/\s+/).slice(0, 5).join(" ") || "New collection";
    const createNew: SuggestionOptionCreateNew = {
      kind: "create_new",
      rank: collectionOptions.length + 1,
      score: clampScore(0.28),
      suggested_name: suggested.length > 80 ? suggested.slice(0, 77) + "..." : suggested
    };
    const top_option = collectionOptions[0] ?? createNew;
    const alternatives: SuggestionOption[] =
      collectionOptions.length > 0 ? [...collectionOptions.slice(1), createNew] : [];

    return {
      entry_id: entryId,
      source: "fallback",
      confidence: {
        score: confScore,
        label: "uncertain",
        policy_version: CONFIDENCE_POLICY_VERSION
      },
      top_option,
      alternatives,
      reason_short: withLinkHint("Heuristic ranking while the model path is unavailable.", enrichedUrls),
      generated_at
    };
  }

  private buildModel(
    entryId: string,
    collections: CollectionSummary[],
    body: SuggestionsRequest,
    preview: string | undefined,
    enrichedUrls: EnrichedUrl[],
    generated_at: string
  ): SuggestionsResponseBody {
    const ordered = orderCollections(collections, body.hints?.recent_collection_ids);
    const collectionOptions: SuggestionOptionCollection[] = ordered.map((c, i) => ({
      kind: "collection",
      collection: c,
      rank: i + 1,
      score: scoreCollection(i, false)
    }));
    const top = collectionOptions[0]!;
    const topScore = top.score;
    const suggested = (preview ?? "Notes").split(/\s+/).slice(0, 5).join(" ") || "New collection";
    const createNew: SuggestionOptionCreateNew = {
      kind: "create_new",
      rank: collectionOptions.length + 1,
      score: clampScore(Math.max(0.2, topScore - 0.18)),
      suggested_name: suggested.length > 80 ? suggested.slice(0, 77) + "..." : suggested
    };
    const alternatives: SuggestionOption[] = [...collectionOptions.slice(1), createNew];
    return {
      entry_id: entryId,
      source: "model",
      confidence: {
        score: topScore,
        label: scoreToLabelV1(topScore),
        policy_version: CONFIDENCE_POLICY_VERSION
      },
      top_option: top,
      alternatives,
      reason_short: withLinkHint("Based on your capture and recent activity.", enrichedUrls),
      generated_at
    };
  }
}

function withLinkHint(base: string, enrichedUrls: EnrichedUrl[]): string {
  if (enrichedUrls.length === 0) return base;
  const domains = enrichedUrls.map((u) => u.hostname.replace(/^www\./, ""));
  const uniqueDomains = [...new Set(domains)];
  return `${base} Includes ${enrichedUrls.length} link reference(s) from ${uniqueDomains.join(", ")}.`;
}
