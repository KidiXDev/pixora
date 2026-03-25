import { PromptAutocompleteTextarea } from '@/components/image-generation/prompt-autocomplete-textarea';
import { PromptTokenCounter } from '@/components/image-generation/prompt-token-counter';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import {
  DEFAULT_PROMPT_FORMAT_OPTIONS,
  formatPromptText,
  type PromptFormatOptions
} from '@/lib/prompt-format';
import { cn, filterNumeric, parseNumeric } from '@/lib/utils';
import { img2imgSchema, txt2imgSchema } from '@/schema/generation-schema';
import { useConfigStore } from '@/stores/config-store';
import {
  GenerationModelCatalog,
  ImageGenerationMode,
  Img2ImgParameters,
  Txt2ImgParameters
} from '@/types/image-generation';
import { useForm, type FormValidateOrFn } from '@tanstack/react-form';
import {
  BrushCleaningIcon,
  CircleHelpIcon,
  RefreshCcwIcon
} from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

type FormValues = {
  txt2img: Txt2ImgParameters;
  img2img: Img2ImgParameters;
};

const RESOLUTION_PRESETS = {
  SDXL: [
    { label: 'SDXL Square 1024x1024', width: 1024, height: 1024 },
    { label: 'SDXL Portrait 832x1216', width: 832, height: 1216 },
    { label: 'SDXL Landscape 1216x832', width: 1216, height: 832 },
    { label: 'SDXL Portrait 896x1152', width: 896, height: 1152 },
    { label: 'SDXL Landscape 1152x896', width: 1152, height: 896 },
    { label: 'SDXL Portrait 768x1344', width: 768, height: 1344 },
    { label: 'SDXL Landscape 1344x768', width: 1344, height: 768 },
    { label: 'SDXL Portrait 1024x1344', width: 1024, height: 1344 },
    { label: 'SDXL Landscape 1344x1024', width: 1344, height: 1024 },
    { label: 'SDXL Cinema 1536x640', width: 1536, height: 640 },
    { label: 'SDXL Cinema 640x1536', width: 640, height: 1536 }
  ],
  SD: [
    { label: 'SD Square 512x512', width: 512, height: 512 },
    { label: 'SD Square 768x768', width: 768, height: 768 },
    { label: 'SD Portrait 512x768', width: 512, height: 768 },
    { label: 'SD Landscape 768x512', width: 768, height: 512 }
  ]
} as const;

const REFINE_LATENT_UPSCALE_METHOD_OPTIONS = [
  'nearest-exact',
  'bilinear',
  'area',
  'bicubic',
  'bislerp'
] as const;
const STORE_SYNC_DEBOUNCE_MS = 80;

interface GenerationParametersPanelProps {
  mode: ImageGenerationMode;
  modelCatalog: GenerationModelCatalog;
  modelCatalogLoading: boolean;
  txt2img: Txt2ImgParameters;
  img2img: Img2ImgParameters;
  isGenerating: boolean;
  onRefreshModelCatalog: () => void;
  onTxt2ImgChange: (patch: Partial<Txt2ImgParameters>) => void;
  onImg2ImgChange: (patch: Partial<Img2ImgParameters>) => void;
}

interface RenderNumericParameterFieldsOptions {
  prefix: 'txt2img' | 'img2img';
  showDenoise?: boolean;
}

function isSameResolution(
  a: { width: number; height: number },
  b: { width: number; height: number }
): boolean {
  return a.width === b.width && a.height === b.height;
}

