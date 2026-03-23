import {
  buildPreviewItem,
  clamp,
  DEFAULT_MODEL_CATALOG,
  defaultState,
  getEventPayload,
  isSameImg2Img,
  isSameTxt2Img,
  normalizeDimension,
  PersistedImageGenerationState,
  sanitizePersistedState,
  setupNotReadyMessage
} from '@/stores/image-generation/store-core';
import {
  applyCatalogDefaults,
  buildComfyApiURL,
  DEFAULT_COMFYUI_HOST,
  mapBackendConfigToComfyUI,
  mapLog,
  mapStatus,
  normalizeComfyPort,
  normalizeStatusForSetup,
  toBackendComfyConfig,
  toErrorMessage
} from '@/stores/image-generation/store-mappers';
import {
  ComfyUIConfig,
  ComfyUILogEntry,
  ComfyUISetupStatus,
  ComfyUISetupStep,
  ComfyUIStatus,
  GeneratedPreviewItem,
  GenerationModelCatalog,
  GenerationResultEvent,
  GenerationStatusEvent,
  ImageGenerationMode,
  Img2ImgParameters,
  Txt2ImgParameters
} from '@/types/image-generation';
import { Events } from '@wailsio/runtime';
import { create } from 'zustand';
import { GenerationPanelConfig } from '../../bindings/pixora/internal/config/models';
import {
  ClearLogs,
  GetComfyUIConfig,
  GetSetupStatus,
  GetStatus,
  InstallComfyUI,
  ListLogs,
  Restart,
  SetComfyUIConfig,
  Start,
  Stop
} from '../../bindings/pixora/internal/services/comfyuimanager';
import {
  CancelGenerationJob,
  GetGenerationPanelConfig,
  GetModelCatalog,
  QueueText2Image,
  SetGenerationPanelConfig
} from '../../bindings/pixora/internal/services/generationservice';

interface ImageGenerationState extends PersistedImageGenerationState {
  comfyStatus: ComfyUIStatus;
  comfySetup: ComfyUISetupStatus;
  modelCatalog: GenerationModelCatalog;
  comfyLogs: ComfyUILogEntry[];
  comfyError: string;
  modelCatalogError: string;
  isComfyActionPending: boolean;
  isComfySetupLoading: boolean;
  isComfySetupInstalling: boolean;
  isModelCatalogLoading: boolean;
  isComfyLogsLoading: boolean;
  isComfyConfigSaving: boolean;
  isGenerating: boolean;
  generationProgress: number;
  generationMessage: string;
  activeGenerationJobId: string;

  initializeComfyLifecycle: () => Promise<void>;
  refreshComfySetup: () => Promise<void>;
  installComfyUI: () => Promise<void>;
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
  generateText2Image: () => Promise<void>;
  interruptGeneration: () => Promise<void>;
  clearHistory: () => void;
}

interface WailsEventLike {
  data: unknown;
}

let comfyEventUnsubscribers: Array<() => void> = [];
let comfyEventsBound = false;
let generationPanelHydrated = false;
let generationPanelPersistTimer: ReturnType<typeof setTimeout> | null = null;
const defaultComfySetupSteps: ComfyUISetupStep[] = [
  {
    id: 'check_environment',
    label: 'Check Environment',
    status: 'pending',
    message: ''
  },
  {
    id: 'detect_comfy',
    label: 'Detect ComfyUI',
    status: 'pending',
    message: ''
  },
  {
    id: 'download_archive',
    label: 'Download Archive',
    status: 'pending',
    message: ''
  },
  {
    id: 'extract_archive',
    label: 'Extract Archive',
    status: 'pending',
    message: ''
  },
  {
    id: 'finalize_install_dir',
    label: 'Finalize Installation Folder',
    status: 'pending',
    message: ''
  },
  {
    id: 'prepare_model_paths',
    label: 'Prepare Model Paths',
    status: 'pending',
    message: ''
  },
  {
    id: 'copy_custom_nodes',
    label: 'Copy Custom Nodes',
    status: 'pending',
    message: ''
  },
  {
    id: 'complete',
    label: 'Installation Complete',
    status: 'pending',
    message: ''
  }
];

