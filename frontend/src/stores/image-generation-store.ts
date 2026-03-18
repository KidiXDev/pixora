import {
  ComfyUIConfig,
  ComfyUILogEntry,
  ComfyUIStatus,
  GeneratedPreviewItem,
  GenerationModelCatalog,
  ImageGenerationBackend,
  ImageGenerationMode,
  Img2ImgParameters,
  Txt2ImgParameters
} from '@/types/image-generation';
import { Events } from '@wailsio/runtime';
import { create } from 'zustand';
import {
  ComfyUIBackendConfig,
  GenerationPanelConfig
} from '../../bindings/pixora/internal/config/models';
import {
  ClearLogs,
  GetComfyUIConfig,
  GetStatus,
  ListLogs,
  Restart,
  SetComfyUIConfig,
  Start,
  Stop
} from '../../bindings/pixora/internal/services/comfyuimanager';
import {
  GetGenerationPanelConfig,
  GetModelCatalog,
  SetGenerationPanelConfig
} from '../../bindings/pixora/internal/services/generationservice';

interface PersistedImageGenerationState {
  activeBackend: ImageGenerationBackend;
  mode: ImageGenerationMode;
  comfyUI: ComfyUIConfig;
  txt2img: Txt2ImgParameters;
  img2img: Img2ImgParameters;
  history: GeneratedPreviewItem[];
}

interface ImageGenerationState extends PersistedImageGenerationState {
  comfyStatus: ComfyUIStatus;
  modelCatalog: GenerationModelCatalog;
  comfyLogs: ComfyUILogEntry[];
  comfyError: string;
  modelCatalogError: string;
  isComfyActionPending: boolean;
  isModelCatalogLoading: boolean;
  isComfyLogsLoading: boolean;
  isComfyConfigSaving: boolean;

  initializeComfyLifecycle: () => Promise<void>;
  loadModelCatalog: () => Promise<void>;
  saveComfyUIConfig: () => Promise<void>;
  startComfyUI: () => Promise<void>;
  stopComfyUI: () => Promise<void>;
  restartComfyUI: () => Promise<void>;
  loadComfyLogs: (limit?: number) => Promise<void>;
  clearComfyLogs: () => Promise<void>;

  setMode: (mode: ImageGenerationMode) => void;
  updateComfyUIConfig: (patch: Partial<ComfyUIConfig>) => void;
  updateTxt2Img: (patch: Partial<Txt2ImgParameters>) => void;
  updateImg2Img: (patch: Partial<Img2ImgParameters>) => void;
  generatePreviewPlaceholder: () => void;
  clearHistory: () => void;
}

interface WailsEventLike {
  data: unknown;
}

const DEFAULT_COMFYUI_HOST = '127.0.0.1';
const DEFAULT_COMFYUI_PORT = 7180;
const DEFAULT_COMFYUI_API_URL = buildComfyApiURL(
  DEFAULT_COMFYUI_HOST,
  DEFAULT_COMFYUI_PORT
);

let comfyEventUnsubscribers: Array<() => void> = [];
let comfyEventsBound = false;
let generationPanelPersistTimer: ReturnType<typeof setTimeout> | null = null;

const DEFAULT_MODEL_CATALOG: GenerationModelCatalog = {
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

const defaultTxt2Img: Txt2ImgParameters = {
  prompt: '',
  negativePrompt: '',
  seed: '',
  steps: 28,
  cfgScale: 7,
  resolution: { width: 1024, height: 1024 },
  model: '',
  vae: '',
  sampler: '',
  scheduler: ''
};

const defaultImg2Img: Img2ImgParameters = {
  ...defaultTxt2Img,
  sourceImagePath: '',
  denoiseStrength: 0.55
};

const defaultState: PersistedImageGenerationState = {
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

function sanitizePersistedState(
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

  return {
    ...defaultState,
    activeBackend: 'comfyui',
    mode,
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
      },
      vae: candidate.txt2img?.vae || defaultState.txt2img.vae,
      scheduler: candidate.txt2img?.scheduler || defaultState.txt2img.scheduler
    },
    img2img: {
      ...defaultState.img2img,
      ...(candidate.img2img ?? {}),
      resolution: {
        ...defaultState.img2img.resolution,
        ...(candidate.img2img?.resolution ?? {})
      },
      vae: candidate.img2img?.vae || defaultState.img2img.vae,
      scheduler: candidate.img2img?.scheduler || defaultState.img2img.scheduler
    },
    history: Array.isArray(candidate.history)
      ? candidate.history.slice(0, 24).filter((item) => Boolean(item?.id))
      : []
  };
}

