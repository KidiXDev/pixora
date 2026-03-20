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

export const defaultTxt2ImgParameters: Txt2ImgParameters = {
  prompt: DEFAULT_GENERATION_PROMPT,
  negativePrompt: DEFAULT_NEGATIVE_PROMPT,
  seed: '',
  steps: DEFAULT_STEPS,
  cfgScale: DEFAULT_CFG_SCALE,
  resolution: { ...DEFAULT_RESOLUTION },
  model: '',
  vae: '',
  sampler: DEFAULT_SAMPLER,
  scheduler: DEFAULT_SCHEDULER
};

export const defaultImg2ImgParameters: Img2ImgParameters = {
  ...defaultTxt2ImgParameters,
  sourceImagePath: '',
  denoiseStrength: DEFAULT_DENOISE_STRENGTH
};
