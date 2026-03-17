
import {
  ComfyUIConfig,
  GeneratedPreviewItem,
  ImageGenerationBackend,
  ImageGenerationMode,
  Img2ImgParameters,
  StableDiffusionWebUIConfig,
  Txt2ImgParameters
} from '@/types/image-generation';
import { create } from 'zustand';

const STORAGE_KEY = 'pixora:image-generation-ui';

interface PersistedImageGenerationState {
  activeBackend: ImageGenerationBackend;
  mode: ImageGenerationMode;
  stableDiffusion: StableDiffusionWebUIConfig;
  comfyUI: ComfyUIConfig;
  txt2img: Txt2ImgParameters;
  img2img: Img2ImgParameters;
  history: GeneratedPreviewItem[];
}

interface ImageGenerationState extends PersistedImageGenerationState {
  setActiveBackend: (backend: ImageGenerationBackend) => void;
  setMode: (mode: ImageGenerationMode) => void;
  updateStableDiffusionConfig: (
    patch: Partial<StableDiffusionWebUIConfig>
  ) => void;
  updateComfyUIConfig: (patch: Partial<ComfyUIConfig>) => void;
  updateTxt2Img: (patch: Partial<Txt2ImgParameters>) => void;
  updateImg2Img: (patch: Partial<Img2ImgParameters>) => void;
  generatePreviewPlaceholder: () => void;
  clearHistory: () => void;
}

const DEFAULT_SD_WEBUI_API_URL = 'http://127.0.0.1:7860';
const DEFAULT_COMFYUI_API_URL = 'http://127.0.0.1:8188';

const defaultTxt2Img: Txt2ImgParameters = {
  prompt: '',
  negativePrompt: '',
  seed: '',
  steps: 28,
  cfgScale: 7,
  resolution: { width: 1024, height: 1024 },
  model: '',
  sampler: 'DPM++ 2M Karras'
};

const defaultImg2Img: Img2ImgParameters = {
  ...defaultTxt2Img,
  sourceImagePath: '',
  denoiseStrength: 0.55
};

const defaultState: PersistedImageGenerationState = {
  activeBackend: 'stable-diffusion-webui',
  mode: 'txt2img',
  stableDiffusion: {
    apiUrl: DEFAULT_SD_WEBUI_API_URL,
    localPath: ''
  },
  comfyUI: {
    apiUrl: DEFAULT_COMFYUI_API_URL,
    localPath: ''
  },
  txt2img: defaultTxt2Img,
  img2img: defaultImg2Img,
  history: []
};

function sanitizePersistedState(
  raw: unknown
): PersistedImageGenerationState | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as Partial<PersistedImageGenerationState>;
  const activeBackend =
    candidate.activeBackend === 'stable-diffusion-webui' ||
    candidate.activeBackend === 'comfyui'
      ? candidate.activeBackend
      : defaultState.activeBackend;
  const mode =
    candidate.mode === 'txt2img' || candidate.mode === 'img2img'
      ? candidate.mode
      : defaultState.mode;

  return {
    ...defaultState,
    activeBackend,
    mode,
    stableDiffusion: {
      ...defaultState.stableDiffusion,
      ...(candidate.stableDiffusion ?? {})
    },
    comfyUI: {
      ...defaultState.comfyUI,
      ...(candidate.comfyUI ?? {})
    },
    txt2img: {
      ...defaultState.txt2img,
      ...(candidate.txt2img ?? {}),
      resolution: {
        ...defaultState.txt2img.resolution,
        ...(candidate.txt2img?.resolution ?? {})
      }
    },
    img2img: {
      ...defaultState.img2img,
      ...(candidate.img2img ?? {}),
      resolution: {
        ...defaultState.img2img.resolution,
        ...(candidate.img2img?.resolution ?? {})
      }
    },
    history: Array.isArray(candidate.history)
      ? candidate.history.slice(0, 24).filter((item) => Boolean(item?.id))
      : []
  };
}

function readPersistedState(): PersistedImageGenerationState {
  if (typeof window === 'undefined') {
    return defaultState;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultState;
    }

    const parsed = JSON.parse(raw) as unknown;
    return sanitizePersistedState(parsed) ?? defaultState;
  } catch {
    return defaultState;
  }
}

function persistState(state: PersistedImageGenerationState): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function toPersistedState(
  state: ImageGenerationState
): PersistedImageGenerationState {
  return {
    activeBackend: state.activeBackend,
    mode: state.mode,
    stableDiffusion: state.stableDiffusion,
    comfyUI: state.comfyUI,
    txt2img: state.txt2img,
    img2img: state.img2img,
    history: state.history
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value)) {
    return 512;
  }

  return clamp(Math.round(value), 0, 4096);
}

function buildPreviewItem(
  state: PersistedImageGenerationState
): GeneratedPreviewItem {
  const current = state.mode === 'txt2img' ? state.txt2img : state.img2img;

  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    backend: state.activeBackend,
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

const initialState = readPersistedState();

export const useImageGenerationStore = create<ImageGenerationState>(
  (set, get) => ({
    ...initialState,

    setActiveBackend: (backend) => {
      set({ activeBackend: backend });
      persistState(toPersistedState(get()));
    },

    setMode: (mode) => {
      set({ mode });
      persistState(toPersistedState(get()));
    },

    updateStableDiffusionConfig: (patch) => {
      set((state) => ({
        stableDiffusion: {
          ...state.stableDiffusion,
          ...patch
        }
      }));
      persistState(toPersistedState(get()));
    },

    updateComfyUIConfig: (patch) => {
      set((state) => ({
        comfyUI: {
          ...state.comfyUI,
          ...patch
        }
      }));
      persistState(toPersistedState(get()));
    },

    updateTxt2Img: (patch) => {
      set((state) => ({
        txt2img: {
          ...state.txt2img,
          ...patch,
          resolution: {
            width: normalizeDimension(
              patch.resolution?.width ?? state.txt2img.resolution.width
            ),
            height: normalizeDimension(
              patch.resolution?.height ?? state.txt2img.resolution.height
            )
          },
          steps: clamp(Math.round(patch.steps ?? state.txt2img.steps), 0, 200),
          cfgScale: clamp(patch.cfgScale ?? state.txt2img.cfgScale, 0, 30)
        }
      }));
      persistState(toPersistedState(get()));
    },

    updateImg2Img: (patch) => {
      set((state) => ({
        img2img: {
          ...state.img2img,
          ...patch,
          resolution: {
            width: normalizeDimension(
              patch.resolution?.width ?? state.img2img.resolution.width
            ),
            height: normalizeDimension(
              patch.resolution?.height ?? state.img2img.resolution.height
            )
          },
          steps: clamp(Math.round(patch.steps ?? state.img2img.steps), 0, 200),
          cfgScale: clamp(patch.cfgScale ?? state.img2img.cfgScale, 0, 30),
          denoiseStrength: clamp(
            patch.denoiseStrength ?? state.img2img.denoiseStrength,
            0,
            1
          )
        }
      }));
      persistState(toPersistedState(get()));
    },

    generatePreviewPlaceholder: () => {
      const persisted = toPersistedState(get());
      const item = buildPreviewItem(persisted);
      set((state) => ({
        history: [item, ...state.history].slice(0, 24)
      }));
      persistState(toPersistedState(get()));
    },

    clearHistory: () => {
      set({ history: [] });
      persistState(toPersistedState(get()));
    }
  })
);