function isSameTxt2Img(a: Txt2ImgParameters, b: Txt2ImgParameters): boolean {
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

function isSameImg2Img(a: Img2ImgParameters, b: Img2ImgParameters): boolean {
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

function GenerationParametersPanelBase({
  mode,
  modelCatalog,
  modelCatalogLoading,
  txt2img,
  img2img,
  isGenerating,
  onRefreshModelCatalog,
  onTxt2ImgChange,
  onImg2ImgChange
}: GenerationParametersPanelProps) {
  const renderParamHelp = (description: string) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label="Parameter information"
        >
          <CircleHelpIcon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        className="max-w-xs text-[11px] leading-relaxed"
      >
        {description}
      </TooltipContent>
    </Tooltip>
  );

  const renderFieldLabelWithHelp = (
    htmlFor: string,
    label: string,
    description: string,
    className = 'text-xs text-muted-foreground font-bold uppercase tracking-widest'
  ) => (
    <div className="flex items-center gap-1.5 px-0.5">
      <FieldLabel htmlFor={htmlFor} className={className}>
        {label}
      </FieldLabel>
      {renderParamHelp(description)}
    </div>
  );

  const promptFormatConfig = useConfigStore(
    (state) => state.config?.promptFormat
  );
  const promptFormatOptions = React.useMemo<PromptFormatOptions>(
    () => ({
      collapseMultiline:
        promptFormatConfig?.collapseMultiline ??
        DEFAULT_PROMPT_FORMAT_OPTIONS.collapseMultiline,
      collapseWhitespace:
        promptFormatConfig?.collapseWhitespace ??
        DEFAULT_PROMPT_FORMAT_OPTIONS.collapseWhitespace,
      commaSpacingMode:
        promptFormatConfig?.commaSpacingMode === 'none' ? 'none' : 'single'
    }),
    [promptFormatConfig]
  );

  const samplerOptions = React.useMemo(
    () => modelCatalog.samplers,
    [modelCatalog.samplers]
  );
  const schedulerOptions = React.useMemo(
    () => modelCatalog.schedulers,
    [modelCatalog.schedulers]
  );
  const samModelOptions = React.useMemo(
    () => modelCatalog.samModels,
    [modelCatalog.samModels]
  );
  const bboxModelOptions = React.useMemo(
    () => modelCatalog.bboxModels,
    [modelCatalog.bboxModels]
  );
  const modelOptions = React.useMemo(
    () => modelCatalog.checkpoints,
    [modelCatalog.checkpoints]
  );
  const vaeOptions = React.useMemo(
    () => modelCatalog.vaes,
    [modelCatalog.vaes]
  );

  const defaultValues = React.useMemo(
    () => ({
      txt2img,
      img2img
    }),
    [txt2img, img2img]
  );

  const form = useForm({
    defaultValues,
    validators: {
      onChange: z.object({
        txt2img: txt2imgSchema,
        img2img: img2imgSchema
      }) as FormValidateOrFn<FormValues>
    }
  });

  const [isRefineExpanded, setIsRefineExpanded] = React.useState(false);
  const [isClipSkipExpanded, setIsClipSkipExpanded] = React.useState(false);
  const [isFaceDetailerExpanded, setIsFaceDetailerExpanded] =
    React.useState(false);
  const storeSyncTimerRef = React.useRef<number | null>(null);
  const pendingValuesRef = React.useRef<FormValues>({
    txt2img,
    img2img
  });
  const lastSyncedValuesRef = React.useRef<FormValues>({
    txt2img,
    img2img
  });

  const flushFormChangesToStore = React.useCallback(() => {
    if (storeSyncTimerRef.current !== null) {
      window.clearTimeout(storeSyncTimerRef.current);
      storeSyncTimerRef.current = null;
    }

    const pendingValues = pendingValuesRef.current;
    const lastSyncedValues = lastSyncedValuesRef.current;
    let nextSyncedValues = lastSyncedValues;

    if (!isSameTxt2Img(lastSyncedValues.txt2img, pendingValues.txt2img)) {
      onTxt2ImgChange(pendingValues.txt2img);
      nextSyncedValues = {
        ...nextSyncedValues,
        txt2img: pendingValues.txt2img
      };
    }

    if (!isSameImg2Img(lastSyncedValues.img2img, pendingValues.img2img)) {
      onImg2ImgChange(pendingValues.img2img);
      nextSyncedValues = {
        ...nextSyncedValues,
        img2img: pendingValues.img2img
      };
    }

    if (nextSyncedValues !== lastSyncedValues) {
      lastSyncedValuesRef.current = nextSyncedValues;
    }
  }, [onTxt2ImgChange, onImg2ImgChange]);

  const handleFormatPrompts = () => {
    if (mode === 'txt2img') {
      const prompt = form.getFieldValue('txt2img.prompt');
      const negativePrompt = form.getFieldValue('txt2img.negativePrompt');

      if (prompt) {
        form.setFieldValue(
          'txt2img.prompt',
          formatPromptText(prompt, promptFormatOptions)
        );
      }
      if (negativePrompt) {
        form.setFieldValue(
          'txt2img.negativePrompt',
          formatPromptText(negativePrompt, promptFormatOptions)
        );
      }
    } else {
      const prompt = form.getFieldValue('img2img.prompt');
      const negativePrompt = form.getFieldValue('img2img.negativePrompt');

      if (prompt) {
        form.setFieldValue(
          'img2img.prompt',
          formatPromptText(prompt, promptFormatOptions)
        );
      }
      if (negativePrompt) {
        form.setFieldValue(
          'img2img.negativePrompt',
          formatPromptText(negativePrompt, promptFormatOptions)
        );
      }
    }
  };

  const renderModelFields = (prefix: 'txt2img' | 'img2img') => (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5">
      <form.Field
        name={prefix === 'txt2img' ? 'txt2img.model' : 'img2img.model'}
        children={(field) => {
          const isInvalid =
            field.state.meta.isTouched && !!field.state.meta.errors.length;
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel
                htmlFor={field.name}
                className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5"
              >
                Checkpoint
              </FieldLabel>
              <Select
                name={field.name}
                value={field.state.value}
                onValueChange={(value) => field.handleChange(value)}
              >
                <SelectTrigger
                  id={field.name}
                  aria-invalid={isInvalid}
                  className="h-10 w-full text-xs px-3 bg-primary/5 border-primary/20 hover:bg-primary/10 transition-colors font-semibold"
                >
                  <SelectValue
                    placeholder={
                      modelCatalogLoading
                        ? 'Loading checkpoints...'
                        : 'Select model'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup className="overflow-y-auto max-h-[40vh]">
                    {modelOptions.map((item) => (
                      <SelectItem key={item} value={item} className="text-xs">
                        {item}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {isInvalid && <FieldError errors={field.state.meta.errors} />}
            </Field>
          );
        }}
      />

      <form.Field
        name={prefix === 'txt2img' ? 'txt2img.vae' : 'img2img.vae'}
        children={(field) => {
          const isInvalid =
            field.state.meta.isTouched && !!field.state.meta.errors.length;
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel
                htmlFor={field.name}
                className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5"
              >
                VAE
              </FieldLabel>
              <div className="flex items-center gap-1.5">
                <div className="flex-1 min-w-0">
                  <Select
                    name={field.name}
                    value={field.state.value}
                    onValueChange={(value) => field.handleChange(value)}
                  >
                    <SelectTrigger
                      id={field.name}
                      aria-invalid={isInvalid}
                      className="h-10 w-full text-xs px-3 bg-primary/5 border-primary/20 hover:bg-primary/10 transition-colors font-semibold"
                    >
                      <SelectValue
                        placeholder={
                          modelCatalogLoading ? 'Loading VAEs...' : 'Select VAE'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup className="overflow-y-auto max-h-[40vh]">
                        {vaeOptions.map((item) => (
                          <SelectItem
                            key={item}
                            value={item}
                            className="text-xs"
                          >
                            {item}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-10 shrink-0 bg-primary/5 border-primary/20 hover:bg-primary/10 transition-colors shadow-sm"
                  onClick={onRefreshModelCatalog}
                  disabled={modelCatalogLoading || isGenerating}
                  title="Refresh"
                >
                  <RefreshCcwIcon
                    className={`size-4 ${
                      modelCatalogLoading ? 'animate-spin' : ''
                    }`}
                  />
                </Button>
              </div>
              {isInvalid && <FieldError errors={field.state.meta.errors} />}
            </Field>
          );
        }}
      />
    </div>
  );

  const renderRefineFields = () => (
    <div className="space-y-3 pt-2 border-t border-border/10">
      <form.Field
        name="txt2img.refine"
        children={(field) => {
          const value = field.state.value;
          const isModelMode = value.upscaleMode === 'model';
          const isExpanded = isRefineExpanded;

          return (
            <Accordion
              type="single"
              value={isExpanded ? 'refine' : ''}
              onValueChange={(nextValue) => {
                setIsRefineExpanded(nextValue === 'refine');
              }}
              collapsible
              className="w-full rounded-lg border border-border/50 bg-muted/10 px-3"
            >
              <AccordionItem value="refine" className="border-none">
                <div className="relative w-full py-3 pr-1">
                  <AccordionTrigger className="w-full items-center py-1 pr-2 hover:no-underline">
                    <div className="space-y-0.5 text-left">
                      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/90">
                        Refine (Hi-Res Fix)
                      </p>
                      <p className="text-[11px] text-muted-foreground/70">
                        Upscale and run a second denoise pass for cleaner
                        details.
                      </p>
                    </div>
                  </AccordionTrigger>
                  <div
                    className="absolute right-10 top-1/2 flex h-8 -translate-y-1/2 items-center border-r border-border/10 pr-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Switch
                      checked={value.enabled}
                      aria-label="Enable refine"
                      onCheckedChange={(checked) => {
                        field.handleChange({
                          ...value,
                          enabled: checked
                        });
                        if (checked) {
                          setIsRefineExpanded(true);
                        }
                      }}
                    />
                  </div>
                </div>
                <AccordionContent className="space-y-4 pb-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Field>
                      {renderFieldLabelWithHelp(
                        'refine-upscale-mode',
                        'Upscale Type',
                        'Choose between Latent Upscale or using a dedicated AI Upscale Model.'
                      )}
                      <Select
                        value={value.upscaleMode}
                        onValueChange={(upscaleMode) => {
                          const mode = upscaleMode as 'latent' | 'model';
                          let nextMethod = value.upscaleMethod;
                          if (mode === 'model') {
                            nextMethod = 'lanczos';
                          } else if (nextMethod === 'lanczos') {
                            nextMethod = 'nearest-exact';
                          }
                          field.handleChange({
                            ...value,
                            upscaleMode: mode,
                            upscaleMethod: nextMethod
                          });
                        }}
                      >
                        <SelectTrigger
                          id="refine-upscale-mode"
                          className="h-9 w-full text-xs px-3 bg-muted/20 border-border/40 hover:bg-muted/30 transition-colors"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="latent" className="text-xs">
                            Latent Upscale
                          </SelectItem>
                          <SelectItem value="model" className="text-xs">
                            Upscale Model
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field>
                      {renderFieldLabelWithHelp(
                        'refine-upscale-method',
                        'Upscale Method',
                        'Interpolation method used for upscaling.'
                      )}
                      <Select
                        key={value.upscaleMode}
                        value={value.upscaleMethod}
                        disabled={isModelMode}
                        onValueChange={(upscaleMethod) => {
                          field.handleChange({
                            ...value,
                            upscaleMethod
                          });
                        }}
                      >
                        <SelectTrigger
                          id="refine-upscale-method"
                          className={cn(
                            'h-9 w-full text-xs px-3 bg-muted/20 border-border/40 hover:bg-muted/30 transition-colors',
                            isModelMode && 'opacity-50 cursor-not-allowed'
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {isModelMode ? (
                            <SelectItem value="lanczos" className="text-xs">
                              lanczos
                            </SelectItem>
                          ) : (
                            REFINE_LATENT_UPSCALE_METHOD_OPTIONS.map(
                              (method) => (
                                <SelectItem
                                  key={method}
                                  value={method}
                                  className="text-xs"
                                >
                                  {method}
                                </SelectItem>
                              )
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field className="col-span-2">
                      {renderFieldLabelWithHelp(
                        'refine-upscale-model',
                        'Upscale Model',
                        'The specific AI model used for upscaling the image before the refinement pass.',
                        cn(
                          'text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5 transition-opacity',
                          !isModelMode && 'opacity-40'
                        )
                      )}
                      <Select
                        value={value.upscaleModel}
                        disabled={!isModelMode}
                        onValueChange={(upscaleModel) => {
                          field.handleChange({
                            ...value,
                            upscaleModel
                          });
                        }}
                      >
                        <SelectTrigger
                          id="refine-upscale-model"
                          className={cn(
                            'h-9 w-full text-xs px-3 bg-muted/20 border-border/40 hover:bg-muted/30 transition-all',
                            !isModelMode &&
                              'opacity-50 cursor-not-allowed grayscale-[0.5]'
                          )}
                        >
                          <SelectValue
                            placeholder={
                              modelCatalogLoading
                                ? 'Loading upscale models...'
                                : 'Select upscale model'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup className="overflow-y-auto max-h-[40vh]">
                            {modelCatalog.upscaleModels.map((model) => (
                              <SelectItem
                                key={model}
                                value={model}
                                className="text-xs"
                              >
                                {model}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border/10">
                    <Field className="space-y-2">
                      <div className="flex items-center justify-between gap-2 px-0.5">
                        {renderFieldLabelWithHelp(
                          'refine-scale-by',
                          'Scale By',
                          'Multiplier for the final resolution. 2.0x will double the dimensions of the initial image.'
                        )}
                        <Input
                          id="refine-scale-by"
                          value={value.scaleBy}
                          onChange={(event) =>
                            field.handleChange({
                              ...value,
                              scaleBy: parseNumeric(
                                filterNumeric(event.target.value, true)
                              )
                            })
                          }
                          className="h-8 text-xs px-2 w-16 text-center font-mono bg-muted/20 border-border/50"
                        />
                      </div>
                      <Slider
                        value={[value.scaleBy]}
                        min={1.05}
                        max={4}
                        step={0.05}
                        onValueChange={([scaleBy]) =>
                          field.handleChange({
                            ...value,
                            scaleBy
                          })
                        }
                      />
                    </Field>

                    <Field className="space-y-2">
                      <div className="flex items-center justify-between gap-2 px-0.5">
                        {renderFieldLabelWithHelp(
                          'refine-steps',
                          'Refine Steps',
                          'Number of denoising iterations for the second pass. Higher values add more detail but take longer.'
                        )}
                        <Input
                          id="refine-steps"
                          value={value.steps}
                          onChange={(event) =>
                            field.handleChange({
                              ...value,
                              steps: parseNumeric(
                                filterNumeric(event.target.value, false)
                              )
                            })
                          }
                          className="h-8 text-xs px-2 w-16 text-center font-mono bg-muted/20 border-border/50"
                        />
                      </div>
                      <Slider
                        value={[value.steps]}
                        min={1}
                        max={80}
                        step={1}
                        onValueChange={([steps]) =>
                          field.handleChange({
                            ...value,
                            steps
                          })
                        }
                      />
                    </Field>

                    <Field className="space-y-2 col-span-2">
                      <div className="flex items-center justify-between gap-2 px-0.5">
                        {renderFieldLabelWithHelp(
                          'refine-denoise',
                          'Refine Denoise',
                          'Controls how strongly the refine step alters the image. Higher values make bigger changes, while lower values preserve the original result.'
                        )}
                        <Input
                          id="refine-denoise"
                          value={value.denoiseStrength}
                          onChange={(event) =>
                            field.handleChange({
                              ...value,
                              denoiseStrength: parseNumeric(
                                filterNumeric(event.target.value, true)
                              )
                            })
                          }
                          className="h-8 text-xs px-2 w-16 text-center font-mono bg-muted/20 border-border/50"
                        />
                      </div>
                      <Slider
                        value={[value.denoiseStrength]}
                        min={0.05}
                        max={1}
                        step={0.01}
                        onValueChange={([denoiseStrength]) =>
                          field.handleChange({
                            ...value,
                            denoiseStrength
                          })
                        }
                      />
                    </Field>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          );
        }}
      />
    </div>
  );

  const renderClipSkipFields = () => (
    <div className="space-y-3">
      <form.Field
        name="txt2img.clipSkip"
        children={(field) => {
          const value = field.state.value;
          const isExpanded = isClipSkipExpanded;

          return (
            <Accordion
              type="single"
              value={isExpanded ? 'clip-skip' : ''}
              onValueChange={(nextValue) => {
                setIsClipSkipExpanded(nextValue === 'clip-skip');
              }}
              collapsible
              className="w-full rounded-lg border border-border/50 bg-muted/10 px-3"
            >
              <AccordionItem value="clip-skip" className="border-none">
                <div className="relative w-full py-3 pr-1">
                  <AccordionTrigger className="w-full items-center py-1 pr-2 hover:no-underline">
                    <div className="space-y-0.5 text-left">
                      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/90">
                        Clip Skip
                      </p>
                      <p className="text-[11px] text-muted-foreground/70">
                        Shift CLIP encoding depth for style/control tweaks.
                      </p>
                    </div>
                  </AccordionTrigger>
                  <div
                    className="absolute right-10 top-1/2 flex h-8 -translate-y-1/2 items-center border-r border-border/10 pr-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Switch
                      checked={value.enabled}
                      aria-label="Enable clip skip"
                      onCheckedChange={(checked) => {
                        field.handleChange({
                          ...value,
                          enabled: checked,
                          stopAtLayer: checked
                            ? value.stopAtLayer || -1
                            : value.stopAtLayer
                        });
                        if (checked) {
                          setIsClipSkipExpanded(true);
                        }
                      }}
                    />
                  </div>
                </div>
                <AccordionContent className="space-y-4 pb-4">
                  <Field className="space-y-2">
                    <div className="flex items-center justify-between gap-2 px-0.5">
                      <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest">
                        Stop At Layer
                      </FieldLabel>
                      <Input
                        value={value.stopAtLayer}
                        onChange={(event) => {
                          const raw = event.target.value.replace(
                            /[^0-9-]/g,
                            ''
                          );
                          const normalized = raw.startsWith('-')
                            ? `-${raw.slice(1).replace(/-/g, '')}`
                            : raw.replace(/-/g, '');
                          field.handleChange({
                            ...value,
                            stopAtLayer:
                              normalized === '' || normalized === '-'
                                ? value.stopAtLayer
                                : parseNumeric(normalized)
                          });
                        }}
                        className="h-8 text-xs px-2 w-16 text-center font-mono bg-muted/20 border-border/50"
                      />
                    </div>
                    <Slider
                      value={[value.stopAtLayer]}
                      min={-24}
                      max={-1}
                      step={1}
                      onValueChange={([stopAtLayer]) =>
                        field.handleChange({
                          ...value,
                          stopAtLayer
                        })
                      }
                    />
                  </Field>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          );
        }}
      />
    </div>
  );

  const renderFaceDetailerFields = () => (
    <div className="space-y-3">
      <form.Field
        name="txt2img.faceDetailer"
        children={(field) => {
          const value = field.state.value;
          const isExpanded = isFaceDetailerExpanded;

          return (
            <Accordion
              type="single"
              value={isExpanded ? 'face-detailer' : ''}
              onValueChange={(nextValue) => {
                setIsFaceDetailerExpanded(nextValue === 'face-detailer');
              }}
              collapsible
              className="w-full rounded-lg border border-border/50 bg-muted/10 px-3"
            >
              <AccordionItem value="face-detailer" className="border-none">
                <div className="relative w-full py-3 pr-1">
                  <AccordionTrigger className="w-full items-center py-1 pr-2 hover:no-underline">
                    <div className="space-y-0.5 text-left">
                      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/90">
                        Face Detailer
                      </p>
                      <p className="text-[11px] text-muted-foreground/70">
                        Automatically detect faces and run detail enhancement.
                      </p>
                    </div>
                  </AccordionTrigger>
                  <div
                    className="absolute right-10 top-1/2 flex h-8 -translate-y-1/2 items-center border-r border-border/10 pr-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Switch
                      checked={value.enabled}
                      aria-label="Enable face detailer"
                      onCheckedChange={(checked) => {
                        field.handleChange({
                          ...value,
                          enabled: checked
                        });
                        if (checked) {
                          setIsFaceDetailerExpanded(true);
                        }
                      }}
                    />
                  </div>
                </div>
                <AccordionContent className="space-y-4 pb-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Field>
                      <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5">
                        Guide Size
                      </FieldLabel>
                      <Input
                        value={value.guideSize}
                        onChange={(event) =>
                          field.handleChange({
                            ...value,
                            guideSize: parseNumeric(
                              filterNumeric(event.target.value, false)
                            )
                          })
                        }
                        className="h-9 text-xs px-3 bg-muted/20 border-border/40"
                      />
                    </Field>
                    <Field>
                      <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5">
                        Max Size
                      </FieldLabel>
                      <Input
                        value={value.maxSize}
                        onChange={(event) =>
                          field.handleChange({
                            ...value,
                            maxSize: parseNumeric(
                              filterNumeric(event.target.value, false)
                            )
                          })
                        }
                        className="h-9 text-xs px-3 bg-muted/20 border-border/40"
                      />
                    </Field>
                    <Field>
                      <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5">
                        BBox Threshold
                      </FieldLabel>
                      <Input
                        value={value.bboxThreshold}
                        onChange={(event) =>
                          field.handleChange({
                            ...value,
                            bboxThreshold: parseNumeric(
                              filterNumeric(event.target.value, true)
                            )
                          })
                        }
                        className="h-9 text-xs px-3 bg-muted/20 border-border/40"
                      />
                    </Field>
                    <Field>
                      <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5">
                        BBox Dilation
                      </FieldLabel>
                      <Input
                        value={value.bboxDilation}
                        onChange={(event) =>
                          field.handleChange({
                            ...value,
                            bboxDilation: parseNumeric(
                              filterNumeric(event.target.value, false)
                            )
                          })
                        }
                        className="h-9 text-xs px-3 bg-muted/20 border-border/40"
                      />
                    </Field>
                    <Field>
                      <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5">
                        BBox Crop Factor
                      </FieldLabel>
                      <Input
                        value={value.bboxCropFactor}
                        onChange={(event) =>
                          field.handleChange({
                            ...value,
                            bboxCropFactor: parseNumeric(
                              filterNumeric(event.target.value, true)
                            )
                          })
                        }
                        className="h-9 text-xs px-3 bg-muted/20 border-border/40"
                      />
                    </Field>
                    <Field>
                      <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5">
                        Drop Size
                      </FieldLabel>
                      <Input
                        value={value.dropSize}
                        onChange={(event) =>
                          field.handleChange({
                            ...value,
                            dropSize: parseNumeric(
                              filterNumeric(event.target.value, false)
                            )
                          })
                        }
                        className="h-9 text-xs px-3 bg-muted/20 border-border/40"
                      />
                    </Field>

                    <Field>
                      <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5">
                        Guide Size For
                      </FieldLabel>
                      <Select
                        value={value.guideSizeFor ? 'bbox' : 'crop_region'}
                        onValueChange={(next) =>
                          field.handleChange({
                            ...value,
                            guideSizeFor: next === 'bbox'
                          })
                        }
                      >
                        <SelectTrigger className="h-9 text-xs bg-muted/20 border-border/40">
                          <SelectValue placeholder="Select base" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bbox">bbox</SelectItem>
                          <SelectItem value="crop_region">crop_region</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field>
                      <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5">
                        SAM Model
                      </FieldLabel>
                      <Select
                        value={value.samModel || samModelOptions[0] || ''}
                        onValueChange={(next) =>
                          field.handleChange({
                            ...value,
                            samModel: next
                          })
                        }
                      >
                        <SelectTrigger className="h-9 text-xs bg-muted/20 border-border/40">
                          <SelectValue placeholder="Select SAM model" />
                        </SelectTrigger>
                        <SelectContent>
                          {samModelOptions.map((item) => (
                            <SelectItem key={item} value={item}>
                              {item}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field>
                      <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5">
                        SAM Hint
                      </FieldLabel>
                      <Select
                        value={value.samDetectionHint}
                        onValueChange={(samDetectionHint) =>
                          field.handleChange({
                            ...value,
                            samDetectionHint
                          })
                        }
                      >
                        <SelectTrigger className="h-9 text-xs bg-muted/20 border-border/40">
                          <SelectValue placeholder="Select hint" />
                        </SelectTrigger>
                        <SelectContent>
                          {[
                            'center-1',
                            'horizontal-2',
                            'vertical-2',
                            'rect-4',
                            'diamond-4',
                            'mask-area',
                            'mask-points',
                            'mask-point-bbox',
                            'none'
                          ].map((hint) => (
                            <SelectItem key={hint} value={hint}>
                              {hint}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field>
                      <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5">
                        SAM Threshold
                      </FieldLabel>
                      <Input
                        value={value.samThreshold}
                        onChange={(event) =>
                          field.handleChange({
                            ...value,
                            samThreshold: parseNumeric(
                              filterNumeric(event.target.value, true)
                            )
                          })
                        }
                        className="h-9 text-xs px-3 bg-muted/20 border-border/40"
                      />
                    </Field>

                    <Field>
                      <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5">
                        SAM Dilation
                      </FieldLabel>
                      <Input
                        value={value.samDilation}
                        onChange={(event) =>
                          field.handleChange({
                            ...value,
                            samDilation: parseNumeric(
                              filterNumeric(event.target.value, false)
                            )
                          })
                        }
                        className="h-9 text-xs px-3 bg-muted/20 border-border/40"
                      />
                    </Field>

                    <Field>
                      <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5">
                        SAM BBox Expansion
                      </FieldLabel>
                      <Input
                        value={value.samBboxExpansion}
                        onChange={(event) =>
                          field.handleChange({
                            ...value,
                            samBboxExpansion: parseNumeric(
                              filterNumeric(event.target.value, false)
                            )
                          })
                        }
                        className="h-9 text-xs px-3 bg-muted/20 border-border/40"
                      />
                    </Field>

                    <Field>
                      <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5">
                        SAM Mask Hint
                      </FieldLabel>
                      <Input
                        value={value.samMaskHintThreshold}
                        onChange={(event) =>
                          field.handleChange({
                            ...value,
                            samMaskHintThreshold: parseNumeric(
                              filterNumeric(event.target.value, true)
                            )
                          })
                        }
                        className="h-9 text-xs px-3 bg-muted/20 border-border/40"
                      />
                    </Field>

                    <Field>
                      <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5">
                        SAM Negative
                      </FieldLabel>
                      <Select
                        value={value.samMaskHintUseNegative}
                        onValueChange={(samMaskHintUseNegative) =>
                          field.handleChange({
                            ...value,
                            samMaskHintUseNegative
                          })
                        }
                      >
                        <SelectTrigger className="h-9 text-xs bg-muted/20 border-border/40">
                          <SelectValue placeholder="Select mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="False">False</SelectItem>
                          <SelectItem value="Small">Small</SelectItem>
                          <SelectItem value="Outter">Outter</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field>
                      <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5">
                        BBox Model
                      </FieldLabel>
                      <Select
                        value={value.bboxModel || bboxModelOptions[0] || ''}
                        onValueChange={(bboxModel) =>
                          field.handleChange({
                            ...value,
                            bboxModel
                          })
                        }
                      >
                        <SelectTrigger className="h-9 text-xs bg-muted/20 border-border/40">
                          <SelectValue placeholder="Select bbox model" />
                        </SelectTrigger>
                        <SelectContent>
                          {bboxModelOptions.map((item) => (
                            <SelectItem key={item} value={item}>
                              {item}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border/10">
                    <Field className="space-y-2">
                      <div className="flex items-center justify-between gap-2 px-0.5">
                        <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest">
                          Denoise
                        </FieldLabel>
                        <Input
                          value={value.denoise}
                          onChange={(event) =>
                            field.handleChange({
                              ...value,
                              denoise: parseNumeric(
                                filterNumeric(event.target.value, true)
                              )
                            })
                          }
                          className="h-8 text-xs px-2 w-16 text-center font-mono bg-muted/20 border-border/50"
                        />
                      </div>
                      <Slider
                        value={[value.denoise]}
                        min={0.0001}
                        max={1}
                        step={0.01}
                        onValueChange={([denoise]) =>
                          field.handleChange({
                            ...value,
                            denoise
                          })
                        }
                      />
                    </Field>

                    <Field className="space-y-2">
                      <div className="flex items-center justify-between gap-2 px-0.5">
                        <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest">
                          Feather
                        </FieldLabel>
                        <Input
                          value={value.feather}
                          onChange={(event) =>
                            field.handleChange({
                              ...value,
                              feather: parseNumeric(
                                filterNumeric(event.target.value, false)
                              )
                            })
                          }
                          className="h-8 text-xs px-2 w-16 text-center font-mono bg-muted/20 border-border/50"
                        />
                      </div>
                      <Slider
                        value={[value.feather]}
                        min={0}
                        max={100}
                        step={1}
                        onValueChange={([feather]) =>
                          field.handleChange({
                            ...value,
                            feather
                          })
                        }
                      />
                    </Field>

                    <Field className="space-y-2">
                      <div className="flex items-center justify-between gap-2 px-0.5">
                        <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest">
                          Cycle
                        </FieldLabel>
                        <Input
                          value={value.cycle}
                          onChange={(event) =>
                            field.handleChange({
                              ...value,
                              cycle: parseNumeric(
                                filterNumeric(event.target.value, false)
                              )
                            })
                          }
                          className="h-8 text-xs px-2 w-16 text-center font-mono bg-muted/20 border-border/50"
                        />
                      </div>
                      <Slider
                        value={[value.cycle]}
                        min={1}
                        max={10}
                        step={1}
                        onValueChange={([cycle]) =>
                          field.handleChange({
                            ...value,
                            cycle
                          })
                        }
                      />
                    </Field>

                    <Field className="space-y-2">
                      <div className="flex items-center justify-between gap-2 px-0.5">
                        <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest">
                          Noise Mask Feather
                        </FieldLabel>
                        <Input
                          value={value.noiseMaskFeather}
                          onChange={(event) =>
                            field.handleChange({
                              ...value,
                              noiseMaskFeather: parseNumeric(
                                filterNumeric(event.target.value, false)
                              )
                            })
                          }
                          className="h-8 text-xs px-2 w-16 text-center font-mono bg-muted/20 border-border/50"
                        />
                      </div>
                      <Slider
                        value={[value.noiseMaskFeather]}
                        min={0}
                        max={100}
                        step={1}
                        onValueChange={([noiseMaskFeather]) =>
                          field.handleChange({
                            ...value,
                            noiseMaskFeather
                          })
                        }
                      />
                    </Field>

                    <div className="col-span-2 grid grid-cols-2 gap-3">
                      <div className="flex items-center justify-between w-full rounded-md border border-border/40 bg-muted/20 px-3 py-2">
                        <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest">
                          Force Inpaint
                        </FieldLabel>
                        <Switch
                          checked={value.forceInpaint}
                          onCheckedChange={(forceInpaint) =>
                            field.handleChange({
                              ...value,
                              forceInpaint
                            })
                          }
                          aria-label="Force inpaint"
                        />
                      </div>

                      <div className="flex items-center justify-between w-full rounded-md border border-border/40 bg-muted/20 px-3 py-2">
                        <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest">
                          Noise Mask
                        </FieldLabel>
                        <Switch
                          checked={value.noiseMask}
                          onCheckedChange={(noiseMask) =>
                            field.handleChange({
                              ...value,
                              noiseMask
                            })
                          }
                          aria-label="Noise mask"
                        />
                      </div>

                      <div className="flex items-center justify-between w-full rounded-md border border-border/40 bg-muted/20 px-3 py-2">
                        <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest">
                          Inpaint Model
                        </FieldLabel>
                        <Switch
                          checked={value.inpaintModel}
                          onCheckedChange={(inpaintModel) =>
                            field.handleChange({
                              ...value,
                              inpaintModel
                            })
                          }
                          aria-label="Inpaint model"
                        />
                      </div>

                      <div className="flex items-center justify-between w-full rounded-md border border-border/40 bg-muted/20 px-3 py-2">
                        <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest">
                          Tiled Encode
                        </FieldLabel>
                        <Switch
                          checked={value.tiledEncode}
                          onCheckedChange={(tiledEncode) =>
                            field.handleChange({
                              ...value,
                              tiledEncode
                            })
                          }
                          aria-label="Tiled encode"
                        />
                      </div>

                      <div className="flex items-center justify-between w-full rounded-md border border-border/40 bg-muted/20 px-3 py-2">
                        <FieldLabel className="text-xs text-muted-foreground font-bold uppercase tracking-widest">
                          Tiled Decode
                        </FieldLabel>
                        <Switch
                          checked={value.tiledDecode}
                          onCheckedChange={(tiledDecode) =>
                            field.handleChange({
                              ...value,
                              tiledDecode
                            })
                          }
                          aria-label="Tiled decode"
                        />
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          );
        }}
      />
    </div>
  );

  const renderNumericParameterFields = ({
    prefix,
    showDenoise
  }: RenderNumericParameterFieldsOptions) => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        {/* Steps */}
        <form.Field
          name={prefix === 'txt2img' ? 'txt2img.steps' : 'img2img.steps'}
          children={(field) => {
            const isInvalid =
              field.state.meta.isTouched && !!field.state.meta.errors.length;
            return (
              <Field className="space-y-2.5" data-invalid={isInvalid}>
                <div className="flex items-center justify-between gap-2 px-0.5">
                  {renderFieldLabelWithHelp(
                    field.name,
                    'Steps',
                    'Number of denoising iterations. Higher values can increase detail but also take longer.'
                  )}
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) =>
                      field.handleChange(
                        parseNumeric(filterNumeric(e.target.value, false))
                      )
                    }
                    aria-invalid={isInvalid}
                    className="h-8 text-xs px-2 w-16 text-center font-mono bg-muted/20 border-border/50 focus-visible:ring-1"
                  />
                </div>
                <FieldContent className="px-1.5">
                  <Slider
                    value={[field.state.value]}
                    onValueChange={([v]) => field.handleChange(v)}
                    min={1}
                    max={150}
                    step={1}
                    className="py-1"
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </FieldContent>
              </Field>
            );
          }}
        />

        {/* CFG Scale */}
        <form.Field
          name={prefix === 'txt2img' ? 'txt2img.cfgScale' : 'img2img.cfgScale'}
          children={(field) => {
            const isInvalid =
              field.state.meta.isTouched && !!field.state.meta.errors.length;
            return (
              <Field className="space-y-2.5" data-invalid={isInvalid}>
                <div className="flex items-center justify-between gap-2 px-0.5">
                  {renderFieldLabelWithHelp(
                    field.name,
                    'CFG Scale',
                    'Prompt guidance strength. Lower values allow more model freedom; higher values follow prompt more strictly.'
                  )}
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) =>
                      field.handleChange(
                        parseNumeric(filterNumeric(e.target.value, true))
                      )
                    }
                    aria-invalid={isInvalid}
                    className="h-8 text-xs px-2 w-16 text-center font-mono bg-muted/20 border-border/50 focus-visible:ring-1"
                  />
                </div>
                <FieldContent className="px-1.5">
                  <Slider
                    value={[field.state.value]}
                    onValueChange={([v]) => field.handleChange(v)}
                    min={1}
                    max={30}
                    step={0.5}
                    className="py-1"
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </FieldContent>
              </Field>
            );
          }}
        />

        {/* Batch Size */}
        <form.Field
          name={
            prefix === 'txt2img' ? 'txt2img.batchSize' : 'img2img.batchSize'
          }
          children={(field) => {
            const isInvalid =
              field.state.meta.isTouched && !!field.state.meta.errors.length;
            return (
              <Field
                className="col-span-2 space-y-2.5"
                data-invalid={isInvalid}
              >
                <div className="flex items-center justify-between gap-2 px-0.5">
                  {renderFieldLabelWithHelp(
                    field.name,
                    'Batch Size',
                    'How many images to queue per run. Larger batches increase total generation time and resource usage.'
                  )}
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) =>
                      field.handleChange(
                        parseNumeric(filterNumeric(e.target.value, false))
                      )
                    }
                    aria-invalid={isInvalid}
                    className="h-8 text-xs px-2 w-16 text-center font-mono bg-muted/20 border-border/50 focus-visible:ring-1"
                  />
                </div>
                <FieldContent className="px-1.5">
                  <Slider
                    value={[field.state.value]}
                    onValueChange={([v]) => field.handleChange(v)}
                    min={1}
                    max={100}
                    step={1}
                    className="py-1"
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </FieldContent>
              </Field>
            );
          }}
        />
      </div>

      <Accordion
        type="single"
        defaultValue="sampling-core"
        collapsible
        className="w-full rounded-lg border border-border/50 bg-muted/10 px-3"
      >
        <AccordionItem value="sampling-core" className="border-none">
          <AccordionTrigger className="w-full items-center py-4 pr-2 hover:no-underline">
            <div className="space-y-0.5 text-left">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/90">
                Sampling Seeds
              </p>
              <p className="text-[11px] text-muted-foreground/70">
                Control reproducibility and controlled variation behavior.
              </p>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-5">
              <form.Field
                name={
                  prefix === 'txt2img' ? 'txt2img.sampler' : 'img2img.sampler'
                }
                children={(field) => {
                  const isInvalid =
                    field.state.meta.isTouched &&
                    !!field.state.meta.errors.length;
                  return (
                    <Field data-invalid={isInvalid}>
                      {renderFieldLabelWithHelp(
                        field.name,
                        'Sampler',
                        'Sampling algorithm used for denoising. Different samplers can trade speed for detail and texture style.'
                      )}
                      <Select
                        name={field.name}
                        value={field.state.value}
                        onValueChange={(value) => field.handleChange(value)}
                      >
                        <SelectTrigger
                          id={field.name}
                          aria-invalid={isInvalid}
                          className="h-9 w-full text-xs px-3 bg-muted/20 border-border/40 hover:bg-muted/30 transition-colors"
                        >
                          <SelectValue placeholder="Select sampler" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup className="overflow-y-auto max-h-[40vh]">
                            {samplerOptions.map((item) => (
                              <SelectItem
                                key={item}
                                value={item}
                                className="text-xs"
                              >
                                {item}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      {isInvalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  );
                }}
              />

              <form.Field
                name={
                  prefix === 'txt2img'
                    ? 'txt2img.scheduler'
                    : 'img2img.scheduler'
                }
                children={(field) => {
                  const isInvalid =
                    field.state.meta.isTouched &&
                    !!field.state.meta.errors.length;
                  return (
                    <Field data-invalid={isInvalid}>
                      {renderFieldLabelWithHelp(
                        field.name,
                        'Scheduler',
                        'Noise schedule strategy paired with sampler. This changes the denoising trajectory and final image character.'
                      )}
                      <Select
                        name={field.name}
                        value={field.state.value}
                        onValueChange={(value) => field.handleChange(value)}
                      >
                        <SelectTrigger
                          id={field.name}
                          aria-invalid={isInvalid}
                          className="h-9 w-full text-xs px-3 bg-muted/20 border-border/40 hover:bg-muted/30 transition-colors"
                        >
                          <SelectValue placeholder="Select scheduler" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup className="overflow-y-auto max-h-[40vh]">
                            {schedulerOptions.map((item) => (
                              <SelectItem
                                key={item}
                                value={item}
                                className="text-xs"
                              >
                                {item}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      {isInvalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  );
                }}
              />

              <form.Field
                name={prefix === 'txt2img' ? 'txt2img.seed' : 'img2img.seed'}
                children={(field) => {
                  const isInvalid =
                    field.state.meta.isTouched &&
                    !!field.state.meta.errors.length;
                  return (
                    <Field data-invalid={isInvalid}>
                      {renderFieldLabelWithHelp(
                        field.name,
                        'Seed',
                        'Base randomization seed. Keep the same seed for reproducibility, or leave empty to use a random seed.'
                      )}
                      <Input
                        id={field.name}
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        aria-invalid={isInvalid}
                        placeholder="Random/Empty"
                        className="h-9 text-xs px-3 font-mono bg-muted/10 border-border/30 focus-visible:ring-1"
                      />
                      {isInvalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  );
                }}
              />

              <form.Field
                name={
                  prefix === 'txt2img'
                    ? 'txt2img.variationSeed'
                    : 'img2img.variationSeed'
                }
                children={(field) => {
                  const isInvalid =
                    field.state.meta.isTouched &&
                    !!field.state.meta.errors.length;
                  return (
                    <Field data-invalid={isInvalid}>
                      {renderFieldLabelWithHelp(
                        field.name,
                        'Variation Seed',
                        'Optional secondary seed for controlled variations. Use -1 to randomize variation seed on each run while keeping your base seed.'
                      )}
                      <Input
                        id={field.name}
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        aria-invalid={isInvalid}
                        placeholder="Optional"
                        className="h-9 text-xs px-3 font-mono bg-muted/10 border-border/30 focus-visible:ring-1"
                      />
                      {isInvalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  );
                }}
              />

              <form.Field
                name={
                  prefix === 'txt2img'
                    ? 'txt2img.variationSeedStrength'
                    : 'img2img.variationSeedStrength'
                }
                children={(field) => {
                  const isInvalid =
                    field.state.meta.isTouched &&
                    !!field.state.meta.errors.length;
                  return (
                    <Field
                      className="col-span-2 space-y-2.5"
                      data-invalid={isInvalid}
                    >
                      <div className="flex items-center justify-between gap-2 px-0.5">
                        {renderFieldLabelWithHelp(
                          field.name,
                          'Variation Strength',
                          'Controls how strongly variation seed influences final seed.'
                        )}
                        <Input
                          id={field.name}
                          name={field.name}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) =>
                            field.handleChange(
                              parseNumeric(filterNumeric(e.target.value, true))
                            )
                          }
                          aria-invalid={isInvalid}
                          className="h-8 text-xs px-2 w-16 text-center font-mono bg-muted/20 border-border/50 focus-visible:ring-1"
                        />
                      </div>
                      <FieldContent className="px-1.5">
                        <Slider
                          value={[field.state.value]}
                          onValueChange={([v]) => field.handleChange(v)}
                          min={0}
                          max={1}
                          step={0.01}
                          className="py-1"
                        />
                        {isInvalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </FieldContent>
                    </Field>
                  );
                }}
              />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Resolution Row */}
      <FieldGroup className="grid grid-cols-2 gap-x-6 gap-y-5 pt-2 border-t border-border/10">
        {/* Preset Selector */}
        <form.Field
          name={
            prefix === 'txt2img' ? 'txt2img.resolution' : 'img2img.resolution'
          }
          children={(field) => (
            <Field className="col-span-2">
              <FieldLabel
                htmlFor={`${prefix}-resolution-presets`}
                className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5"
              >
                Resolution Presets
              </FieldLabel>
              <Select
                name={field.name}
                onValueChange={(val) => {
                  const [w, h] = val.split('x').map(Number);
                  field.handleChange({ width: w, height: h });
                }}
                value={
                  RESOLUTION_PRESETS.SDXL.some(
                    (p) =>
                      p.width === field.state.value.width &&
                      p.height === field.state.value.height
                  ) ||
                  RESOLUTION_PRESETS.SD.some(
                    (p) =>
                      p.width === field.state.value.width &&
                      p.height === field.state.value.height
                  )
                    ? `${field.state.value.width}x${field.state.value.height}`
                    : undefined
                }
              >
                <SelectTrigger
                  id={`${prefix}-resolution-presets`}
                  className="h-9 w-full text-xs px-3 bg-muted/20 border-border/40 hover:bg-muted/30 transition-colors"
                >
                  <SelectValue placeholder="Custom / Manual" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup className="overflow-y-auto max-h-[40vh]">
                    <SelectGroup>
                      <SelectLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 py-1.5 px-3">
                        SDXL Optimized
                      </SelectLabel>
                      {RESOLUTION_PRESETS.SDXL.map((p) => (
                        <SelectItem
                          key={p.label}
                          value={`${p.width}x${p.height}`}
                          className="text-xs"
                        >
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    <div className="h-px bg-border/40 my-1" />
                    <SelectGroup>
                      <SelectLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 py-1.5 px-3">
                        Standard SD
                      </SelectLabel>
                      {RESOLUTION_PRESETS.SD.map((p) => (
                        <SelectItem
                          key={p.label}
                          value={`${p.width}x${p.height}`}
                          className="text-xs"
                        >
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
        />

        {/* Width */}
        <form.Field
          name={
            prefix === 'txt2img'
              ? 'txt2img.resolution.width'
              : 'img2img.resolution.width'
          }
          children={(field) => {
            const isInvalid =
              field.state.meta.isTouched && !!field.state.meta.errors.length;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel
                  htmlFor={field.name}
                  className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5"
                >
                  Width
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) =>
                    field.handleChange(
                      parseNumeric(filterNumeric(e.target.value, false))
                    )
                  }
                  aria-invalid={isInvalid}
                  className="h-8 text-xs px-3 bg-muted/20 border-border/40 focus-visible:ring-1"
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        />

        {/* Height */}
        <form.Field
          name={
            prefix === 'txt2img'
              ? 'txt2img.resolution.height'
              : 'img2img.resolution.height'
          }
          children={(field) => {
            const isInvalid =
              field.state.meta.isTouched && !!field.state.meta.errors.length;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel
                  htmlFor={field.name}
                  className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5"
                >
                  Height
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) =>
                    field.handleChange(
                      parseNumeric(filterNumeric(e.target.value, false))
                    )
                  }
                  aria-invalid={isInvalid}
                  className="h-8 text-xs px-3 bg-muted/20 border-border/40 focus-visible:ring-1"
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        />
      </FieldGroup>

      {prefix === 'txt2img' && (
        <div className="space-y-6">
          {renderRefineFields()}
          {renderClipSkipFields()}
          {renderFaceDetailerFields()}
        </div>
      )}

      {/* Denoise Strength */}
      {showDenoise && prefix === 'img2img' && (
        <form.Field
          name="img2img.denoiseStrength"
          children={(field) => {
            const isInvalid =
              field.state.meta.isTouched && !!field.state.meta.errors.length;
            return (
              <Field className="space-y-2.5" data-invalid={isInvalid}>
                <div className="flex items-center justify-between gap-2 px-0.5">
                  {renderFieldLabelWithHelp(
                    field.name,
                    'Denoise Strength',
                    'For img2img, controls how much to preserve from source image. Lower keeps structure, higher allows stronger changes.'
                  )}
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) =>
                      field.handleChange(
                        parseNumeric(filterNumeric(e.target.value, true))
                      )
                    }
                    aria-invalid={isInvalid}
                    className="h-8 text-xs px-2 w-16 text-center font-mono bg-muted/20 border-border/50 focus-visible:ring-1"
                  />
                </div>
                <FieldContent className="px-1.5">
                  <Slider
                    value={[field.state.value]}
                    onValueChange={([v]) => field.handleChange(v)}
                    min={0}
                    max={1}
                    step={0.01}
                    className="py-1"
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </FieldContent>
              </Field>
            );
          }}
        />
      )}
    </div>
  );

  React.useEffect(() => {
    const sub = form.store.subscribe((state) => {
      pendingValuesRef.current = {
        txt2img: state.values.txt2img,
        img2img: state.values.img2img
      };

      if (storeSyncTimerRef.current !== null) {
        window.clearTimeout(storeSyncTimerRef.current);
      }

      storeSyncTimerRef.current = window.setTimeout(
        flushFormChangesToStore,
        STORE_SYNC_DEBOUNCE_MS
      );
    });

    return () => {
      sub.unsubscribe();
      if (storeSyncTimerRef.current !== null) {
        window.clearTimeout(storeSyncTimerRef.current);
        storeSyncTimerRef.current = null;
      }
    };
  }, [form.store, flushFormChangesToStore]);
  React.useEffect(() => {
    lastSyncedValuesRef.current = {
      txt2img,
      img2img
    };
    if (storeSyncTimerRef.current === null) {
      pendingValuesRef.current = {
        txt2img,
        img2img
      };
    }
  }, [txt2img, img2img]);
  React.useEffect(() => {
    const currentTxt2Img = form.getFieldValue('txt2img');
    const currentImg2Img = form.getFieldValue('img2img');

    if (!isSameTxt2Img(currentTxt2Img, txt2img)) {
      form.setFieldValue('txt2img', txt2img);
    }
    if (!isSameImg2Img(currentImg2Img, img2img)) {
      form.setFieldValue('img2img', img2img);
    }
  }, [form, txt2img, img2img]);

  return (
    <div className="flex flex-col h-full bg-background/30 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-5 border-b border-border/10 bg-muted/20 backdrop-blur-md">
        <h2 className="text-sm font-bold uppercase tracking-widest text-primary/80">
          Generation Parameters
        </h2>
        <div className="flex items-center gap-2">
          {isGenerating && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-bold text-primary animate-pulse">
              <span className="size-1.5 rounded-full bg-primary" />
              GENERATING
            </div>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0 mr-1">
        <form className="space-y-8 px-6 py-6 pb-12">
          {mode === 'txt2img' ? (
            <FieldGroup>
              {renderModelFields('txt2img')}
              <div className="space-y-4">
                <form.Field
                  name="txt2img.prompt"
                  children={(field) => {
                    const isInvalid =
                      field.state.meta.isTouched &&
                      !!field.state.meta.errors.length;
                    return (
                      <Field data-invalid={isInvalid} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <FieldLabel
                            htmlFor={field.name}
                            className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60 ml-0.5"
                          >
                            Positive Prompt
                          </FieldLabel>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-muted-foreground hover:text-primary hover:bg-primary/5 gap-1.5 transition-colors"
                            onClick={handleFormatPrompts}
                            title="Format Prompts"
                          >
                            <BrushCleaningIcon className="size-3.5" />
                            <span className="text-[10px] font-bold uppercase tracking-tight">
                              Format
                            </span>
                          </Button>
                        </div>
                        <FieldContent>
                          <PromptAutocompleteTextarea
                            id={field.name}
                            name={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={field.handleChange}
                            placeholder="Describe the image you want to generate"
                            ariaInvalid={isInvalid}
                            className="min-h-32 bg-muted/5 border-border/40 focus:border-primary/50 transition-colors duration-300"
                          />
                          <PromptTokenCounter value={field.state.value} />
                          {isInvalid && (
                            <FieldError errors={field.state.meta.errors} />
                          )}
                        </FieldContent>
                      </Field>
                    );
                  }}
                />

                <form.Field
                  name="txt2img.negativePrompt"
                  children={(field) => {
                    const isInvalid =
                      field.state.meta.isTouched &&
                      !!field.state.meta.errors.length;
                    return (
                      <Field data-invalid={isInvalid} className="space-y-2">
                        <FieldLabel
                          htmlFor={field.name}
                          className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60 ml-0.5"
                        >
                          Negative Prompt
                        </FieldLabel>
                        <FieldContent>
                          <PromptAutocompleteTextarea
                            id={field.name}
                            name={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={field.handleChange}
                            placeholder="What to avoid"
                            ariaInvalid={isInvalid}
                            className="min-h-20 bg-muted/5 border-border/40 focus:border-primary/50 transition-colors duration-300"
                          />
                          <PromptTokenCounter value={field.state.value} />
                          {isInvalid && (
                            <FieldError errors={field.state.meta.errors} />
                          )}
                        </FieldContent>
                      </Field>
                    );
                  }}
                />
              </div>

              <div className="space-y-4 pt-2">
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
                    Sampling & Canvas
                  </p>
                  <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                    Tune quality, guidance, and output resolution.
                  </p>
                </div>

                {renderNumericParameterFields({ prefix: 'txt2img' })}
              </div>
            </FieldGroup>
          ) : (
            <FieldGroup className="space-y-8">
              {renderModelFields('img2img')}
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
                      Source & Prompting
                    </p>
                    <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                      Use an existing image and guide the transformation.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-muted-foreground hover:text-primary hover:bg-primary/5 gap-1.5 transition-colors"
                    onClick={handleFormatPrompts}
                    title="Format Prompts"
                  >
                    <BrushCleaningIcon className="size-3.5" />
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                      Format
                    </span>
                  </Button>
                </div>

                <form.Field
                  name="img2img.sourceImagePath"
                  children={(field) => {
                    const isInvalid =
                      field.state.meta.isTouched &&
                      !!field.state.meta.errors.length;
                    return (
                      <Field data-invalid={isInvalid} className="space-y-2">
                        <FieldLabel
                          htmlFor={field.name}
                          className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 ml-0.5"
                        >
                          Source Image Path
                        </FieldLabel>
                        <FieldContent>
                          <Input
                            id={field.name}
                            name={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
                            placeholder="D:/images/source.png"
                            aria-invalid={isInvalid}
                            className="bg-muted/5 border-border/40"
                          />
                          {isInvalid && (
                            <FieldError errors={field.state.meta.errors} />
                          )}
                        </FieldContent>
                      </Field>
                    );
                  }}
                />

                <form.Field
                  name="img2img.prompt"
                  children={(field) => {
                    const isInvalid =
                      field.state.meta.isTouched &&
                      !!field.state.meta.errors.length;
                    return (
                      <Field data-invalid={isInvalid} className="space-y-2">
                        <FieldLabel
                          htmlFor={field.name}
                          className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 ml-0.5"
                        >
                          Prompt
                        </FieldLabel>
                        <FieldContent>
                          <PromptAutocompleteTextarea
                            id={field.name}
                            name={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={field.handleChange}
                            placeholder="Describe how the source image should be transformed"
                            ariaInvalid={isInvalid}
                            className="min-h-28 bg-muted/5 border-border/40 focus:border-primary/50 transition-colors duration-300"
                          />
                          <PromptTokenCounter value={field.state.value} />
                          {isInvalid && (
                            <FieldError errors={field.state.meta.errors} />
                          )}
                        </FieldContent>
                      </Field>
                    );
                  }}
                />

                <form.Field
                  name="img2img.negativePrompt"
                  children={(field) => {
                    const isInvalid = !!field.state.meta.errors.length;
                    return (
                      <Field data-invalid={isInvalid} className="space-y-2">
                        <FieldLabel
                          htmlFor={field.name}
                          className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 ml-0.5"
                        >
                          Negative Prompt
                        </FieldLabel>
                        <FieldContent>
                          <PromptAutocompleteTextarea
                            id={field.name}
                            name={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={field.handleChange}
                            placeholder="Artifacts or styles to avoid"
                            ariaInvalid={isInvalid}
                            className="min-h-20 bg-muted/5 border-border/40 focus:border-primary/50 transition-colors duration-300"
                          />
                          <PromptTokenCounter value={field.state.value} />
                          {isInvalid && (
                            <FieldError errors={field.state.meta.errors} />
                          )}
                        </FieldContent>
                      </Field>
                    );
                  }}
                />

                {renderNumericParameterFields({
                  prefix: 'img2img',
                  showDenoise: true
                })}
              </div>
            </FieldGroup>
          )}
        </form>
      </ScrollArea>
    </div>
  );
}

export const GenerationParametersPanel = React.memo(
  GenerationParametersPanelBase
);
