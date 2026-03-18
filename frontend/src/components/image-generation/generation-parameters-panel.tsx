'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
import { Textarea } from '@/components/ui/textarea';
import { filterNumeric, parseNumeric } from '@/lib/utils';
import { img2imgSchema, txt2imgSchema } from '@/schema/generation-schema';
import {
  ImageGenerationMode,
  Img2ImgParameters,
  Txt2ImgParameters
} from '@/types/image-generation';
import { useForm, type FormValidateOrFn } from '@tanstack/react-form';
import { WandSparkles } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

type FormValues = {
  txt2img: Txt2ImgParameters;
  img2img: Img2ImgParameters;
};

const SD_SAMPLERS = [
  'Euler a',
  'Euler',
  'Heun',
  'DPM++ 2M Karras',
  'DPM++ SDE Karras',
  'DPM++ 2S a Karras',
  'DPM2 a Karras',
  'LMS Karras'
] as const;

const SD_MODELS = [
  'v1-5-pruned-emaonly.safetensors',
  'sd_xl_base_1.0.safetensors',
  'sd_xl_refiner_1.0.safetensors',
  'dreamshaper_8.safetensors',
  'realisticVisionV60B1_v51VAE.safetensors'
] as const;

const SD_VAES = [
  'Auto',
  'vae-ft-mse-840000-ema-pruned.safetensors',
  'sdxl_vae.safetensors'
] as const;

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

interface GenerationParametersPanelProps {
  mode: ImageGenerationMode;
  txt2img: Txt2ImgParameters;
  img2img: Img2ImgParameters;
  onTxt2ImgChange: (patch: Partial<Txt2ImgParameters>) => void;
  onImg2ImgChange: (patch: Partial<Img2ImgParameters>) => void;
  onGenerate: () => void;
}

interface RenderNumericParameterFieldsOptions {
  prefix: 'txt2img' | 'img2img';
  showDenoise?: boolean;
}