function normalizeComfyPort(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_COMFYUI_PORT;
  }

  const rounded = Math.round(value);
  if (rounded <= 0 || rounded > 65535) {
    return DEFAULT_COMFYUI_PORT;
  }

  return rounded;
}

function buildComfyApiURL(host: string, port: number): string {
  const normalizedHost = host.trim() || DEFAULT_COMFYUI_HOST;
  const normalizedPort = normalizeComfyPort(port);
  return `http://${normalizedHost}:${normalizedPort.toString(10)}`;
}

function mapBackendConfigToComfyUI(
  backend: ComfyUIBackendConfig,
  current: ComfyUIConfig
): ComfyUIConfig {
  const host = backend.host.trim() || current.host || DEFAULT_COMFYUI_HOST;
  const port = normalizeComfyPort(backend.port || current.port);

  return {
    ...current,
    rootDir: backend.rootDir,
    pythonPath: backend.pythonPath,
    mainScriptPath: backend.mainScriptPath,
    modelPathsYAML: backend.modelPathsYAML,
    args: backend.args,
    outputDir: backend.outputDir,
    host,
    port,
    localPath: backend.mainScriptPath,
    apiUrl: buildComfyApiURL(host, port)
  };
}

function toBackendComfyConfig(input: ComfyUIConfig): ComfyUIBackendConfig {
  return new ComfyUIBackendConfig({
    rootDir: input.rootDir,
    pythonPath: input.pythonPath,
    mainScriptPath: input.mainScriptPath,
    args: input.args,
    outputDir: input.outputDir,
    modelPathsYAML: input.modelPathsYAML,
    host: input.host,
    port: normalizeComfyPort(input.port)
  });
}

function mapStatus(input: {
  state: string;
  running: boolean;
  pid: number;
  host: string;
  port: number;
  startedAt: string;
  lastError: string;
}): ComfyUIStatus {
  return {
    state:
      input.state === 'starting' ||
      input.state === 'running' ||
      input.state === 'stopping' ||
      input.state === 'error'
        ? input.state
        : 'stopped',
    running: input.running,
    pid: Number.isFinite(input.pid) ? input.pid : 0,
    host: input.host || DEFAULT_COMFYUI_HOST,
    port: normalizeComfyPort(input.port),
    startedAt: input.startedAt || '',
    lastError: input.lastError || ''
  };
}

function mapLog(input: {
  timestamp: string;
  level: string;
  stream: string;
  message: string;
}): ComfyUILogEntry {
  return {
    timestamp: input.timestamp || '',
    level: (input.level || 'info').toLowerCase(),
    stream: (input.stream || 'stdout').toLowerCase(),
    message: input.message || ''
  };
}

function mapModelCatalog(
  input: {
    samplers: string[];
    checkpoints: string[];
    vaes: string[];
    loras: string[];
    controlnets: string[];
    upscaleModels: string[];
    textEncoders: string[];
    diffusionModels: string[];
    unets: string[];
    schedulers: string[];
  } | null
): GenerationModelCatalog {
  if (!input) {
    return DEFAULT_MODEL_CATALOG;
  }

  return {
    samplers: input.samplers,
    checkpoints: input.checkpoints,
    vaes: input.vaes,
    loras: input.loras,
    controlnets: input.controlnets,
    upscaleModels: input.upscaleModels,
    textEncoders: input.textEncoders,
    diffusionModels: input.diffusionModels,
    unets: input.unets,
    schedulers: input.schedulers
  };
}

function applyCatalogDefaults(
  txt2img: Txt2ImgParameters,
  img2img: Img2ImgParameters,
  catalog: GenerationModelCatalog
): { txt2img: Txt2ImgParameters; img2img: Img2ImgParameters } {
  const firstCheckpoint = catalog.checkpoints[0] ?? '';
  const firstSampler = catalog.samplers[0] ?? txt2img.sampler;
  const firstScheduler = catalog.schedulers[0] ?? txt2img.scheduler;
  const firstVAE = catalog.vaes[0] ?? 'Auto';

  return {
    txt2img: {
      ...txt2img,
      model: txt2img.model || firstCheckpoint,
      sampler: txt2img.sampler || firstSampler,
      scheduler: txt2img.scheduler || firstScheduler,
      vae: txt2img.vae || firstVAE
    },
    img2img: {
      ...img2img,
      model: img2img.model || firstCheckpoint,
      sampler: img2img.sampler || firstSampler,
      scheduler: img2img.scheduler || firstScheduler,
      vae: img2img.vae || firstVAE
    }
  };
}

