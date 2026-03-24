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
  variationSeed: string;
  variationSeedStrength: number;
  steps: number;
  cfgScale: number;
  resolution: GenerationResolution;
  model: string;
  vae: string;
  sampler: string;
  scheduler: string;
  batchSize: number;
}

export type RefineUpscaleMode = 'latent' | 'model';

export interface Txt2ImgRefineParameters {
  enabled: boolean;
  upscaleMode: RefineUpscaleMode;
  upscaleMethod: string;
  upscaleModel: string;
  scaleBy: number;
  steps: number;
  denoiseStrength: number;
}

export interface Txt2ImgClipSkipParameters {
  enabled: boolean;
  stopAtLayer: number;
}

export interface Txt2ImgParameters extends BaseGenerationParameters {
  refine: Txt2ImgRefineParameters;
  clipSkip: Txt2ImgClipSkipParameters;
}

export interface Img2ImgParameters extends BaseGenerationParameters {
  sourceImagePath: string;
  denoiseStrength: number;
}

export type ComfyUIEngineState =
  | 'idle'
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
  statusMessage?: string;
  managedExternally?: boolean;
}

export type ComfyUISetupState =
  | 'checking'
  | 'missing'
  | 'ready'
  | 'installing'
  | 'error';

export type ComfyUISetupStepState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'error';

export interface ComfyUISetupStep {
  id: string;
  label: string;
  status: ComfyUISetupStepState;
  message: string;
}

export interface ComfyUISetupStatus {
  state: ComfyUISetupState;
  workspaceRoot: string;
  installDir: string;
  statusMessage: string;
  currentStepId: string;
  currentStepMessage: string;
  eventSeq: number;
  downloadProgress: number;
  downloadedBytes: number;
  totalBytes: number;
  downloadSpeed: number;
  lastError: string;
  errorKind: string;
  permissionProblem: boolean;
  permissionMessage: string;
  isInstalled: boolean;
  isReady: boolean;
  requiresOnboarding: boolean;
  nvidiaOnly: boolean;
  steps: ComfyUISetupStep[];
}

export interface ComfyUILogEntry {
  timestamp: string;
  level: string;
  stream: string;
  message: string;
}

export interface GenerationModelCatalog {
  samplers: string[];
  schedulers: string[];
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
  imagePath?: string;
  outputDir?: string;
  promptId?: string;
  isGenerating?: boolean;
  status?: 'queued' | 'running' | 'completed' | 'canceled' | 'error';
  message?: string;
  createdAtISO: string;
  resolution: GenerationResolution;
  steps: number;
  cfgScale: number;
  seed: string;
  completedAtISO?: string;
}

export interface ComfyUISamplerResponse {
  samplers: string[];
  schedulers: string[];
}

export interface GenerationStatusEvent {
  promptId: string;
  state: 'queued' | 'running' | 'completed' | 'canceled' | 'error';
  progress: number;
  message: string;
  previewPath: string;
  error: string;
  startedAt: string;
}

export interface GenerationResultEvent {
  promptId: string;
  mode: string;
  imagePath: string;
  outputDir: string;
  seed: string;
  startedAt: string;
  completedAt: string;
}
