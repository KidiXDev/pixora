import { z } from 'zod';
import {
  DEFAULT_CFG_SCALE,
  DEFAULT_DENOISE_STRENGTH,
  DEFAULT_GENERATION_PROMPT,
  DEFAULT_NEGATIVE_PROMPT,
  DEFAULT_REFINE_DENOISE_STRENGTH,
  DEFAULT_REFINE_SCALE_BY,
  DEFAULT_REFINE_STEPS,
  DEFAULT_CLIP_SKIP_STOP_AT_LAYER,
  DEFAULT_RESOLUTION,
  DEFAULT_SAMPLER,
  DEFAULT_SCHEDULER,
  DEFAULT_STEPS,
  DEFAULT_BATCH_SIZE
} from '@/constants/generation-defaults';

export const resolutionSchema = z.object({
  width: z.coerce.number().min(64).max(4096),
  height: z.coerce.number().min(64).max(4096)
});

export const txt2imgRefineSchema = z
  .object({
    enabled: z.boolean().default(false),
    upscaleMode: z.enum(['latent', 'model']).default('latent'),
    upscaleMethod: z
      .enum([
        'nearest-exact',
        'bilinear',
        'area',
        'bicubic',
        'bislerp',
        'lanczos'
      ])
      .default('nearest-exact'),
    upscaleModel: z.string().default(''),
    scaleBy: z.coerce.number().min(1.05).max(4).default(DEFAULT_REFINE_SCALE_BY),
    steps: z.coerce.number().min(1).max(80).default(DEFAULT_REFINE_STEPS),
    denoiseStrength: z
      .coerce.number()
      .min(0.05)
      .max(1)
      .default(DEFAULT_REFINE_DENOISE_STRENGTH)
  })
  .superRefine((value, ctx) => {
    if (
      value.enabled &&
      value.upscaleMode === 'model' &&
      value.upscaleModel.trim() === ''
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Upscale model is required when using model upscale.',
        path: ['upscaleModel']
      });
    }
  });

export const txt2imgClipSkipSchema = z.object({
  enabled: z.boolean().default(false),
  stopAtLayer: z.coerce.number().int().min(-24).max(-1).default(DEFAULT_CLIP_SKIP_STOP_AT_LAYER)
});

export const baseGenerationSchema = z.object({
  prompt: z.string().optional().default(DEFAULT_GENERATION_PROMPT),
  negativePrompt: z.string().optional().default(DEFAULT_NEGATIVE_PROMPT),
  seed: z.string().optional().default(''),
  variationSeed: z.string().optional().default(''),
  variationSeedStrength: z.coerce.number().min(0).max(1).default(0.35),
  steps: z.coerce.number().min(1).max(150).default(DEFAULT_STEPS),
  cfgScale: z.coerce.number().min(1).max(30).default(DEFAULT_CFG_SCALE),
  resolution: resolutionSchema.default(DEFAULT_RESOLUTION),
  model: z.string().min(1, 'Model is required'),
  vae: z.string().min(1, 'VAE is required'),
  sampler: z.string().min(1, 'Sampler is required').default(DEFAULT_SAMPLER),
  scheduler: z
    .string()
    .min(1, 'Scheduler is required')
    .default(DEFAULT_SCHEDULER),
  batchSize: z.coerce.number().min(1).max(100).default(DEFAULT_BATCH_SIZE)
});

export const txt2imgSchema = baseGenerationSchema.extend({
  refine: txt2imgRefineSchema.default({
    enabled: false,
    upscaleMode: 'latent',
    upscaleMethod: 'nearest-exact',
    upscaleModel: '',
    scaleBy: DEFAULT_REFINE_SCALE_BY,
    steps: DEFAULT_REFINE_STEPS,
    denoiseStrength: DEFAULT_REFINE_DENOISE_STRENGTH
  }),
  clipSkip: txt2imgClipSkipSchema.default({
    enabled: false,
    stopAtLayer: DEFAULT_CLIP_SKIP_STOP_AT_LAYER
  })
});

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
