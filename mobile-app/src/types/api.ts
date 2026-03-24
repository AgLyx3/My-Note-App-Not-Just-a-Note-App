export type EntryType = "text" | "image";
export type ConfidenceLabel = "likely" | "possible" | "uncertain";
export type SuggestionSource = "model" | "fallback" | "cold_start";

export interface CaptureEntry {
  id: string;
  type: EntryType;
  status: "draft" | "placed";
  created_at: string;
}

export interface CreateCaptureRequest {
  type: "text";
  content: {
    text: string;
    /** When set, keep the image alongside the text note (e.g. gallery thumbnail). */
    image_storage_path?: string;
    /** Optional image-only capture context from image flow. */
    image_context?: string;
  };
}

export interface CreateImageCaptureRequest {
  type: "image";
  content: {
    storage_path: string;
  };
}

export type CreateCapturePayload = CreateCaptureRequest | CreateImageCaptureRequest;

export interface SuggestionOptionCollection {
  kind: "collection";
  collection: { id: string; name: string; last_activity_at: string };
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

export interface SuggestionsResponse {
  entry_id: string;
  source: SuggestionSource;
  confidence: { score: number; label: ConfidenceLabel; policy_version: string };
  top_option: SuggestionOption;
  alternatives: SuggestionOption[];
  reason_short: string;
  generated_at: string;
}

export type ConfirmSelection =
  | { kind: "collection"; collection_id: string }
  | { kind: "create_new"; new_collection_name: string };

export interface ConfirmPlacementResponse {
  placement: {
    id: string;
    entry_id: string;
    action_type: "confirm";
    to_collection_id: string;
    created_at: string;
    undo_expires_at: string;
  };
  entry: {
    id: string;
    collection_id: string;
    status: "placed";
    updated_at: string;
  };
  collection: {
    id: string;
    name: string;
    last_activity_at: string;
  };
}

export interface MoveEntryResponse {
  placement: {
    id: string;
    entry_id: string;
    action_type: "move";
    from_collection_id: string | null;
    to_collection_id: string;
    created_at: string;
    undo_expires_at: string;
  };
  entry: {
    id: string;
    collection_id: string;
    updated_at: string;
  };
}

export interface UndoPlacementResponse {
  placement: {
    id: string;
    action_type: "undo";
    reverted_placement_id: string;
    created_at: string;
  };
  entry: {
    id: string;
    collection_id: string | null;
    updated_at: string;
  };
}

export interface CollectionSummary {
  id: string;
  name: string;
  last_activity_at: string;
  note_count: number;
}

export interface CollectionEntrySummary {
  id: string;
  type: EntryType;
  status: "draft" | "placed";
  created_at: string;
  updated_at?: string;
  preview: string;
  image_uri?: string;
  content_text?: string;
}

export interface UpdateEntryResponse {
  entry: CollectionEntrySummary;
}

export interface RenameCollectionResponse {
  collection: {
    id: string;
    name: string;
    last_activity_at: string;
  };
}
