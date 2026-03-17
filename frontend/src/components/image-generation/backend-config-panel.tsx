import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  ComfyUIConfig,
  ImageGenerationBackend,
  StableDiffusionWebUIConfig
} from '@/types/image-generation';
import { Link } from 'lucide-react';

interface BackendConfigPanelProps {
  activeBackend: ImageGenerationBackend;
  stableDiffusion: StableDiffusionWebUIConfig;
  comfyUI: ComfyUIConfig;
  onBackendChange: (backend: ImageGenerationBackend) => void;
  onStableDiffusionChange: (patch: Partial<StableDiffusionWebUIConfig>) => void;
  onComfyUIChange: (patch: Partial<ComfyUIConfig>) => void;
}

export function BackendConfigPanel({
  activeBackend,
  stableDiffusion,
  comfyUI,
  onBackendChange,
  onStableDiffusionChange,
  onComfyUIChange
}: BackendConfigPanelProps) {


  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">Active Backend</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onBackendChange('stable-diffusion-webui')}
            className={cn(
              'rounded-xl border px-3.5 py-3 text-left transition-colors',
              activeBackend === 'stable-diffusion-webui'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:bg-muted/40'
            )}
          >
            <p className="text-xs font-semibold uppercase tracking-wide">
              Stable Diffusion WebUI
            </p>
            <p className="text-xs text-muted-foreground mt-1.5">
              API-compatible txt2img and img2img parameter mapping
            </p>
          </button>

          <button
            type="button"
            onClick={() => onBackendChange('comfyui')}
            className={cn(
              'rounded-xl border px-3.5 py-3 text-left transition-colors',
              activeBackend === 'comfyui'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:bg-muted/40'
            )}
          >
            <p className="text-xs font-semibold uppercase tracking-wide">
              ComfyUI
            </p>
            <p className="text-xs text-muted-foreground mt-1.5">
              Workflow-driven generation via ComfyUI API
            </p>
          </button>
        </div>
      </div>

      <section className="space-y-3 rounded-xl border border-border/70 bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">Stable Diffusion WebUI</p>
          {activeBackend === 'stable-diffusion-webui' && (
            <Badge variant="default" className="text-[10px]">
              Active
            </Badge>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">API URL</label>
          <div className="relative">
            <Link className="size-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              value={stableDiffusion.apiUrl}
              onChange={(e) =>
                onStableDiffusionChange({ apiUrl: e.target.value })
              }
              className="pl-8"
              placeholder="http://127.0.0.1:7860"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">
            Stable Diffusion WebUI directory location
          </label>
          <Input
            value={stableDiffusion.localPath}
            onChange={(e) =>
              onStableDiffusionChange({ localPath: e.target.value })
            }
            placeholder="D:/Apps/stable-diffusion-webui"
          />
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border/70 bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">ComfyUI</p>
          {activeBackend === 'comfyui' && (
            <Badge variant="default" className="text-[10px]">
              Active
            </Badge>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">API URL</label>
          <div className="relative">
            <Link className="size-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              value={comfyUI.apiUrl}
              onChange={(e) => onComfyUIChange({ apiUrl: e.target.value })}
              className="pl-8"
              placeholder="http://127.0.0.1:8188"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">
            ComfyUI directory location
          </label>
          <Input
            value={comfyUI.localPath}
            onChange={(e) => onComfyUIChange({ localPath: e.target.value })}
            placeholder="D:/Apps/ComfyUI"
          />
        </div>


      </section>
    </div>
  );
}
