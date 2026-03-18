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
  vae: string;
  sampler: string;
}

export type Txt2ImgParameters = BaseGenerationParameters;

export interface Img2ImgParameters extends BaseGenerationParameters {
  sourceImagePath: string;
  denoiseStrength: number;
}

export type ComfyUIEngineState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error';

export interface ComfyUIConfig {
  apiUrl: string;
  localPath: string;
  args: string;
  outputDir: string;
  rootDir: string;
  pythonPath: string;
  mainScriptPath: string;
  modelPathsYAML: string;
  host: string;
  port: number;
}

export interface ComfyUIStatus {
  state: ComfyUIEngineState;
  running: boolean;
  pid: number;
  host: string;
  port: number;
  startedAt: string;
  lastError: string;
}

export interface ComfyUILogEntry {
  timestamp: string;
  level: string;
  stream: string;
  message: string;
}

export interface GenerationModelCatalog {
  samplers: string[];
  checkpoints: string[];
  vaes: string[];
  loras: string[];
  controlnets: string[];
  upscaleModels: string[];
  textEncoders: string[];
  diffusionModels: string[];
  unets: string[];
}

export interface PromptAutocompleteSuggestion {
  tag: string;
  category: number;
  popularity: number;
  alternative: string;
  insertText: string;
  matchedBy: string;
  matchedValue: string;
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
