import { z } from 'zod';
import {
  DEFAULT_CFG_SCALE,
  DEFAULT_DENOISE_STRENGTH,
  DEFAULT_GENERATION_PROMPT,
  DEFAULT_NEGATIVE_PROMPT,
  DEFAULT_RESOLUTION,
  DEFAULT_SAMPLER,
  DEFAULT_SCHEDULER,
  DEFAULT_STEPS
} from '@/constants/generation-defaults';

export const resolutionSchema = z.object({
  width: z.coerce.number().min(64).max(4096),
  height: z.coerce.number().min(64).max(4096)
});

export const baseGenerationSchema = z.object({
  prompt: z.string().optional().default(DEFAULT_GENERATION_PROMPT),
  negativePrompt: z.string().optional().default(DEFAULT_NEGATIVE_PROMPT),
  seed: z.string().optional().default(''),
  steps: z.coerce.number().min(1).max(150).default(DEFAULT_STEPS),
  cfgScale: z.coerce.number().min(1).max(30).default(DEFAULT_CFG_SCALE),
  resolution: resolutionSchema.default(DEFAULT_RESOLUTION),
  model: z.string().min(1, 'Model is required'),
  vae: z.string().min(1, 'VAE is required'),
  sampler: z.string().min(1, 'Sampler is required').default(DEFAULT_SAMPLER),
  scheduler: z
    .string()
    .min(1, 'Scheduler is required')
    .default(DEFAULT_SCHEDULER)
});

export const txt2imgSchema = baseGenerationSchema;

export const img2imgSchema = baseGenerationSchema.extend({
  sourceImagePath: z.string().min(1, 'Source image path is required'),
  denoiseStrength: z
    .coerce.number()
    .min(0)
    .max(1)
    .default(DEFAULT_DENOISE_STRENGTH)
});

export type Txt2ImgValues = z.infer<typeof txt2imgSchema>;
export type Img2ImgValues = z.infer<typeof img2imgSchema>;