export function GenerationParametersPanel({
  mode,
  txt2img,
  img2img,
  onTxt2ImgChange,
  onImg2ImgChange,
  onGenerate
}: GenerationParametersPanelProps) {
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

  const renderNumericParameterFields = ({
    prefix,
    showDenoise
  }: RenderNumericParameterFieldsOptions) => (
    <div className="space-y-5">
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
                  <FieldLabel
                    htmlFor={field.name}
                    className="text-xs text-muted-foreground font-bold uppercase tracking-widest"
                  >
                    Steps
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
                  <FieldLabel
                    htmlFor={field.name}
                    className="text-xs text-muted-foreground font-bold uppercase tracking-widest"
                  >
                    CFG Scale
                  </FieldLabel>
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
      </div>

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
                  <FieldLabel
                    htmlFor={field.name}
                    className="text-xs text-muted-foreground font-bold uppercase tracking-widest"
                  >
                    Denoise Strength
                  </FieldLabel>
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

      {/* Resolution Row */}
      <FieldGroup className="grid grid-cols-2 gap-x-6 gap-y-5 pt-2 border-t border-border/10">
        {/* Preset Selector */}
        <form.Field
          name={
            prefix === 'txt2img' ? 'txt2img.resolution' : 'img2img.resolution'
          }
          children={(field) => (
            <Field className="col-span-2 space-y-2">
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
              <Field className="space-y-2" data-invalid={isInvalid}>
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
              <Field className="space-y-2" data-invalid={isInvalid}>
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

      {/* Sampler & Seed Row */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        <form.Field
          name={prefix === 'txt2img' ? 'txt2img.sampler' : 'img2img.sampler'}
          children={(field) => {
            const isInvalid =
              field.state.meta.isTouched && !!field.state.meta.errors.length;
            return (
              <Field className="space-y-2" data-invalid={isInvalid}>
                <FieldLabel
                  htmlFor={field.name}
                  className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5"
                >
                  Sampler
                </FieldLabel>
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
                    {SD_SAMPLERS.map((item) => (
                      <SelectItem key={item} value={item} className="text-xs">
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        />

        <form.Field
          name={prefix === 'txt2img' ? 'txt2img.seed' : 'img2img.seed'}
          children={(field) => {
            const isInvalid =
              field.state.meta.isTouched && !!field.state.meta.errors.length;
            return (
              <Field className="space-y-2" data-invalid={isInvalid}>
                <FieldLabel
                  htmlFor={field.name}
                  className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5"
                >
                  Seed
                </FieldLabel>
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
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        />
      </div>

      {/* Checkpoint & VAE Row */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 pt-2 border-t border-border/10">
        <form.Field
          name={prefix === 'txt2img' ? 'txt2img.model' : 'img2img.model'}
          children={(field) => {
            const isInvalid =
              field.state.meta.isTouched && !!field.state.meta.errors.length;
            return (
              <Field className="space-y-2" data-invalid={isInvalid}>
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
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {SD_MODELS.map((item) => (
                      <SelectItem key={item} value={item} className="text-xs">
                        {item}
                      </SelectItem>
                    ))}
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
              <Field className="space-y-2" data-invalid={isInvalid}>
                <FieldLabel
                  htmlFor={field.name}
                  className="text-xs text-muted-foreground font-bold uppercase tracking-widest px-0.5"
                >
                  VAE
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
                    <SelectValue placeholder="Select VAE" />
                  </SelectTrigger>
                  <SelectContent>
                    {SD_VAES.map((item) => (
                      <SelectItem key={item} value={item} className="text-xs">
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        />
      </div>
    </div>
  );

  React.useEffect(() => {
    const sub = form.store.subscribe((state) => {
      onTxt2ImgChange(state.values.txt2img);
      onImg2ImgChange(state.values.img2img);
    });
    return () => sub.unsubscribe();
  }, [form.store, onTxt2ImgChange, onImg2ImgChange]);

  return (
    <Card className="border-0 shadow-none bg-card m-1">
      <CardHeader className="space-y-1 pb-4 border-b border-border/20">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-bold tracking-tight">
            Generation
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onGenerate();
          }}
        >
          {mode === 'txt2img' ? (
            <FieldGroup className="space-y-2">
              <div className="space-y-1">
                <p className="text-sm font-medium">Prompting</p>
                <p className="text-xs text-muted-foreground">
                  Describe the desired style, composition, and lighting.
                </p>
              </div>

              <form.Field
                name="txt2img.prompt"
                children={(field) => {
                  const isInvalid =
                    field.state.meta.isTouched &&
                    !!field.state.meta.errors.length;
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel
                        htmlFor={field.name}
                        className="text-xs text-muted-foreground"
                      >
                        Prompt
                      </FieldLabel>
                      <FieldContent>
                        <Textarea
                          id={field.name}
                          name={field.name}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          placeholder="Describe the image you want to generate"
                          aria-invalid={isInvalid}
                          className="min-h-26"
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
                name="txt2img.negativePrompt"
                children={(field) => {
                  const isInvalid =
                    field.state.meta.isTouched &&
                    !!field.state.meta.errors.length;
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel
                        htmlFor={field.name}
                        className="text-xs text-muted-foreground"
                      >
                        Negative Prompt
                      </FieldLabel>
                      <FieldContent>
                        <Textarea
                          id={field.name}
                          name={field.name}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          placeholder="What to avoid"
                          aria-invalid={isInvalid}
                          className="min-h-18"
                        />
                        {isInvalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </FieldContent>
                    </Field>
                  );
                }}
              />

              <div className="space-y-1">
                <p className="text-sm font-medium">Sampling & Canvas</p>
                <p className="text-xs text-muted-foreground">
                  Tune quality, guidance, and output resolution.
                </p>
              </div>

              {renderNumericParameterFields({ prefix: 'txt2img' })}
            </FieldGroup>
          ) : (
            <FieldGroup className="space-y-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">Source & Prompting</p>
                <p className="text-xs text-muted-foreground">
                  Use an existing image and guide the transformation.
                </p>
              </div>

              <form.Field
                name="img2img.sourceImagePath"
                children={(field) => {
                  const isInvalid =
                    field.state.meta.isTouched &&
                    !!field.state.meta.errors.length;
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel
                        htmlFor={field.name}
                        className="text-xs text-muted-foreground"
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
                    <Field data-invalid={isInvalid}>
                      <FieldLabel
                        htmlFor={field.name}
                        className="text-xs text-muted-foreground"
                      >
                        Prompt
                      </FieldLabel>
                      <FieldContent>
                        <Textarea
                          id={field.name}
                          name={field.name}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          placeholder="Describe how the source image should be transformed"
                          aria-invalid={isInvalid}
                          className="min-h-22"
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
                name="img2img.negativePrompt"
                children={(field) => {
                  const isInvalid = !!field.state.meta.errors.length;
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel
                        htmlFor={field.name}
                        className="text-xs text-muted-foreground"
                      >
                        Negative Prompt
                      </FieldLabel>
                      <FieldContent>
                        <Textarea
                          id={field.name}
                          name={field.name}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          placeholder="Artifacts or styles to avoid"
                          aria-invalid={isInvalid}
                          className="min-h-16"
                        />
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
            </FieldGroup>
          )}

          <div className="pt-6">
            <Button
              type="submit"
              className="w-full gap-2 h-11 text-sm font-semibold shadow-lg shadow-primary/25 bg-linear-to-r from-primary to-primary/90 hover:opacity-90 transition-all duration-300 rounded-xl"
            >
              <WandSparkles className="size-4" />
              Generate Preview
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
