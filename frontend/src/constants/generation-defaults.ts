import { Img2ImgParameters, Txt2ImgParameters } from '@/types/image-generation';

export const DEFAULT_GENERATION_PROMPT =
  'masterpiece, best quality, anime style, ultra-detailed, beautiful landscape, waterfall, flowing water, river, lush forest, green scenery, detailed sky, soft clouds, cinematic lighting, sunlight rays, reflections on water, vibrant colors, peaceful atmosphere';
export const DEFAULT_NEGATIVE_PROMPT =
  'worst quality, low quality, blurry, artifact, deformed, bad anatomy, photo, 3d, blurry, bad anatomy, extra limbs, poorly drawn';

export const DEFAULT_RESOLUTION = {
  width: 1024,
  height: 1024
} as const;

export const DEFAULT_STEPS = 20;
export const DEFAULT_CFG_SCALE = 7;
export const DEFAULT_DENOISE_STRENGTH = 0.55;
export const DEFAULT_SAMPLER = 'euler_ancestral';
export const DEFAULT_SCHEDULER = 'normal';
export const DEFAULT_BATCH_SIZE = 1;
export const DEFAULT_REFINE_STEPS = 14;
export const DEFAULT_REFINE_SCALE_BY = 1.5;
export const DEFAULT_REFINE_DENOISE_STRENGTH = 0.35;
export const DEFAULT_CLIP_SKIP_STOP_AT_LAYER = -2;

export const defaultTxt2ImgParameters: Txt2ImgParameters = {
  prompt: DEFAULT_GENERATION_PROMPT,
  negativePrompt: DEFAULT_NEGATIVE_PROMPT,
  seed: '',
  variationSeed: '',
  variationSeedStrength: 0.35,
  steps: DEFAULT_STEPS,
  cfgScale: DEFAULT_CFG_SCALE,
  resolution: { ...DEFAULT_RESOLUTION },
  model: '',
  vae: 'Auto',
  sampler: DEFAULT_SAMPLER,
  scheduler: DEFAULT_SCHEDULER,
  batchSize: DEFAULT_BATCH_SIZE,
  refine: {
    enabled: false,
    upscaleMode: 'latent',
    upscaleMethod: 'nearest-exact',
    upscaleModel: '',
    scaleBy: DEFAULT_REFINE_SCALE_BY,
    steps: DEFAULT_REFINE_STEPS,
    denoiseStrength: DEFAULT_REFINE_DENOISE_STRENGTH
  },
  clipSkip: {
    enabled: false,
    stopAtLayer: DEFAULT_CLIP_SKIP_STOP_AT_LAYER
  },
  faceDetailer: {
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
  }
};

export const defaultImg2ImgParameters: Img2ImgParameters = {
  ...defaultTxt2ImgParameters,
  sourceImagePath: '',
  denoiseStrength: DEFAULT_DENOISE_STRENGTH
};
