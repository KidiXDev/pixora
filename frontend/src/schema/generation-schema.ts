import { z } from 'zod';

export const resolutionSchema = z.object({
  width: z.coerce.number().min(64).max(4096),
  height: z.coerce.number().min(64).max(4096)
});

export const baseGenerationSchema = z.object({
  prompt: z.string().optional().default(''),
  negativePrompt: z.string().optional().default(''),
  seed: z.string().optional().default(''),
  steps: z.coerce.number().min(1).max(150).default(20),
  cfgScale: z.coerce.number().min(1).max(30).default(7),
  resolution: resolutionSchema,
  model: z.string().min(1, 'Model is required'),
  sampler: z.string().min(1, 'Sampler is required')
});

export const txt2imgSchema = baseGenerationSchema;

export const img2imgSchema = baseGenerationSchema.extend({
  sourceImagePath: z.string().min(1, 'Source image path is required'),
  denoiseStrength: z.coerce.number().min(0).max(1).default(0.7)
});

export type Txt2ImgValues = z.infer<typeof txt2imgSchema>;
export type Img2ImgValues = z.infer<typeof img2imgSchema>;
