import { z } from "zod";

export const captureTypeSchema = z.enum(["text", "image"]);

const textCaptureSchema = z.object({
  type: z.literal("text"),
  content: z.object({
    text: z.string().trim().min(1).max(10000),
    /** When set, the image is kept alongside the extracted/saved text (e.g. local URI or storage path). */
    image_storage_path: z.string().trim().min(1).optional(),
    /** Optional context from image-derived capture flow; capped to keep typing light. */
    image_context: z.string().trim().min(1).max(120).optional()
  }),
  client_context: z
    .object({
      device_time: z.string().datetime().optional(),
      timezone: z.string().min(1).max(100).optional()
    })
    .optional()
});

const imageCaptureSchema = z.object({
  type: z.literal("image"),
  content: z.object({
    storage_path: z.string().trim().min(1)
  }),
  client_context: z
    .object({
      device_time: z.string().datetime().optional(),
      timezone: z.string().min(1).max(100).optional()
    })
    .optional()
});

export const createCaptureSchema = z.discriminatedUnion("type", [
  textCaptureSchema,
  imageCaptureSchema
]);

export type CreateCaptureBody = z.infer<typeof createCaptureSchema>;
