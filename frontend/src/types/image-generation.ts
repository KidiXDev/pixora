export type ImageGenerationBackend = 'comfyui';

export type ImageGenerationMode = 'txt2img' | 'img2img';

export interface GenerationResolution {
  width: number;
  height: number;
}

export interface BaseGenerationParameters {
  prompt: string;
  negativePrompt: string;
  seed: string;
  steps: number;
  cfgScale: number;
  resolution: GenerationResolution;
  model: string;
  sampler: string;
}

export type Txt2ImgParameters = BaseGenerationParameters;

export interface Img2ImgParameters extends BaseGenerationParameters {
  sourceImagePath: string;
  denoiseStrength: number;
}


export interface ComfyUIConfig {
  apiUrl: string;
  localPath: string;
  args: string;
  outputDir: string;
}

export interface GeneratedPreviewItem {
  id: string;
  backend: ImageGenerationBackend;
  mode: ImageGenerationMode;
  prompt: string;
  createdAtISO: string;
  resolution: GenerationResolution;
  steps: number;
  cfgScale: number;
  seed: string;
}
