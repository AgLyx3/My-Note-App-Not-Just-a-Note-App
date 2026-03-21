import { createHash } from "node:crypto";

export interface IdempotencyRecord {
  requestHash: string;
  responseJson: unknown;
  statusCode: number;
}

export interface IdempotencyStore {
  get(userId: string, routeKey: string, idempotencyKey: string): IdempotencyRecord | undefined;
  set(userId: string, routeKey: string, idempotencyKey: string, record: IdempotencyRecord): void;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private map = new Map<string, IdempotencyRecord>();

  private compositeKey(userId: string, routeKey: string, idempotencyKey: string) {
    return `${userId}\n${routeKey}\n${idempotencyKey}`;
  }

  get(userId: string, routeKey: string, idempotencyKey: string): IdempotencyRecord | undefined {
    return this.map.get(this.compositeKey(userId, routeKey, idempotencyKey));
  }

  set(userId: string, routeKey: string, idempotencyKey: string, record: IdempotencyRecord): void {
    this.map.set(this.compositeKey(userId, routeKey, idempotencyKey), record);
  }
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function hashRequestBody(body: unknown): string {
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

export function routeKeyConfirm(entryId: string): string {
  return `POST /v1/captures/${entryId}/confirm`;
}

export function routeKeyMove(entryId: string): string {
  return `POST /v1/entries/${entryId}/move`;
}

export function routeKeyUndo(placementId: string): string {
  return `POST /v1/placements/${placementId}/undo`;
}

export type IdempotencyRunResult =
  | { kind: "mismatch" }
  | { kind: "response"; statusCode: number; body: unknown; replayed: boolean };

export async function runWithIdempotency(params: {
  store: IdempotencyStore;
  userId: string;
  routeKey: string;
  idempotencyKey: string;
  requestBody: unknown;
  execute: () => Promise<{ statusCode: number; body: unknown }>;
}): Promise<IdempotencyRunResult> {
  const hash = hashRequestBody(params.requestBody);
  const existing = params.store.get(params.userId, params.routeKey, params.idempotencyKey);
  if (existing) {
    if (existing.requestHash !== hash) {
      return { kind: "mismatch" };
    }
    return { kind: "response", statusCode: existing.statusCode, body: existing.responseJson, replayed: true };
  }

  const result = await params.execute();
  params.store.set(params.userId, params.routeKey, params.idempotencyKey, {
    requestHash: hash,
    responseJson: result.body,
    statusCode: result.statusCode
  });
  return { kind: "response", statusCode: result.statusCode, body: result.body, replayed: false };
}
