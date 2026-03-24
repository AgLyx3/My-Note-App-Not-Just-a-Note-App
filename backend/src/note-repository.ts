import type { CreateCaptureBody } from "./capture-schema.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface CaptureEntry {
  id: string;
  type: CreateCaptureBody["type"];
  status: "draft" | "placed";
  created_at: string;
  collection_id?: string | null;
  updated_at?: string;
}

export interface CollectionSummary {
  id: string;
  name: string;
  last_activity_at: string;
}

export interface CollectionEntrySummary {
  id: string;
  type: CreateCaptureBody["type"];
  status: "draft" | "placed";
  created_at: string;
  updated_at?: string;
  preview: string;
  image_uri?: string;
  content_text?: string;
}

export type ConfirmSelection =
  | { kind: "collection"; collection_id: string }
  | { kind: "create_new"; new_collection_name: string };

export type EntryAccess =
  | { status: "ok"; entry: CaptureEntry }
  | { status: "not_found" }
  | { status: "forbidden" };

export interface NoteRepository {
  createDraft(input: CreateCaptureBody, userId: string): Promise<CaptureEntry>;
  getEntry(userId: string, entryId: string): Promise<CaptureEntry | null>;
  getEntryAccess(userId: string, entryId: string): Promise<EntryAccess>;
  listCollections(userId: string): Promise<CollectionSummary[]>;
  listCollectionEntries(userId: string, collectionId: string): Promise<CollectionEntrySummary[]>;
  /** Last `limit` placed entries in collection, newest first — preview strings for ranking profile. */
  listRecentPlacedPreviews(userId: string, collectionId: string, limit: number): Promise<string[]>;
  updateEntryText(userId: string, entryId: string, text: string): Promise<CollectionEntrySummary>;
  renameCollection(userId: string, collectionId: string, name: string): Promise<CollectionSummary>;
  deleteEntry(userId: string, entryId: string): Promise<void>;
  /** Text preview for draft text entries; used for suggested collection names. */
  getDraftTextPreview(userId: string, entryId: string): Promise<string | undefined>;
  confirmPlacementStub(userId: string, entryId: string, selection: ConfirmSelection): Promise<ConfirmPlacementResult>;
  moveEntryStub(
    userId: string,
    entryId: string,
    target: ConfirmSelection
  ): Promise<MoveEntryResult>;
  undoPlacementStub(userId: string, placementId: string): Promise<UndoPlacementResult>;
}

export interface ConfirmPlacementResult {
  placement: {
    id: string;
    entry_id: string;
    action_type: "confirm";
    to_collection_id: string;
    created_at: string;
    undo_expires_at: string;
  };
  entry: { id: string; collection_id: string; status: "placed"; updated_at: string };
  collection: { id: string; name: string; last_activity_at: string };
}

export interface MoveEntryResult {
  placement: {
    id: string;
    entry_id: string;
    action_type: "move";
    from_collection_id: string | null;
    to_collection_id: string;
    created_at: string;
    undo_expires_at: string;
  };
  entry: { id: string; collection_id: string; updated_at: string };
}

export interface UndoPlacementResult {
  placement: {
    id: string;
    action_type: "undo";
    reverted_placement_id: string;
    created_at: string;
  };
  entry: { id: string; collection_id: string | null; updated_at: string };
}

interface StoredCollection extends CollectionSummary {
  userId: string;
}

interface StoredEntry extends CaptureEntry {
  userId: string;
  contentText?: string;
  contentImagePath?: string;
  contentImageContext?: string;
}

interface StoredPlacement {
  id: string;
  userId: string;
  entryId: string;
  actionType: "confirm" | "move" | "undo";
  fromCollectionId: string | null;
  toCollectionId: string | null;
  revertedPlacementId: string | null;
  createdAt: string;
  undoExpiresAt: string | null;
}

export interface InMemoryNoteRepositoryOptions {
  /**
   * When false, skip auto-seeding "Travel Plans" / "Work Sprint" on first `listCollections`.
   * Useful for tests that need a truly empty collection list (e.g. cold-start suggestions).
   * @default true
   */
  seedDefaultCollections?: boolean;
  /**
   * Optional JSON file path for persisting repository state across process restarts.
   * When provided, mutations are written to disk immediately.
   */
  persistenceFilePath?: string;
}

interface PersistedNoteStateV1 {
  version: 1;
  entries: StoredEntry[];
  collections: StoredCollection[];
  placements: StoredPlacement[];
  latestReversibleByEntry: Array<{ entryId: string; placementId: string }>;
  seededUsers: string[];
}

