import { z } from "zod";

const selectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("collection"), collection_id: z.string().min(1) }),
  z.object({
    kind: z.literal("create_new"),
    new_collection_name: z.string().trim().min(1).max(120)
  })
]);

export const confirmBodySchema = z.object({
  selection: selectionSchema
});

export const moveBodySchema = z.object({
  target: selectionSchema
});

export const undoBodySchema = z.object({}).strict();