function getEventPayload<T>(data: unknown): T | undefined {
  if (Array.isArray(data)) {
    return data[0] as T | undefined;
  }

  return data as T | undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  if (typeof error === 'string' && error.trim() !== '') {
    return error;
  }

  return 'Unknown ComfyUI error';
}

function toPersistedState(
  state: ImageGenerationState
): PersistedImageGenerationState {
  return {
    activeBackend: state.activeBackend,
    mode: state.mode,
    comfyUI: state.comfyUI,
    txt2img: state.txt2img,
    img2img: state.img2img,
    history: state.history
  };
}

function toGenerationPanelConfig(
  state: PersistedImageGenerationState
): GenerationPanelConfig {
  return new GenerationPanelConfig({
    activeBackend: state.activeBackend,
    mode: state.mode,
    txt2img: state.txt2img,
    img2img: state.img2img,
    history: state.history
  });
}

function queuePersistGenerationPanelState(
  state: PersistedImageGenerationState
): void {
  if (generationPanelPersistTimer !== null) {
    clearTimeout(generationPanelPersistTimer);
  }

  const payload = toGenerationPanelConfig(state);
  generationPanelPersistTimer = setTimeout(() => {
    generationPanelPersistTimer = null;
    void SetGenerationPanelConfig(payload).catch(() => {
      // Ignore persistence failures here to keep typing/editing smooth.
    });
  }, 250);
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

const initialState = defaultState;

const defaultComfyStatus: ComfyUIStatus = {
  state: 'stopped',
  running: false,
  pid: 0,
  host: initialState.comfyUI.host,
  port: normalizeComfyPort(initialState.comfyUI.port),
  startedAt: '',
  lastError: ''
};

export const useImageGenerationStore = create<ImageGenerationState>(
  (set, get) => ({
    ...initialState,
    comfyStatus: defaultComfyStatus,
    modelCatalog: DEFAULT_MODEL_CATALOG,
    comfyLogs: [],
    comfyError: '',
    modelCatalogError: '',
    isComfyActionPending: false,
    isModelCatalogLoading: false,
    isComfyLogsLoading: false,
    isComfyConfigSaving: false,

    loadModelCatalog: async () => {
      set({ isModelCatalogLoading: true, modelCatalogError: '' });
      try {
        const catalogResponse = await GetModelCatalog();
        const catalog = mapModelCatalog(catalogResponse);
        set((state) => {
          const withDefaults = applyCatalogDefaults(
            state.txt2img,
            state.img2img,
            catalog
          );

          return {
            modelCatalog: catalog,
            txt2img: withDefaults.txt2img,
            img2img: withDefaults.img2img,
            isModelCatalogLoading: false
          };
        });
        queuePersistGenerationPanelState(toPersistedState(get()));
      } catch (error) {
        set({
          isModelCatalogLoading: false,
          modelCatalogError: toErrorMessage(error)
        });
      }
    },

    initializeComfyLifecycle: async () => {
      if (!comfyEventsBound) {
        const unsubscribeStatus = Events.On(
          'comfyui:status',
          (event: WailsEventLike) => {
            const payload = getEventPayload<{
              state: string;
              running: boolean;
              pid: number;
              host: string;
              port: number;
              startedAt: string;
              lastError: string;
            }>(event.data);

            if (!payload) {
              return;
            }

            const status = mapStatus(payload);
            set((state) => ({
              comfyStatus: status,
              comfyError: status.lastError || state.comfyError,
              comfyUI: {
                ...state.comfyUI,
                host: status.host,
                port: status.port,
                apiUrl: buildComfyApiURL(status.host, status.port)
              }
            }));
          }
        );

        const unsubscribeLog = Events.On(
          'comfyui:log',
          (event: WailsEventLike) => {
            const payload = getEventPayload<{
              timestamp: string;
              level: string;
              stream: string;
              message: string;
            }>(event.data);
            if (!payload || !payload.message) {
              return;
            }

            const entry = mapLog(payload);
            set((state) => ({
              comfyLogs: [...state.comfyLogs, entry].slice(-1000)
            }));
          }
        );

        comfyEventUnsubscribers = [unsubscribeStatus, unsubscribeLog];
        comfyEventsBound = true;
      }

      try {
        const [backendConfig, status, logs, catalogResponse, panelConfig] =
          await Promise.all([
            GetComfyUIConfig(),
            GetStatus(),
            ListLogs(400),
            GetModelCatalog(),
            GetGenerationPanelConfig()
          ]);

        const catalog = mapModelCatalog(catalogResponse);
        const persistedPanel =
          sanitizePersistedState(panelConfig) ?? defaultState;

        set((state) => ({
          activeBackend: persistedPanel.activeBackend,
          mode: persistedPanel.mode,
          ...applyCatalogDefaults(
            persistedPanel.txt2img,
            persistedPanel.img2img,
            catalog
          ),
          history: persistedPanel.history,
          modelCatalog: catalog,
          comfyUI: mapBackendConfigToComfyUI(backendConfig, state.comfyUI),
          comfyStatus: mapStatus(status),
          comfyLogs: logs.map(mapLog),
          comfyError: status.lastError || ''
        }));

        queuePersistGenerationPanelState(toPersistedState(get()));
      } catch (error) {
        set({ comfyError: toErrorMessage(error) });
      }
    },

    saveComfyUIConfig: async () => {
      set({ isComfyConfigSaving: true, comfyError: '' });
      try {
        const current = get().comfyUI;
        const saved = await SetComfyUIConfig(toBackendComfyConfig(current));
        set((state) => ({
          comfyUI: mapBackendConfigToComfyUI(saved, state.comfyUI),
          isComfyConfigSaving: false
        }));
        queuePersistGenerationPanelState(toPersistedState(get()));
      } catch (error) {
        set({
          isComfyConfigSaving: false,
          comfyError: toErrorMessage(error)
        });
        throw error;
      }
    },

    startComfyUI: async () => {
      set({ isComfyActionPending: true, comfyError: '' });
      try {
        await get().saveComfyUIConfig();
        await Start();
        const status = await GetStatus();
        set({ comfyStatus: mapStatus(status), isComfyActionPending: false });
      } catch (error) {
        set({
          isComfyActionPending: false,
          comfyError: toErrorMessage(error)
        });
      }
    },

    stopComfyUI: async () => {
      set({ isComfyActionPending: true, comfyError: '' });
      try {
        await Stop();
        const status = await GetStatus();
        set({ comfyStatus: mapStatus(status), isComfyActionPending: false });
      } catch (error) {
        set({
          isComfyActionPending: false,
          comfyError: toErrorMessage(error)
        });
      }
    },

    restartComfyUI: async () => {
      set({ isComfyActionPending: true, comfyError: '' });
      try {
        await get().saveComfyUIConfig();
        await Restart();
        const status = await GetStatus();
        set({ comfyStatus: mapStatus(status), isComfyActionPending: false });
      } catch (error) {
        set({
          isComfyActionPending: false,
          comfyError: toErrorMessage(error)
        });
      }
    },

    loadComfyLogs: async (limit = 400) => {
      set({ isComfyLogsLoading: true });
      try {
        const logs = await ListLogs(limit);
        set({
          comfyLogs: logs.map(mapLog),
          isComfyLogsLoading: false
        });
      } catch (error) {
        set({
          isComfyLogsLoading: false,
          comfyError: toErrorMessage(error)
        });
      }
    },

    clearComfyLogs: async () => {
      try {
        await ClearLogs();
        set({ comfyLogs: [] });
      } catch (error) {
        set({ comfyError: toErrorMessage(error) });
      }
    },

    setMode: (mode) => {
      set({ mode });
      queuePersistGenerationPanelState(toPersistedState(get()));
    },

    updateComfyUIConfig: (patch) => {
      set((state) => ({
        comfyUI: (() => {
          const merged = {
            ...state.comfyUI,
            ...patch
          };

          const host = merged.host.trim() || DEFAULT_COMFYUI_HOST;
          const port = normalizeComfyPort(merged.port);

          return {
            ...merged,
            host,
            port,
            apiUrl: buildComfyApiURL(host, port),
            localPath: merged.mainScriptPath || merged.localPath
          };
        })()
      }));
      queuePersistGenerationPanelState(toPersistedState(get()));
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
      queuePersistGenerationPanelState(toPersistedState(get()));
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
      queuePersistGenerationPanelState(toPersistedState(get()));
    },

    generatePreviewPlaceholder: () => {
      const persisted = toPersistedState(get());
      const item = buildPreviewItem(persisted);
      set((state) => ({
        history: [item, ...state.history].slice(0, 24)
      }));
      queuePersistGenerationPanelState(toPersistedState(get()));
    },

    clearHistory: () => {
      set({ history: [] });
      queuePersistGenerationPanelState(toPersistedState(get()));
    }
  })
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (generationPanelPersistTimer !== null) {
      clearTimeout(generationPanelPersistTimer);
      generationPanelPersistTimer = null;
    }
    for (const unsubscribe of comfyEventUnsubscribers) {
      unsubscribe();
    }
    comfyEventUnsubscribers = [];
    comfyEventsBound = false;
  });
}
