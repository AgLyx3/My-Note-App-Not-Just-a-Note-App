import { z } from "zod";

export const suggestionsRequestSchema = z.object({
  hints: z
    .object({
      recent_collection_ids: z.array(z.string().min(1)).max(50).optional()
    })
    .optional()
});

export type SuggestionsRequest = z.infer<typeof suggestionsRequestSchema>;