export class InMemoryNoteRepository implements NoteRepository {
  private entries = new Map<string, StoredEntry>();
  private collections = new Map<string, StoredCollection>();
  private placements = new Map<string, StoredPlacement>();
  private latestReversibleByEntry = new Map<string, string>();
  private seededUsers = new Set<string>();

  constructor(private readonly initOptions: InMemoryNoteRepositoryOptions = {}) {
    this.loadFromDisk();
  }

  private loadFromDisk() {
    const filePath = this.initOptions.persistenceFilePath;
    if (!filePath || !existsSync(filePath)) return;
    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedNoteStateV1;
      if (!parsed || parsed.version !== 1) return;
      this.entries = new Map(parsed.entries.map((row) => [row.id, row]));
      this.collections = new Map(parsed.collections.map((row) => [row.id, row]));
      this.placements = new Map(parsed.placements.map((row) => [row.id, row]));
      this.latestReversibleByEntry = new Map(
        (parsed.latestReversibleByEntry ?? []).map((row) => [row.entryId, row.placementId])
      );
      this.seededUsers = new Set(parsed.seededUsers ?? []);
    } catch {
      // Ignore invalid snapshot and continue with empty in-memory state.
    }
  }

  private persistToDisk() {
    const filePath = this.initOptions.persistenceFilePath;
    if (!filePath) return;
    const payload: PersistedNoteStateV1 = {
      version: 1,
      entries: [...this.entries.values()],
      collections: [...this.collections.values()],
      placements: [...this.placements.values()],
      latestReversibleByEntry: [...this.latestReversibleByEntry.entries()].map(([entryId, placementId]) => ({
        entryId,
        placementId
      })),
      seededUsers: [...this.seededUsers.values()]
    };
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  private ensureDefaultCollections(userId: string) {
    if (this.seededUsers.has(userId)) return;
    if (this.initOptions.seedDefaultCollections === false) {
      this.seededUsers.add(userId);
      this.persistToDisk();
      return;
    }
    const now = new Date().toISOString();
    this.seedCollection(userId, { name: "Travel Plans", last_activity_at: now });
    this.seedCollection(userId, { name: "Work Sprint", last_activity_at: new Date(Date.now() - 16 * 60 * 1000).toISOString() });
    this.seededUsers.add(userId);
    this.persistToDisk();
  }

  seedCollection(
    userId: string,
    row: { id?: string; name: string; last_activity_at?: string }
  ): string {
    const id = row.id ?? `col_${crypto.randomUUID()}`;
    const at = row.last_activity_at ?? new Date().toISOString();
    this.collections.set(id, { id, userId, name: row.name, last_activity_at: at });
    this.persistToDisk();
    return id;
  }

  async createDraft(input: CreateCaptureBody, userId: string): Promise<CaptureEntry> {
    const id = `ent_${crypto.randomUUID()}`;
    const created_at = new Date().toISOString();
    const inferredType: CreateCaptureBody["type"] = input.type;
    const contentText = input.type === "text" ? input.content.text : undefined;
    const contentImagePath =
      input.type === "text"
        ? input.content.image_storage_path
        : input.type === "image"
          ? input.content.storage_path
          : undefined;
    const contentImageContext = input.type === "text" ? input.content.image_context : undefined;
    this.entries.set(id, {
      id,
      userId,
      type: inferredType,
      status: "draft",
      created_at,
      contentText,
      contentImagePath,
      contentImageContext
    });
    this.persistToDisk();
    return { id, type: inferredType, status: "draft", created_at };
  }

  async getEntry(userId: string, entryId: string): Promise<CaptureEntry | null> {
    const row = this.entries.get(entryId);
    if (!row || row.userId !== userId) return null;
    const { userId: _u, contentText: _c, contentImagePath: _i, contentImageContext: _ctx, ...pub } = row;
    return pub;
  }

  async getEntryAccess(userId: string, entryId: string): Promise<EntryAccess> {
    const row = this.entries.get(entryId);
    if (!row) return { status: "not_found" };
    if (row.userId !== userId) return { status: "forbidden" };
    const { userId: _u, contentText: _c, contentImagePath: _i, contentImageContext: _ctx, ...pub } = row;
    return { status: "ok", entry: pub };
  }

  async listCollections(userId: string): Promise<CollectionSummary[]> {
    this.ensureDefaultCollections(userId);
    return [...this.collections.values()]
      .filter((c) => c.userId === userId)
      .map(({ userId: _u, ...rest }) => rest)
      .sort((a, b) => (a.last_activity_at < b.last_activity_at ? 1 : -1));
  }

  async listCollectionEntries(userId: string, collectionId: string): Promise<CollectionEntrySummary[]> {
    const collection = this.collections.get(collectionId);
    if (!collection || collection.userId !== userId) return [];
    return [...this.entries.values()]
      .filter((e) => e.userId === userId && e.collection_id === collectionId)
      .sort((a, b) => (a.updated_at ?? a.created_at) < (b.updated_at ?? b.created_at) ? 1 : -1)
      .map((e) => ({
        id: e.id,
        type: e.type,
        status: e.status,
        created_at: e.created_at,
        updated_at: e.updated_at,
        preview: e.type === "text" ? (e.contentText?.slice(0, 120) || "Text note") : "Image note",
        image_uri: e.contentImagePath,
        content_text: e.contentText
      }));
  }

  async listRecentPlacedPreviews(userId: string, collectionId: string, limit: number): Promise<string[]> {
    const collection = this.collections.get(collectionId);
    if (!collection || collection.userId !== userId) return [];
    const placed = [...this.entries.values()]
      .filter(
        (e) =>
          e.userId === userId &&
          e.collection_id === collectionId &&
          e.status === "placed"
      )
      .sort((a, b) => (a.updated_at ?? a.created_at) < (b.updated_at ?? b.created_at) ? 1 : -1)
      .slice(0, Math.max(0, limit));

    return placed.map((e) => {
      if (e.type === "text") {
        const base = e.contentText?.trim() || "Text note";
        const cap = 280;
        const head = base.length > cap ? `${base.slice(0, cap)}…` : base;
        if (e.contentImageContext?.trim()) {
          return `${head}\n(Context: ${e.contentImageContext.trim()})`;
        }
        return head;
      }
      const ocr = e.contentText?.trim();
      if (ocr) {
        const cap = 280;
        return ocr.length > cap ? `${ocr.slice(0, cap)}…` : ocr;
      }
      return "Image note";
    });
  }

  async updateEntryText(userId: string, entryId: string, text: string): Promise<CollectionEntrySummary> {
    const row = this.entries.get(entryId);
    if (!row || row.userId !== userId) throw new Error("ENTRY_NOT_FOUND");
    row.contentText = text;
    row.updated_at = new Date().toISOString();
    row.type = "text";
    this.persistToDisk();
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      preview: row.contentText.slice(0, 120),
      image_uri: row.contentImagePath,
      content_text: row.contentText
    };
  }

  async renameCollection(userId: string, collectionId: string, name: string): Promise<CollectionSummary> {
    const row = this.collections.get(collectionId);
    if (!row || row.userId !== userId) throw new Error("COLLECTION_NOT_FOUND");
    row.name = name;
    row.last_activity_at = new Date().toISOString();
    this.persistToDisk();
    const { userId: _u, ...pub } = row;
    return pub;
  }

  async deleteEntry(userId: string, entryId: string): Promise<void> {
    const row = this.entries.get(entryId);
    if (!row || row.userId !== userId) throw new Error("ENTRY_NOT_FOUND");
    this.entries.delete(entryId);
    this.latestReversibleByEntry.delete(entryId);
    this.persistToDisk();
  }

  async getDraftTextPreview(userId: string, entryId: string): Promise<string | undefined> {
    const row = this.entries.get(entryId);
    if (!row || row.userId !== userId) return undefined;
    if (row.contentImageContext) {
      return `${row.contentText ?? ""}\n\nContext: ${row.contentImageContext}`.trim();
    }
    return row.contentText;
  }

  private touchCollection(collectionId: string, at: string) {
    const c = this.collections.get(collectionId);
    if (c) c.last_activity_at = at;
  }

  private addPlacement(row: StoredPlacement) {
    this.placements.set(row.id, row);
    if (row.actionType === "confirm" || row.actionType === "move") {
      this.latestReversibleByEntry.set(row.entryId, row.id);
    }
  }

  async confirmPlacementStub(
    userId: string,
    entryId: string,
    selection: ConfirmSelection
  ): Promise<ConfirmPlacementResult> {
    const entry = this.entries.get(entryId);
    if (!entry || entry.userId !== userId) {
      throw new Error("ENTRY_NOT_FOUND");
    }
    if (entry.status !== "draft") {
      throw new Error("ENTRY_NOT_DRAFT");
    }
    const now = new Date().toISOString();
    const undoMs = 5 * 60 * 1000;
    const undo_expires_at = new Date(Date.now() + undoMs).toISOString();

    let collectionId: string;
    let collectionName: string;

    if (selection.kind === "create_new") {
      collectionId = this.seedCollection(userId, { name: selection.new_collection_name, last_activity_at: now });
      const c = this.collections.get(collectionId)!;
      collectionName = c.name;
    } else {
      const col = this.collections.get(selection.collection_id);
      if (!col || col.userId !== userId) {
        throw new Error("COLLECTION_NOT_FOUND");
      }
      collectionId = col.id;
      collectionName = col.name;
      this.touchCollection(collectionId, now);
    }

    entry.status = "placed";
    entry.collection_id = collectionId;
    entry.updated_at = now;

    const placementId = `plc_${crypto.randomUUID()}`;
    this.addPlacement({
      id: placementId,
      userId,
      entryId,
      actionType: "confirm",
      fromCollectionId: null,
      toCollectionId: collectionId,
      revertedPlacementId: null,
      createdAt: now,
      undoExpiresAt: undo_expires_at
    });
    this.persistToDisk();

    return {
      placement: {
        id: placementId,
        entry_id: entryId,
        action_type: "confirm",
        to_collection_id: collectionId,
        created_at: now,
        undo_expires_at
      },
      entry: {
        id: entryId,
        collection_id: collectionId,
        status: "placed",
        updated_at: now
      },
      collection: {
        id: collectionId,
        name: collectionName,
        last_activity_at: now
      }
    };
  }

  async moveEntryStub(userId: string, entryId: string, target: ConfirmSelection): Promise<MoveEntryResult> {
    const entry = this.entries.get(entryId);
    if (!entry || entry.userId !== userId) throw new Error("ENTRY_NOT_FOUND");
    if (entry.status !== "placed" || !entry.collection_id) throw new Error("ENTRY_NOT_PLACED");

    const from = entry.collection_id;
    const now = new Date().toISOString();
    const undo_expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    let toId: string;
    if (target.kind === "create_new") {
      toId = this.seedCollection(userId, { name: target.new_collection_name, last_activity_at: now });
    } else {
      const col = this.collections.get(target.collection_id);
      if (!col || col.userId !== userId) throw new Error("COLLECTION_NOT_FOUND");
      toId = col.id;
      this.touchCollection(toId, now);
    }

    entry.collection_id = toId;
    entry.updated_at = now;

    const placementId = `plc_${crypto.randomUUID()}`;
    this.addPlacement({
      id: placementId,
      userId,
      entryId,
      actionType: "move",
      fromCollectionId: from,
      toCollectionId: toId,
      revertedPlacementId: null,
      createdAt: now,
      undoExpiresAt: undo_expires_at
    });
    this.persistToDisk();

    return {
      placement: {
        id: placementId,
        entry_id: entryId,
        action_type: "move",
        from_collection_id: from,
        to_collection_id: toId,
        created_at: now,
        undo_expires_at
      },
      entry: {
        id: entryId,
        collection_id: toId,
        updated_at: now
      }
    };
  }

  async undoPlacementStub(userId: string, placementId: string): Promise<UndoPlacementResult> {
    const placement = this.placements.get(placementId);
    if (!placement || placement.userId !== userId) throw new Error("PLACEMENT_NOT_FOUND");

    const latest = this.latestReversibleByEntry.get(placement.entryId);
    if (latest !== placementId) throw new Error("UNDO_NOT_LATEST");

    if (placement.undoExpiresAt && new Date(placement.undoExpiresAt).getTime() < Date.now()) {
      throw new Error("UNDO_EXPIRED");
    }

    const entry = this.entries.get(placement.entryId);
    if (!entry) throw new Error("ENTRY_NOT_FOUND");

    const now = new Date().toISOString();
    let restoredCollectionId: string | null = placement.fromCollectionId;

    if (placement.actionType === "confirm") {
      entry.status = "draft";
      entry.collection_id = null;
    } else if (placement.actionType === "move") {
      entry.collection_id = placement.fromCollectionId;
    } else {
      throw new Error("UNDO_UNSUPPORTED");
    }

    entry.updated_at = now;
    this.latestReversibleByEntry.delete(placement.entryId);

    const undoPlacementId = `plc_${crypto.randomUUID()}`;
    this.addPlacement({
      id: undoPlacementId,
      userId,
      entryId: placement.entryId,
      actionType: "undo",
      fromCollectionId: null,
      toCollectionId: null,
      revertedPlacementId: placementId,
      createdAt: now,
      undoExpiresAt: null
    });
    this.persistToDisk();

    return {
      placement: {
        id: undoPlacementId,
        action_type: "undo",
        reverted_placement_id: placementId,
        created_at: now
      },
      entry: {
        id: placement.entryId,
        collection_id: restoredCollectionId,
        updated_at: now
      }
    };
  }
}
