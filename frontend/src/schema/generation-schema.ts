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

export const txt2imgFaceDetailerSchema = z.object({
  enabled: z.boolean().default(false),
  guideSize: z.coerce.number().min(64).max(4096).default(512),
  guideSizeFor: z.boolean().default(true),
  maxSize: z.coerce.number().min(64).max(4096).default(1024),
  denoise: z.coerce.number().min(0.0001).max(1).default(0.5),
  feather: z.coerce.number().int().min(0).max(100).default(5),
  noiseMask: z.boolean().default(true),
  forceInpaint: z.boolean().default(true),
  inpaintModel: z.boolean().default(false),
  noiseMaskFeather: z.coerce.number().int().min(0).max(100).default(20),
  bboxThreshold: z.coerce.number().min(0).max(1).default(0.5),
  bboxDilation: z.coerce.number().int().min(-512).max(512).default(10),
  bboxCropFactor: z.coerce.number().min(1).max(10).default(3),
  bboxModel: z.string().default('bbox/face_yolov8m.pt'),
  samModel: z.string().default(''),
  samDetectionHint: z
    .enum([
      'center-1',
      'horizontal-2',
      'vertical-2',
      'rect-4',
      'diamond-4',
      'mask-area',
      'mask-points',
      'mask-point-bbox',
      'none'
    ])
    .default('none'),
  samDilation: z.coerce.number().int().min(-512).max(512).default(0),
  samThreshold: z.coerce.number().min(0).max(1).default(0.93),
  samBboxExpansion: z.coerce.number().int().min(0).max(1000).default(0),
  samMaskHintThreshold: z.coerce.number().min(0).max(1).default(0.7),
  samMaskHintUseNegative: z.enum(['False', 'Small', 'Outter']).default('False'),
  dropSize: z.coerce.number().int().min(1).max(4096).default(10),
  cycle: z.coerce.number().int().min(1).max(10).default(1),
  tiledEncode: z.boolean().default(false),
  tiledDecode: z.boolean().default(false)
}).superRefine((value, ctx) => {
  if (!value.enabled) {
    return;
  }

  if (value.bboxModel.trim() === '') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'BBox model is required when Face Detailer is enabled.',
      path: ['bboxModel']
    });
  }

  if (value.samModel.trim() === '') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'SAM model is required when Face Detailer is enabled.',
      path: ['samModel']
    });
  }
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
  }),
  faceDetailer: txt2imgFaceDetailerSchema.default({
    enabled: false,
    guideSize: 512,
    guideSizeFor: true,
    maxSize: 1024,
    denoise: 0.5,
    feather: 5,
    noiseMask: true,
    forceInpaint: true,
    inpaintModel: false,
    noiseMaskFeather: 20,
    bboxThreshold: 0.5,
    bboxDilation: 10,
    bboxCropFactor: 3,
    bboxModel: 'bbox/face_yolov8m.pt',
    samModel: '',
    samDetectionHint: 'none',
    samDilation: 0,
    samThreshold: 0.93,
    samBboxExpansion: 0,
    samMaskHintThreshold: 0.7,
    samMaskHintUseNegative: 'False',
    dropSize: 10,
    cycle: 1,
    tiledEncode: false,
    tiledDecode: false
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
