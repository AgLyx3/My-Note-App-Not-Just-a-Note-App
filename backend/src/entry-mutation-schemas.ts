import { z } from "zod";

export const updateEntrySchema = z.object({
  content: z.object({
    text: z.string().trim().min(1).max(10000)
  })
});
