import { z } from "zod";

/** Vision-capable image; base64 must not include a data: prefix. */
export const extractTextRequestSchema = z.object({
  image_base64: z.string().min(1).max(25_000_000),
  mime_type: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]).default("image/jpeg")
});

export type ExtractTextRequest = z.infer<typeof extractTextRequestSchema>;
