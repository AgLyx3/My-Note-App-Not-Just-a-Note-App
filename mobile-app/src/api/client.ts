import type {
  CollectionEntrySummary,
  CollectionSummary,
  CreateCapturePayload,
  ConfirmPlacementResponse,
  ConfirmSelection,
  MoveEntryResponse,
  SuggestionsResponse,
  UndoPlacementResponse,
  UpdateEntryResponse,
  RenameCollectionResponse
} from "../types/api";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3001/v1";
const DEV_AUTH = process.env.EXPO_PUBLIC_DEV_AUTH_TOKEN ?? "u1";

function randomHex(length: number): string {
  let value = "";
  const alphabet = "0123456789abcdef";
  for (let i = 0; i < length; i += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

function newIdempotencyKey(): string {
  return `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-8${randomHex(3)}-${randomHex(12)}`;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEV_AUTH}`,
      ...(init.headers ?? {})
    }
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message ?? "Request failed";
    throw new Error(message);
  }
  return data as T;
}

export async function createCapture(payload: CreateCapturePayload) {
  return request<{ entry: { id: string } }>("/captures", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getSuggestions(entryId: string): Promise<SuggestionsResponse> {
  return request<SuggestionsResponse>(`/captures/${entryId}/suggestions`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function confirmPlacement(entryId: string, selection: ConfirmSelection): Promise<ConfirmPlacementResponse> {
  return request<ConfirmPlacementResponse>(`/captures/${entryId}/confirm`, {
    method: "POST",
    headers: {
      "Idempotency-Key": newIdempotencyKey()
    },
    body: JSON.stringify({ selection })
  });
}

export async function moveEntry(
  entryId: string,
  target: ConfirmSelection
): Promise<MoveEntryResponse> {
  return request<MoveEntryResponse>(`/entries/${entryId}/move`, {
    method: "POST",
    headers: {
      "Idempotency-Key": newIdempotencyKey()
    },
    body: JSON.stringify({ target })
  });
}

export async function undoPlacement(placementId: string): Promise<UndoPlacementResponse> {
  return request<UndoPlacementResponse>(`/placements/${placementId}/undo`, {
    method: "POST",
    headers: {
      "Idempotency-Key": newIdempotencyKey()
    },
    body: JSON.stringify({})
  });
}

export async function listCollections(): Promise<CollectionSummary[]> {
  const result = await request<{ collections: CollectionSummary[] }>("/collections", {
    method: "GET"
  });
  return result.collections;
}

export async function listCollectionEntries(collectionId: string): Promise<{
  collection: { id: string; name: string; last_activity_at: string };
  entries: CollectionEntrySummary[];
}> {
  return request(`/collections/${collectionId}/entries`, {
    method: "GET"
  });
}

export async function updateEntryText(entryId: string, text: string): Promise<UpdateEntryResponse> {
  return request<UpdateEntryResponse>(`/entries/${entryId}`, {
    method: "PATCH",
    body: JSON.stringify({ content: { text } })
  });
}

export async function deleteEntry(entryId: string): Promise<void> {
  await request(`/entries/${entryId}`, {
    method: "DELETE"
  });
}

export async function renameCollection(collectionId: string, name: string): Promise<RenameCollectionResponse> {
  return request<RenameCollectionResponse>(`/collections/${collectionId}`, {
    method: "PATCH",
    body: JSON.stringify({ name })
  });
}

/** Server-side OpenAI vision (POST /v1/extract-text). `imageBase64` is raw base64 (no data: prefix). */
export async function extractTextFromImage(
  imageBase64: string,
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"
): Promise<string> {
  const result = await request<{ text: string }>("/extract-text", {
    method: "POST",
    body: JSON.stringify({ image_base64: imageBase64, mime_type: mimeType })
  });
  return result.text;
}
