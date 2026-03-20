import {
  defaultImg2ImgParameters,
  defaultTxt2ImgParameters
} from '@/constants/generation-defaults';
import {
  buildComfyApiURL,
  DEFAULT_COMFYUI_HOST,
  DEFAULT_COMFYUI_PORT
} from '@/stores/image-generation/store-mappers';
import type {
  ComfyUIConfig,
  GeneratedPreviewItem,
  GenerationModelCatalog,
  ImageGenerationBackend,
  ImageGenerationMode,
  Img2ImgParameters,
  Txt2ImgParameters
} from '@/types/image-generation';

export interface PersistedImageGenerationState {
  activeBackend: ImageGenerationBackend;
  mode: ImageGenerationMode;
  comfyUI: ComfyUIConfig;
  txt2img: Txt2ImgParameters;
  img2img: Img2ImgParameters;
  history: GeneratedPreviewItem[];
}

export const DEFAULT_MODEL_CATALOG: GenerationModelCatalog = {
  samplers: [],
  schedulers: [],
  checkpoints: [],
  vaes: [],
  loras: [],
  controlnets: [],
  upscaleModels: [],
  textEncoders: [],
  diffusionModels: [],
  unets: []
};

const DEFAULT_COMFYUI_API_URL = buildComfyApiURL(
  DEFAULT_COMFYUI_HOST,
  DEFAULT_COMFYUI_PORT
);

const defaultTxt2Img: Txt2ImgParameters = {
  ...defaultTxt2ImgParameters
};

const defaultImg2Img: Img2ImgParameters = {
  ...defaultImg2ImgParameters
};

export const defaultState: PersistedImageGenerationState = {
  activeBackend: 'comfyui',
  mode: 'txt2img',
  comfyUI: {
    apiUrl: DEFAULT_COMFYUI_API_URL,
    localPath: '',
    args: '--listen 127.0.0.1 --port 7180 --normalvram --preview-method auto --use-pytorch-cross-attention --enable-manager',
    outputDir: '',
    rootDir: '',
    pythonPath: '',
    mainScriptPath: '',
    modelPathsYAML: '',
    host: DEFAULT_COMFYUI_HOST,
    port: DEFAULT_COMFYUI_PORT
  },
  txt2img: defaultTxt2Img,
  img2img: defaultImg2Img,
  history: []
};

