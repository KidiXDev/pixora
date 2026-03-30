import type {
  ComfyUIConfig,
  ComfyUILogEntry,
  ComfyUISetupStatus,
  ComfyUIStatus,
  GenerationModelCatalog,
  Img2ImgParameters,
  Txt2ImgParameters
} from '@/types/image-generation';
import { ComfyUIBackendConfig } from '../../../bindings/pixora/internal/config/models';

export const DEFAULT_COMFYUI_HOST = '127.0.0.1';
export const DEFAULT_COMFYUI_PORT = 7180;
export const DEFAULT_COMFYUI_PREVIEW_METHOD: ComfyUIConfig['previewMethod'] =
  'auto';

export function normalizeComfyPort(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_COMFYUI_PORT;
  }

  const rounded = Math.round(value);
  if (rounded <= 0 || rounded > 65535) {
    return DEFAULT_COMFYUI_PORT;
  }

  return rounded;
}

export function buildComfyApiURL(host: string, port: number): string {
  const normalizedHost = host.trim() || DEFAULT_COMFYUI_HOST;
  const normalizedPort = normalizeComfyPort(port);
  return `http://${normalizedHost}:${normalizedPort.toString(10)}`;
}

export function mapBackendConfigToComfyUI(
  backend: ComfyUIBackendConfig,
  current: ComfyUIConfig
): ComfyUIConfig {
  const host = backend.host.trim() || current.host || DEFAULT_COMFYUI_HOST;
  const port = normalizeComfyPort(backend.port || current.port);
  const crossAttentionMethod =
    backend.crossAttentionMethod === 'sage' ? 'sage' : 'pytorch';
  const previewMethod = normalizePreviewMethod(
    backend.previewMethod || readLegacyPreviewMethodFromArgs(backend.args)
  );

  return {
    ...current,
    rootDir: backend.rootDir,
    pythonPath: backend.pythonPath,
    mainScriptPath: backend.mainScriptPath,
    modelPathsYAML: backend.modelPathsYAML,
    args: backend.args,
    previewMethod,
    crossAttentionMethod,
    outputDir: backend.outputDir,
    host,
    port,
    localPath: backend.mainScriptPath,
    apiUrl: buildComfyApiURL(host, port)
  };
}

export function toBackendComfyConfig(input: ComfyUIConfig): ComfyUIBackendConfig {
  return new ComfyUIBackendConfig({
    rootDir: input.rootDir,
    pythonPath: input.pythonPath,
    mainScriptPath: input.mainScriptPath,
    args: input.args,
    previewMethod: input.previewMethod,
    crossAttentionMethod: input.crossAttentionMethod,
    outputDir: input.outputDir,
    modelPathsYAML: input.modelPathsYAML,
    host: input.host,
    port: normalizeComfyPort(input.port)
  });
}

function normalizePreviewMethod(raw: string): ComfyUIConfig['previewMethod'] {
  switch (raw.trim().toLowerCase()) {
    case 'taesd':
      return 'taesd';
    case 'latent2rgb':
      return 'latent2rgb';
    default:
      return DEFAULT_COMFYUI_PREVIEW_METHOD;
  }
}

function readLegacyPreviewMethodFromArgs(args: string): string {
  const tokens = args
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '');

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--preview-method') {
      return tokens[index + 1] || '';
    }
    if (token.startsWith('--preview-method=')) {
      return token.slice('--preview-method='.length);
    }
  }

  return '';
}

export function mapStatus(input: {
  state: string;
  running: boolean;
  pid: number;
  host: string;
  port: number;
  startedAt: string;
  lastError: string;
  statusMessage?: string;
  managedExternally?: boolean;
}): ComfyUIStatus {
  return {
    state:
      input.state === 'idle' ||
      input.state === 'stopped' ||
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
    lastError: input.lastError || '',
    statusMessage: input.statusMessage || '',
    managedExternally: Boolean(input.managedExternally)
  };
}

export function normalizeStatusForSetup(
  status: ComfyUIStatus,
  setup: ComfyUISetupStatus
): ComfyUIStatus {
  if (!setup.isReady || status.running) {
    return status;
  }

  const combined = `${status.statusMessage || ''} ${status.lastError || ''}`
    .trim()
    .toLowerCase();
  const hasStaleSetupMessage =
    combined.includes('setup is not ready') ||
    combined.includes('not installed');

  if (!hasStaleSetupMessage) {
    return status;
  }

  return {
    ...status,
    lastError: '',
    statusMessage: 'ComfyUI is stopped'
  };
}

export function mapLog(input: {
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

export function applyCatalogDefaults(
  txt2img: Txt2ImgParameters,
  img2img: Img2ImgParameters,
  catalog: GenerationModelCatalog
): { txt2img: Txt2ImgParameters; img2img: Img2ImgParameters } {
  const pickOption = (
    currentValue: string,
    options: string[],
    fallback: string
  ): string => {
    if (options.length === 0) {
      return currentValue || fallback;
    }

    if (currentValue && options.includes(currentValue)) {
      return currentValue;
    }

    return options[0];
  };

  const nextTxt2ImgModel = pickOption(txt2img.model, catalog.checkpoints, '');
  const nextImg2ImgModel = pickOption(img2img.model, catalog.checkpoints, '');
  const nextTxt2ImgSampler = pickOption(
    txt2img.sampler,
    catalog.samplers,
    'euler_ancestral'
  );
  const nextImg2ImgSampler = pickOption(
    img2img.sampler,
    catalog.samplers,
    'euler_ancestral'
  );
  const nextTxt2ImgScheduler = pickOption(
    txt2img.scheduler,
    catalog.schedulers,
    'normal'
  );
  const nextImg2ImgScheduler = pickOption(
    img2img.scheduler,
    catalog.schedulers,
    'normal'
  );
  const nextTxt2ImgVAE = pickOption(txt2img.vae, catalog.vaes, 'Auto');
  const nextImg2ImgVAE = pickOption(img2img.vae, catalog.vaes, 'Auto');
  const nextTxt2ImgRefineUpscaleModel = pickOption(
    txt2img.refine.upscaleModel,
    catalog.upscaleModels,
    ''
  );
  const nextTxt2ImgSAMModel = pickOption(
    txt2img.faceDetailer.samModel,
    catalog.samModels,
    ''
  );
  const nextTxt2ImgBboxModel = pickOption(
    txt2img.faceDetailer.bboxModel,
    catalog.bboxModels,
    ''
  );

  return {
    txt2img: {
      ...txt2img,
      model: nextTxt2ImgModel,
      sampler: nextTxt2ImgSampler,
      scheduler: nextTxt2ImgScheduler,
      vae: nextTxt2ImgVAE,
      refine: {
        ...txt2img.refine,
        upscaleModel: nextTxt2ImgRefineUpscaleModel
      },
      faceDetailer: {
        ...txt2img.faceDetailer,
        samModel: nextTxt2ImgSAMModel,
        bboxModel: nextTxt2ImgBboxModel
      }
    },
    img2img: {
      ...img2img,
      model: nextImg2ImgModel,
      sampler: nextImg2ImgSampler,
      scheduler: nextImg2ImgScheduler,
      vae: nextImg2ImgVAE
    }
  };
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  if (typeof error === 'string' && error.trim() !== '') {
    return error;
  }

  return 'Unknown ComfyUI error';
}