const defaultComfySetupStatus: ComfyUISetupStatus = {
  state: 'checking',
  workspaceRoot: '',
  installDir: '',
  statusMessage: 'Checking ComfyUI environment...',
  currentStepId: '',
  currentStepMessage: '',
  eventSeq: 0,
  downloadProgress: 0,
  downloadedBytes: 0,
  totalBytes: 0,
  downloadSpeed: 0,
  lastError: '',
  errorKind: '',
  permissionProblem: false,
  permissionMessage: '',
  isInstalled: false,
  isReady: false,
  requiresOnboarding: true,
  nvidiaOnly: true,
  steps: defaultComfySetupSteps
};

function mapSetupStep(input: {
  id?: string;
  label?: string;
  status?: string;
  message?: string;
}): ComfyUISetupStep {
  const status =
    input.status === 'running' ||
    input.status === 'completed' ||
    input.status === 'error'
      ? input.status
      : 'pending';

  return {
    id: input.id?.trim() || '',
    label: input.label?.trim() || '',
    status,
    message: input.message?.trim() || ''
  };
}

function mapSetupStatus(input: {
  state?: string;
  workspaceRoot?: string;
  installDir?: string;
  statusMessage?: string;
  currentStepId?: string;
  currentStepMessage?: string;
  eventSeq?: number;
  downloadProgress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  downloadSpeed?: number;
  lastError?: string;
  errorKind?: string;
  permissionProblem?: boolean;
  permissionMessage?: string;
  isInstalled?: boolean;
  isReady?: boolean;
  requiresOnboarding?: boolean;
  nvidiaOnly?: boolean;
  steps?: Array<{
    id?: string;
    label?: string;
    status?: string;
    message?: string;
  }>;
}): ComfyUISetupStatus {
  const state =
    input.state === 'missing' ||
    input.state === 'ready' ||
    input.state === 'installing' ||
    input.state === 'error'
      ? input.state
      : 'checking';

  const steps =
    Array.isArray(input.steps) && input.steps.length > 0
      ? input.steps.map(mapSetupStep)
      : defaultComfySetupSteps;

  return {
    state,
    workspaceRoot: input.workspaceRoot?.trim() || '',
    installDir: input.installDir?.trim() || '',
    statusMessage: input.statusMessage?.trim() || '',
    currentStepId: input.currentStepId?.trim() || '',
    currentStepMessage: input.currentStepMessage?.trim() || '',
    eventSeq: Number.isFinite(input.eventSeq)
      ? Math.max(0, Math.round(input.eventSeq as number))
      : 0,
    downloadProgress: Number.isFinite(input.downloadProgress)
      ? Math.max(0, Math.min(100, input.downloadProgress as number))
      : 0,
    downloadedBytes: Number.isFinite(input.downloadedBytes)
      ? Math.max(0, Math.round(input.downloadedBytes as number))
      : 0,
    totalBytes: Number.isFinite(input.totalBytes)
      ? Math.max(0, Math.round(input.totalBytes as number))
      : 0,
    downloadSpeed: Number.isFinite(input.downloadSpeed)
      ? Math.max(0, input.downloadSpeed as number)
      : 0,
    lastError: input.lastError?.trim() || '',
    errorKind: input.errorKind?.trim() || '',
    permissionProblem: Boolean(input.permissionProblem),
    permissionMessage: input.permissionMessage?.trim() || '',
    isInstalled: Boolean(input.isInstalled),
    isReady: Boolean(input.isReady),
    requiresOnboarding: Boolean(input.requiresOnboarding),
    nvidiaOnly: input.nvidiaOnly !== false,
    steps
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
  }, 600);
}

function persistFromStoreSnapshot(get: () => ImageGenerationState): void {
  queuePersistGenerationPanelState(toPersistedState(get()));
}

const initialState = defaultState;

const defaultComfyStatus: ComfyUIStatus = {
  state: 'idle',
  running: false,
  pid: 0,
  host: initialState.comfyUI.host,
  port: normalizeComfyPort(initialState.comfyUI.port),
  startedAt: '',
  lastError: '',
  statusMessage: 'ComfyUI is idle'
};