function fallbackIfBlank(value: string | undefined, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  return value.trim() !== '' ? value : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeDimension(value: number): number {
  if (!Number.isFinite(value)) {
    return 512;
  }

  return clamp(Math.round(value), 0, 4096);
}

export function sanitizePersistedState(
  raw: unknown
): PersistedImageGenerationState | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as Partial<PersistedImageGenerationState>;
  const mode =
    candidate.mode === 'txt2img' || candidate.mode === 'img2img'
      ? candidate.mode
      : defaultState.mode;

  const nextTxt2Img: Txt2ImgParameters = {
    ...defaultState.txt2img,
    ...(candidate.txt2img ?? {}),
    resolution: {
      ...defaultState.txt2img.resolution,
      ...(candidate.txt2img?.resolution ?? {})
    },
    prompt: fallbackIfBlank(
      candidate.txt2img?.prompt,
      defaultState.txt2img.prompt
    ),
    negativePrompt: fallbackIfBlank(
      candidate.txt2img?.negativePrompt,
      defaultState.txt2img.negativePrompt
    ),
    sampler: fallbackIfBlank(
      candidate.txt2img?.sampler,
      defaultState.txt2img.sampler
    ),
    vae: fallbackIfBlank(candidate.txt2img?.vae, defaultState.txt2img.vae),
    scheduler: fallbackIfBlank(
      candidate.txt2img?.scheduler,
      defaultState.txt2img.scheduler
    )
  };
  const nextImg2Img: Img2ImgParameters = {
    ...defaultState.img2img,
    ...(candidate.img2img ?? {}),
    resolution: {
      ...defaultState.img2img.resolution,
      ...(candidate.img2img?.resolution ?? {})
    },
    prompt: fallbackIfBlank(
      candidate.img2img?.prompt,
      defaultState.img2img.prompt
    ),
    negativePrompt: fallbackIfBlank(
      candidate.img2img?.negativePrompt,
      defaultState.img2img.negativePrompt
    ),
    sampler: fallbackIfBlank(
      candidate.img2img?.sampler,
      defaultState.img2img.sampler
    ),
    vae: fallbackIfBlank(candidate.img2img?.vae, defaultState.img2img.vae),
    scheduler: fallbackIfBlank(
      candidate.img2img?.scheduler,
      defaultState.img2img.scheduler
    )
  };

  const normalizedTxt2Img: Txt2ImgParameters = {
    ...nextTxt2Img,
    resolution: {
      width: normalizeDimension(nextTxt2Img.resolution.width),
      height: normalizeDimension(nextTxt2Img.resolution.height)
    },
    steps:
      Number.isFinite(nextTxt2Img.steps) && nextTxt2Img.steps > 0
        ? clamp(Math.round(nextTxt2Img.steps), 1, 200)
        : defaultState.txt2img.steps,
    cfgScale:
      Number.isFinite(nextTxt2Img.cfgScale) && nextTxt2Img.cfgScale > 0
        ? clamp(nextTxt2Img.cfgScale, 0.1, 30)
        : defaultState.txt2img.cfgScale
  };
  const normalizedImg2Img: Img2ImgParameters = {
    ...nextImg2Img,
    resolution: {
      width: normalizeDimension(nextImg2Img.resolution.width),
      height: normalizeDimension(nextImg2Img.resolution.height)
    },
    steps:
      Number.isFinite(nextImg2Img.steps) && nextImg2Img.steps > 0
        ? clamp(Math.round(nextImg2Img.steps), 1, 200)
        : defaultState.img2img.steps,
    cfgScale:
      Number.isFinite(nextImg2Img.cfgScale) && nextImg2Img.cfgScale > 0
        ? clamp(nextImg2Img.cfgScale, 0.1, 30)
        : defaultState.img2img.cfgScale,
    denoiseStrength: Number.isFinite(nextImg2Img.denoiseStrength)
      ? clamp(nextImg2Img.denoiseStrength, 0, 1)
      : defaultState.img2img.denoiseStrength
  };

  return {
    ...defaultState,
    activeBackend: 'comfyui',
    mode,
    comfyUI: {
      ...defaultState.comfyUI,
      ...(candidate.comfyUI ?? {})
    },
    txt2img: normalizedTxt2Img,
    img2img: normalizedImg2Img,
    history: Array.isArray(candidate.history)
      ? candidate.history.slice(0, 24).filter((item) => Boolean(item?.id))
      : []
  };
}

export function getEventPayload<T>(data: unknown): T | undefined {
  if (Array.isArray(data)) {
    return data[0] as T | undefined;
  }

  return data as T | undefined;
}

export function setupNotReadyMessage(setup: {
  statusMessage: string;
  lastError: string;
}): string {
  return (
    setup.statusMessage ||
    setup.lastError ||
    'ComfyUI is not installed yet. Complete setup first.'
  );
}

function isSameResolution(
  a: { width: number; height: number },
  b: { width: number; height: number }
): boolean {
  return a.width === b.width && a.height === b.height;
}

export function isSameTxt2Img(a: Txt2ImgParameters, b: Txt2ImgParameters): boolean {
  return (
    a.prompt === b.prompt &&
    a.negativePrompt === b.negativePrompt &&
    a.seed === b.seed &&
    a.steps === b.steps &&
    a.cfgScale === b.cfgScale &&
    isSameResolution(a.resolution, b.resolution) &&
    a.model === b.model &&
    a.vae === b.vae &&
    a.sampler === b.sampler &&
    a.scheduler === b.scheduler
  );
}

export function isSameImg2Img(a: Img2ImgParameters, b: Img2ImgParameters): boolean {
  return (
    isSameTxt2Img(a, b) &&
    a.sourceImagePath === b.sourceImagePath &&
    a.denoiseStrength === b.denoiseStrength
  );
}

export function buildPreviewItem(
  state: PersistedImageGenerationState
): GeneratedPreviewItem {
  const current = state.mode === 'txt2img' ? state.txt2img : state.img2img;

  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    backend: 'comfyui',
    mode: state.mode,
    prompt: current.prompt.trim() || '(empty prompt)',
    createdAtISO: new Date().toISOString(),
    resolution: {
      width: current.resolution.width,
      height: current.resolution.height
    },
    steps: current.steps,
    cfgScale: current.cfgScale,
    seed: current.seed.trim() || 'random'
  };
}
