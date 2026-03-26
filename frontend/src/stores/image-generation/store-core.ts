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
  generateForever: boolean;
}

export const DEFAULT_MODEL_CATALOG: GenerationModelCatalog = {
  samplers: [],
  schedulers: [],
  bboxModels: [],
  samModels: [],
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
    args: '--listen 127.0.0.1 --port 7180 --normalvram --preview-method auto --use-pytorch-cross-attention',
    crossAttentionMethod: 'pytorch',
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
  history: [],
  generateForever: false
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
    prompt: candidate.txt2img?.prompt ?? defaultState.txt2img.prompt,
    negativePrompt:
      candidate.txt2img?.negativePrompt ??
      defaultState.txt2img.negativePrompt,
    sampler: fallbackIfBlank(
      candidate.txt2img?.sampler,
      defaultState.txt2img.sampler
    ),
    variationSeed: candidate.txt2img?.variationSeed ?? defaultState.txt2img.variationSeed,
    vae: fallbackIfBlank(candidate.txt2img?.vae, defaultState.txt2img.vae),
    scheduler: fallbackIfBlank(
      candidate.txt2img?.scheduler,
      defaultState.txt2img.scheduler
    ),
    refine: {
      ...defaultState.txt2img.refine,
      ...(candidate.txt2img?.refine ?? {}),
      upscaleMethod: fallbackIfBlank(
        candidate.txt2img?.refine?.upscaleMethod,
        defaultState.txt2img.refine.upscaleMethod
      ),
      upscaleModel: candidate.txt2img?.refine?.upscaleModel ?? defaultState.txt2img.refine.upscaleModel
    },
    clipSkip: {
      ...defaultState.txt2img.clipSkip,
      ...(candidate.txt2img?.clipSkip ?? {})
    },
    faceDetailer: {
      ...defaultState.txt2img.faceDetailer,
      ...(candidate.txt2img?.faceDetailer ?? {})
    }
  };
  const nextImg2Img: Img2ImgParameters = {
    ...defaultState.img2img,
    ...(candidate.img2img ?? {}),
    resolution: {
      ...defaultState.img2img.resolution,
      ...(candidate.img2img?.resolution ?? {})
    },
    prompt: candidate.img2img?.prompt ?? defaultState.img2img.prompt,
    negativePrompt:
      candidate.img2img?.negativePrompt ??
      defaultState.img2img.negativePrompt,
    sampler: fallbackIfBlank(
      candidate.img2img?.sampler,
      defaultState.img2img.sampler
    ),
    variationSeed: candidate.img2img?.variationSeed ?? defaultState.img2img.variationSeed,
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
        : defaultState.txt2img.cfgScale,
    variationSeedStrength: Number.isFinite(nextTxt2Img.variationSeedStrength)
      ? clamp(nextTxt2Img.variationSeedStrength, 0, 1)
      : defaultState.txt2img.variationSeedStrength,
    batchSize:
      Number.isFinite(nextTxt2Img.batchSize) && nextTxt2Img.batchSize > 0
        ? clamp(Math.round(nextTxt2Img.batchSize), 1, 100)
        : defaultState.txt2img.batchSize,
    refine: {
      ...nextTxt2Img.refine,
      enabled: Boolean(nextTxt2Img.refine.enabled),
      upscaleMode:
        nextTxt2Img.refine.upscaleMode === 'model' ? 'model' : 'latent',
      upscaleMethod:
        nextTxt2Img.refine.upscaleMethod?.trim() ||
        defaultState.txt2img.refine.upscaleMethod,
      upscaleModel: nextTxt2Img.refine.upscaleModel?.trim() || '',
      scaleBy: Number.isFinite(nextTxt2Img.refine.scaleBy)
        ? clamp(nextTxt2Img.refine.scaleBy, 1.05, 4)
        : defaultState.txt2img.refine.scaleBy,
      steps:
        Number.isFinite(nextTxt2Img.refine.steps) && nextTxt2Img.refine.steps > 0
          ? clamp(Math.round(nextTxt2Img.refine.steps), 1, 80)
          : defaultState.txt2img.refine.steps,
      denoiseStrength: Number.isFinite(nextTxt2Img.refine.denoiseStrength)
        ? clamp(nextTxt2Img.refine.denoiseStrength, 0.05, 1)
        : defaultState.txt2img.refine.denoiseStrength
    },
    clipSkip: {
      ...nextTxt2Img.clipSkip,
      enabled: Boolean(nextTxt2Img.clipSkip.enabled),
      stopAtLayer:
        Number.isFinite(nextTxt2Img.clipSkip.stopAtLayer) &&
        nextTxt2Img.clipSkip.stopAtLayer <= -1
          ? clamp(Math.round(nextTxt2Img.clipSkip.stopAtLayer), -24, -1)
          : defaultState.txt2img.clipSkip.stopAtLayer
    },
    faceDetailer: {
      ...nextTxt2Img.faceDetailer,
      enabled: Boolean(nextTxt2Img.faceDetailer.enabled),
      guideSize: Number.isFinite(nextTxt2Img.faceDetailer.guideSize)
        ? clamp(Math.round(nextTxt2Img.faceDetailer.guideSize), 64, 4096)
        : defaultState.txt2img.faceDetailer.guideSize,
      guideSizeFor: Boolean(nextTxt2Img.faceDetailer.guideSizeFor),
      maxSize: Number.isFinite(nextTxt2Img.faceDetailer.maxSize)
        ? clamp(Math.round(nextTxt2Img.faceDetailer.maxSize), 64, 4096)
        : defaultState.txt2img.faceDetailer.maxSize,
      denoise: Number.isFinite(nextTxt2Img.faceDetailer.denoise)
        ? clamp(nextTxt2Img.faceDetailer.denoise, 0.0001, 1)
        : defaultState.txt2img.faceDetailer.denoise,
      feather: Number.isFinite(nextTxt2Img.faceDetailer.feather)
        ? clamp(Math.round(nextTxt2Img.faceDetailer.feather), 0, 100)
        : defaultState.txt2img.faceDetailer.feather,
      noiseMask: Boolean(nextTxt2Img.faceDetailer.noiseMask),
      forceInpaint: Boolean(nextTxt2Img.faceDetailer.forceInpaint),
      inpaintModel: Boolean(nextTxt2Img.faceDetailer.inpaintModel),
      noiseMaskFeather: Number.isFinite(nextTxt2Img.faceDetailer.noiseMaskFeather)
        ? clamp(Math.round(nextTxt2Img.faceDetailer.noiseMaskFeather), 0, 100)
        : defaultState.txt2img.faceDetailer.noiseMaskFeather,
      bboxThreshold: Number.isFinite(nextTxt2Img.faceDetailer.bboxThreshold)
        ? clamp(nextTxt2Img.faceDetailer.bboxThreshold, 0, 1)
        : defaultState.txt2img.faceDetailer.bboxThreshold,
      bboxDilation: Number.isFinite(nextTxt2Img.faceDetailer.bboxDilation)
        ? clamp(Math.round(nextTxt2Img.faceDetailer.bboxDilation), -512, 512)
        : defaultState.txt2img.faceDetailer.bboxDilation,
      bboxCropFactor: Number.isFinite(nextTxt2Img.faceDetailer.bboxCropFactor)
        ? clamp(nextTxt2Img.faceDetailer.bboxCropFactor, 1, 10)
        : defaultState.txt2img.faceDetailer.bboxCropFactor,
      bboxModel: nextTxt2Img.faceDetailer.bboxModel?.trim() ||
        defaultState.txt2img.faceDetailer.bboxModel,
      samModel: nextTxt2Img.faceDetailer.samModel?.trim() || '',
      samDetectionHint: [
        'center-1',
        'horizontal-2',
        'vertical-2',
        'rect-4',
        'diamond-4',
        'mask-area',
        'mask-points',
        'mask-point-bbox',
        'none'
      ].includes(nextTxt2Img.faceDetailer.samDetectionHint)
        ? nextTxt2Img.faceDetailer.samDetectionHint
        : defaultState.txt2img.faceDetailer.samDetectionHint,
      samDilation: Number.isFinite(nextTxt2Img.faceDetailer.samDilation)
        ? clamp(Math.round(nextTxt2Img.faceDetailer.samDilation), -512, 512)
        : defaultState.txt2img.faceDetailer.samDilation,
      samThreshold: Number.isFinite(nextTxt2Img.faceDetailer.samThreshold)
        ? clamp(nextTxt2Img.faceDetailer.samThreshold, 0, 1)
        : defaultState.txt2img.faceDetailer.samThreshold,
      samBboxExpansion: Number.isFinite(nextTxt2Img.faceDetailer.samBboxExpansion)
        ? clamp(Math.round(nextTxt2Img.faceDetailer.samBboxExpansion), 0, 1000)
        : defaultState.txt2img.faceDetailer.samBboxExpansion,
      samMaskHintThreshold: Number.isFinite(
        nextTxt2Img.faceDetailer.samMaskHintThreshold
      )
        ? clamp(nextTxt2Img.faceDetailer.samMaskHintThreshold, 0, 1)
        : defaultState.txt2img.faceDetailer.samMaskHintThreshold,
      samMaskHintUseNegative: ['False', 'Small', 'Outter'].includes(
        nextTxt2Img.faceDetailer.samMaskHintUseNegative
      )
        ? nextTxt2Img.faceDetailer.samMaskHintUseNegative
        : defaultState.txt2img.faceDetailer.samMaskHintUseNegative,
      dropSize: Number.isFinite(nextTxt2Img.faceDetailer.dropSize)
        ? clamp(Math.round(nextTxt2Img.faceDetailer.dropSize), 1, 4096)
        : defaultState.txt2img.faceDetailer.dropSize,
      cycle: Number.isFinite(nextTxt2Img.faceDetailer.cycle)
        ? clamp(Math.round(nextTxt2Img.faceDetailer.cycle), 1, 10)
        : defaultState.txt2img.faceDetailer.cycle,
      tiledEncode: Boolean(nextTxt2Img.faceDetailer.tiledEncode),
      tiledDecode: Boolean(nextTxt2Img.faceDetailer.tiledDecode)
    }
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
    variationSeedStrength: Number.isFinite(nextImg2Img.variationSeedStrength)
      ? clamp(nextImg2Img.variationSeedStrength, 0, 1)
      : defaultState.img2img.variationSeedStrength,
    batchSize:
      Number.isFinite(nextImg2Img.batchSize) && nextImg2Img.batchSize > 0
        ? clamp(Math.round(nextImg2Img.batchSize), 1, 100)
        : defaultState.img2img.batchSize,
    denoiseStrength: Number.isFinite(nextImg2Img.denoiseStrength)
      ? clamp(nextImg2Img.denoiseStrength, 0, 1)
      : defaultState.img2img.denoiseStrength
  };

  return {
    ...defaultState,
    activeBackend: 'comfyui',
    mode,
    generateForever: Boolean(candidate.generateForever),
    comfyUI: {
      ...defaultState.comfyUI,
      ...(candidate.comfyUI ?? {}),
      crossAttentionMethod:
        candidate.comfyUI?.crossAttentionMethod === 'sage'
          ? 'sage'
          : 'pytorch'
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
    a.variationSeed === b.variationSeed &&
    a.variationSeedStrength === b.variationSeedStrength &&
    a.steps === b.steps &&
    a.cfgScale === b.cfgScale &&
    isSameResolution(a.resolution, b.resolution) &&
    a.model === b.model &&
    a.vae === b.vae &&
    a.sampler === b.sampler &&
    a.scheduler === b.scheduler &&
    a.batchSize === b.batchSize &&
    a.refine.enabled === b.refine.enabled &&
    a.refine.upscaleMode === b.refine.upscaleMode &&
    a.refine.upscaleMethod === b.refine.upscaleMethod &&
    a.refine.upscaleModel === b.refine.upscaleModel &&
    a.refine.scaleBy === b.refine.scaleBy &&
    a.refine.steps === b.refine.steps &&
    a.refine.denoiseStrength === b.refine.denoiseStrength &&
    a.clipSkip.enabled === b.clipSkip.enabled &&
    a.clipSkip.stopAtLayer === b.clipSkip.stopAtLayer &&
    a.faceDetailer.enabled === b.faceDetailer.enabled &&
    a.faceDetailer.guideSize === b.faceDetailer.guideSize &&
    a.faceDetailer.guideSizeFor === b.faceDetailer.guideSizeFor &&
    a.faceDetailer.maxSize === b.faceDetailer.maxSize &&
    a.faceDetailer.denoise === b.faceDetailer.denoise &&
    a.faceDetailer.feather === b.faceDetailer.feather &&
    a.faceDetailer.noiseMask === b.faceDetailer.noiseMask &&
    a.faceDetailer.forceInpaint === b.faceDetailer.forceInpaint &&
    a.faceDetailer.inpaintModel === b.faceDetailer.inpaintModel &&
    a.faceDetailer.noiseMaskFeather === b.faceDetailer.noiseMaskFeather &&
    a.faceDetailer.bboxThreshold === b.faceDetailer.bboxThreshold &&
    a.faceDetailer.bboxDilation === b.faceDetailer.bboxDilation &&
    a.faceDetailer.bboxCropFactor === b.faceDetailer.bboxCropFactor &&
    a.faceDetailer.bboxModel === b.faceDetailer.bboxModel &&
    a.faceDetailer.samModel === b.faceDetailer.samModel &&
    a.faceDetailer.samDetectionHint === b.faceDetailer.samDetectionHint &&
    a.faceDetailer.samDilation === b.faceDetailer.samDilation &&
    a.faceDetailer.samThreshold === b.faceDetailer.samThreshold &&
    a.faceDetailer.samBboxExpansion === b.faceDetailer.samBboxExpansion &&
    a.faceDetailer.samMaskHintThreshold === b.faceDetailer.samMaskHintThreshold &&
    a.faceDetailer.samMaskHintUseNegative ===
      b.faceDetailer.samMaskHintUseNegative &&
    a.faceDetailer.dropSize === b.faceDetailer.dropSize &&
    a.faceDetailer.cycle === b.faceDetailer.cycle &&
    a.faceDetailer.tiledEncode === b.faceDetailer.tiledEncode &&
    a.faceDetailer.tiledDecode === b.faceDetailer.tiledDecode
  );
}

export function isSameImg2Img(a: Img2ImgParameters, b: Img2ImgParameters): boolean {
  return (
    a.prompt === b.prompt &&
    a.negativePrompt === b.negativePrompt &&
    a.seed === b.seed &&
    a.variationSeed === b.variationSeed &&
    a.variationSeedStrength === b.variationSeedStrength &&
    a.steps === b.steps &&
    a.cfgScale === b.cfgScale &&
    isSameResolution(a.resolution, b.resolution) &&
    a.model === b.model &&
    a.vae === b.vae &&
    a.sampler === b.sampler &&
    a.scheduler === b.scheduler &&
    a.batchSize === b.batchSize &&
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