export const useImageGenerationStore = create<ImageGenerationState>(
  (set, get) => ({
    ...initialState,
    comfyStatus: defaultComfyStatus,
    comfySetup: defaultComfySetupStatus,
    modelCatalog: DEFAULT_MODEL_CATALOG,
    comfyLogs: [],
    comfyError: '',
    modelCatalogError: '',
    isComfyActionPending: false,
    isComfySetupLoading: true,
    isComfySetupInstalling: false,
    isModelCatalogLoading: false,
    isComfyLogsLoading: false,
    isComfyConfigSaving: false,
    isGenerating: false,
    generationProgress: 0,
    generationMessage: '',
    activeGenerationJobId: '',

    loadModelCatalog: async () => {
      const setup = get().comfySetup;
      if (!setup.isReady) {
        set({
          modelCatalog: DEFAULT_MODEL_CATALOG,
          modelCatalogError: '',
          isModelCatalogLoading: false
        });
        return;
      }

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
        persistFromStoreSnapshot(get);
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
              statusMessage?: string;
              managedExternally?: boolean;
            }>(event.data);

            if (!payload) {
              return;
            }

            const status = mapStatus(payload);
            set((state) => ({
              comfyStatus: status,
              comfyError: status.lastError || '',
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

        const unsubscribeSetup = Events.On(
          'comfyui:setup',
          (event: WailsEventLike) => {
            const payload = getEventPayload<{
              state: string;
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
              steps: Array<{
                id: string;
                label: string;
                status: string;
                message: string;
              }>;
            }>(event.data);
            if (!payload) {
              return;
            }

            const previousSetupReady = get().comfySetup.isReady;
            const nextSetup = mapSetupStatus(payload);
            if (nextSetup.eventSeq < get().comfySetup.eventSeq) {
              return;
            }
            set((state) => {
              const normalizedStatus = normalizeStatusForSetup(
                state.comfyStatus,
                nextSetup
              );

              return {
                comfySetup: nextSetup,
                comfyStatus: normalizedStatus,
                isComfySetupLoading: false,
                isComfySetupInstalling: nextSetup.state === 'installing',
                comfyError:
                  nextSetup.lastError.trim() !== ''
                    ? nextSetup.lastError
                    : normalizedStatus.lastError || ''
              };
            });

            if (nextSetup.isReady && !previousSetupReady) {
              void get().loadModelCatalog();
            }
          }
        );

        const unsubscribeGenerationStatus = Events.On(
          'generation:status',
          (event: WailsEventLike) => {
            const payload = getEventPayload<GenerationStatusEvent>(event.data);
            if (!payload) {
              return;
            }

            set((state) => {
              const nextIsGenerating =
                payload.state === 'queued' || payload.state === 'running';
              const nextGenerationProgress = payload.progress;
              const nextGenerationMessage = payload.message || '';
              const nextActiveGenerationJobID =
                payload.state === 'queued' || payload.state === 'running'
                  ? payload.promptId || state.activeGenerationJobId
                  : state.activeGenerationJobId === payload.promptId
                    ? ''
                    : state.activeGenerationJobId;

              let historyChanged = false;
              let nextHistory = state.history;

              const nextItemMessage =
                payload.error?.trim() !== ''
                  ? payload.error
                  : payload.message || '';

              let targetIndex = -1;
              for (let index = 0; index < state.history.length; index += 1) {
                if (state.history[index].promptId === payload.promptId) {
                  targetIndex = index;
                  break;
                }
              }

              // Race fix: status events can arrive with backend job id before
              // pending item id is remapped, so bind the active pending item.
              if (
                targetIndex < 0 &&
                (payload.state === 'queued' || payload.state === 'running')
              ) {
                const fallbackIndex = state.history.findIndex(
                  (item) =>
                    item.isGenerating === true &&
                    typeof item.promptId === 'string' &&
                    item.promptId.startsWith('pending-')
                );
                if (fallbackIndex >= 0) {
                  targetIndex = fallbackIndex;
                }
              }

              if (targetIndex >= 0) {
                const item = state.history[targetIndex];
                const nextItemIsGenerating =
                  payload.state === 'queued' || payload.state === 'running';
                const nextItemImagePath =
                  nextItemIsGenerating && payload.previewPath
                    ? payload.previewPath
                    : item.imagePath;
                const shouldRefreshItemMessage =
                  payload.state === 'error' ||
                  payload.state === 'canceled' ||
                  payload.state === 'completed' ||
                  nextItemImagePath.trim() === '';
                const resolvedMessage =
                  shouldRefreshItemMessage && nextItemMessage !== ''
                    ? nextItemMessage
                    : item.message;
                const nextPromptID = payload.promptId || item.promptId;

                if (
                  item.promptId !== nextPromptID ||
                  item.status !== payload.state ||
                  item.isGenerating !== nextItemIsGenerating ||
                  item.imagePath !== nextItemImagePath ||
                  item.message !== resolvedMessage
                ) {
                  nextHistory = [...state.history];
                  nextHistory[targetIndex] = {
                    ...item,
                    promptId: nextPromptID,
                    status: payload.state,
                    isGenerating: nextItemIsGenerating,
                    imagePath: nextItemImagePath,
                    message: resolvedMessage
                  };
                  historyChanged = true;
                }
              } else if (
                (payload.state === 'queued' || payload.state === 'running') &&
                payload.previewPath
              ) {
                // Safety net: keep preview visible even if id-mapping races.
                const fallbackItem: GeneratedPreviewItem = {
                  ...buildPreviewItem(toPersistedState(state)),
                  promptId: payload.promptId,
                  status: payload.state,
                  isGenerating: true,
                  imagePath: payload.previewPath,
                  message:
                    nextItemMessage || payload.message || 'generation running'
                };
                nextHistory = [fallbackItem, ...state.history].slice(0, 24);
                historyChanged = true;
              }

              const hasRootChanges =
                state.isGenerating !== nextIsGenerating ||
                state.generationProgress !== nextGenerationProgress ||
                state.generationMessage !== nextGenerationMessage ||
                state.activeGenerationJobId !== nextActiveGenerationJobID;

              if (!hasRootChanges && !historyChanged) {
                return state;
              }

              return {
                isGenerating: nextIsGenerating,
                generationProgress: nextGenerationProgress,
                generationMessage: nextGenerationMessage,
                activeGenerationJobId: nextActiveGenerationJobID,
                ...(historyChanged ? { history: nextHistory } : {})
              };
            });
          }
        );

        const unsubscribeGenerationResult = Events.On(
          'generation:result',
          (event: WailsEventLike) => {
            const payload = getEventPayload<GenerationResultEvent>(event.data);
            if (!payload || !payload.promptId) {
              return;
            }

            set((state) => ({
              isGenerating: false,
              generationProgress: 1,
              generationMessage: 'Generation completed',
              activeGenerationJobId:
                state.activeGenerationJobId === payload.promptId
                  ? ''
                  : state.activeGenerationJobId,
              history: state.history.map((item) =>
                item.promptId === payload.promptId
                  ? {
                      ...item,
                      imagePath: payload.imagePath || item.imagePath,
                      outputDir: payload.outputDir,
                      seed: payload.seed || item.seed,
                      status: 'completed',
                      isGenerating: false,
                      completedAtISO: new Date().toISOString()
                    }
                  : item
              )
            }));
            persistFromStoreSnapshot(get);
          }
        );

        comfyEventUnsubscribers = [
          unsubscribeStatus,
          unsubscribeLog,
          unsubscribeSetup,
          unsubscribeGenerationStatus,
          unsubscribeGenerationResult
        ];
        comfyEventsBound = true;
      }

      try {
        set({ isComfySetupLoading: true });

        const [backendConfig, status, logs, setupPayload] = await Promise.all([
          GetComfyUIConfig(),
          GetStatus(),
          ListLogs(400),
          GetSetupStatus()
        ]);

        const mappedSetup = mapSetupStatus(setupPayload);
        const mappedStatus = normalizeStatusForSetup(
          mapStatus(status),
          mappedSetup
        );

        let catalog = DEFAULT_MODEL_CATALOG;
        let catalogError = '';
        if (mappedSetup.isReady) {
          try {
            const catalogResponse = await GetModelCatalog();
            catalog = mapModelCatalog(catalogResponse);
          } catch (error) {
            catalogError = toErrorMessage(error);
          }
        }

        if (!generationPanelHydrated) {
          const panelConfig = await GetGenerationPanelConfig();
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
            comfyStatus: mappedStatus,
            comfySetup: mappedSetup,
            comfyLogs: logs.map(mapLog),
            comfyError: mappedStatus.lastError || mappedSetup.lastError || '',
            modelCatalogError: catalogError,
            isComfySetupLoading: false,
            isComfySetupInstalling: mappedSetup.state === 'installing'
          }));

          generationPanelHydrated = true;
          persistFromStoreSnapshot(get);
          return;
        }

        set((state) => {
          const withDefaults = applyCatalogDefaults(
            state.txt2img,
            state.img2img,
            catalog
          );

          return {
            ...withDefaults,
            modelCatalog: catalog,
            comfyUI: mapBackendConfigToComfyUI(backendConfig, state.comfyUI),
            comfyStatus: mappedStatus,
            comfySetup: mappedSetup,
            comfyLogs: logs.map(mapLog),
            comfyError: mappedStatus.lastError || mappedSetup.lastError || '',
            modelCatalogError: catalogError,
            isComfySetupLoading: false,
            isComfySetupInstalling: mappedSetup.state === 'installing'
          };
        });
      } catch (error) {
        set({
          comfyError: toErrorMessage(error),
          isComfySetupLoading: false
        });
      }
    },

    refreshComfySetup: async () => {
      set({ isComfySetupLoading: true });
      try {
        const setup = mapSetupStatus(await GetSetupStatus());
        set((state) => {
          const normalizedStatus = normalizeStatusForSetup(
            state.comfyStatus,
            setup
          );

          return {
            comfySetup: setup,
            comfyStatus: normalizedStatus,
            isComfySetupLoading: false,
            isComfySetupInstalling: setup.state === 'installing',
            comfyError: setup.lastError || normalizedStatus.lastError || ''
          };
        });
      } catch (error) {
        set({
          isComfySetupLoading: false,
          comfyError: toErrorMessage(error)
        });
      }
    },

    installComfyUI: async () => {
      set({
        isComfySetupInstalling: true,
        isComfySetupLoading: false,
        comfyError: ''
      });
      try {
        await InstallComfyUI();
      } catch (error) {
        set({
          isComfySetupInstalling: false,
          comfyError: toErrorMessage(error)
        });
      } finally {
        await get().refreshComfySetup();
        const latestSetup = get().comfySetup;
        if (latestSetup.isReady) {
          await get().initializeComfyLifecycle();
        }
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
        persistFromStoreSnapshot(get);
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
        const setup = get().comfySetup;
        if (!setup.isReady) {
          set({
            isComfyActionPending: false,
            comfyError: setupNotReadyMessage(setup)
          });
          return;
        }
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
        const setup = get().comfySetup;
        if (!setup.isReady) {
          set({
            isComfyActionPending: false,
            comfyError: setupNotReadyMessage(setup)
          });
          return;
        }
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
      if (!get().isGenerating) {
        persistFromStoreSnapshot(get);
      }
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
      if (!get().isGenerating) {
        persistFromStoreSnapshot(get);
      }
    },

    updateTxt2Img: (patch) => {
      const state = get();
      const nextValue: Txt2ImgParameters = {
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
        steps: clamp(Math.round(patch.steps ?? state.txt2img.steps), 1, 200),
        cfgScale: clamp(patch.cfgScale ?? state.txt2img.cfgScale, 0, 30),
        refine: {
          ...state.txt2img.refine,
          ...(patch.refine ?? {}),
          upscaleMethod:
            patch.refine?.upscaleMethod ?? state.txt2img.refine.upscaleMethod,
          upscaleMode:
            patch.refine?.upscaleMode ?? state.txt2img.refine.upscaleMode,
          upscaleModel:
            patch.refine?.upscaleModel ?? state.txt2img.refine.upscaleModel,
          enabled: patch.refine?.enabled ?? state.txt2img.refine.enabled,
          scaleBy: clamp(
            patch.refine?.scaleBy ?? state.txt2img.refine.scaleBy,
            1.05,
            4
          ),
          steps: clamp(
            Math.round(patch.refine?.steps ?? state.txt2img.refine.steps),
            1,
            80
          ),
          denoiseStrength: clamp(
            patch.refine?.denoiseStrength ??
              state.txt2img.refine.denoiseStrength,
            0.05,
            1
          )
        }
      };

      if (isSameTxt2Img(state.txt2img, nextValue)) {
        return;
      }

      set({ txt2img: nextValue });
      if (!get().isGenerating) {
        persistFromStoreSnapshot(get);
      }
    },

    updateImg2Img: (patch) => {
      const state = get();
      const nextValue: Img2ImgParameters = {
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
        steps: clamp(Math.round(patch.steps ?? state.img2img.steps), 1, 200),
        cfgScale: clamp(patch.cfgScale ?? state.img2img.cfgScale, 0, 30),
        denoiseStrength: clamp(
          patch.denoiseStrength ?? state.img2img.denoiseStrength,
          0,
          1
        )
      };

      if (isSameImg2Img(state.img2img, nextValue)) {
        return;
      }

      set({ img2img: nextValue });
      if (!get().isGenerating) {
        persistFromStoreSnapshot(get);
      }
    },

    generateText2Image: async () => {
      const state = get();
      if (!state.comfySetup.isReady) {
        set({
          comfyError:
            state.comfySetup.statusMessage ||
            state.comfySetup.lastError ||
            'ComfyUI setup is not ready yet.'
        });
        return;
      }

      if (state.mode !== 'txt2img') {
        set({ comfyError: 'Only txt2img generation is supported for now.' });
        return;
      }

      if (!state.comfyStatus.running) {
        set({ comfyError: 'ComfyUI is not running. Start backend first.' });
        return;
      }

      const persisted = toPersistedState(state);
      const item = buildPreviewItem(persisted);
      const pendingPromptID = `pending-${Date.now().toString(36)}`;
      const pendingItem: GeneratedPreviewItem = {
        ...item,
        promptId: pendingPromptID,
        status: 'queued',
        isGenerating: true,
        message: 'Queueing generation...'
      };

      set((current) => ({
        isGenerating: true,
        generationProgress: 0,
        generationMessage: 'Queueing generation...',
        activeGenerationJobId: pendingPromptID,
        history: [pendingItem, ...current.history].slice(0, 24)
      }));
      persistFromStoreSnapshot(get);

      try {
        const queued = await QueueText2Image({
          requestId: pendingPromptID,
          mode: state.mode,
          prompt: state.txt2img.prompt,
          negativePrompt: state.txt2img.negativePrompt,
          seed: state.txt2img.seed,
          steps: state.txt2img.steps,
          cfgScale: state.txt2img.cfgScale,
          width: state.txt2img.resolution.width,
          height: state.txt2img.resolution.height,
          model: state.txt2img.model,
          vae: state.txt2img.vae,
          sampler: state.txt2img.sampler,
          scheduler: state.txt2img.scheduler,
          refine: state.txt2img.refine
        });

        const resolvedPromptID = queued?.jobId || pendingPromptID;

        set((current) => ({
          isGenerating: true,
          generationProgress: 0,
          generationMessage: 'Queued generation...',
          activeGenerationJobId: resolvedPromptID,
          history: current.history.map((historyItem) => {
            if (historyItem.promptId !== pendingPromptID) {
              return historyItem;
            }

            return {
              ...historyItem,
              promptId: resolvedPromptID,
              status: 'queued',
              isGenerating: true,
              message: 'Queued generation...'
            };
          })
        }));
        persistFromStoreSnapshot(get);
      } catch (error) {
        const message = toErrorMessage(error);
        set((current) => ({
          isGenerating: false,
          generationProgress: 0,
          generationMessage: '',
          activeGenerationJobId: '',
          comfyError: message,
          history: current.history.map((historyItem) => {
            if (historyItem.promptId !== pendingPromptID) {
              return historyItem;
            }

            return {
              ...historyItem,
              status: 'error',
              isGenerating: false,
              message
            };
          })
        }));
        persistFromStoreSnapshot(get);
      }
    },

    interruptGeneration: async () => {
      const state = get();
      const jobID = state.activeGenerationJobId.trim();
      if (jobID === '') {
        return;
      }

      try {
        await CancelGenerationJob(jobID);
        set((current) => ({
          isGenerating: false,
          generationProgress: 0,
          generationMessage: 'Generation interrupted',
          activeGenerationJobId: '',
          history: current.history.map((item) =>
            item.promptId === jobID
              ? {
                  ...item,
                  status: 'canceled',
                  isGenerating: false,
                  message: 'Generation interrupted'
                }
              : item
          )
        }));
        persistFromStoreSnapshot(get);
      } catch (error) {
        set({ comfyError: toErrorMessage(error) });
      }
    },

    clearHistory: () => {
      set({ history: [] });
      persistFromStoreSnapshot(get);
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
    generationPanelHydrated = false;
  });
}
