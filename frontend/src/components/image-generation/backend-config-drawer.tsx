import { BackendConfigPanel } from '@/components/image-generation/backend-config-panel';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle
} from '@/components/ui/drawer';
import {
  ComfyUIConfig,
  ImageGenerationBackend,
  StableDiffusionWebUIConfig
} from '@/types/image-generation';

interface BackendConfigDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeBackend: ImageGenerationBackend;
  stableDiffusion: StableDiffusionWebUIConfig;
  comfyUI: ComfyUIConfig;
  onBackendChange: (backend: ImageGenerationBackend) => void;
  onStableDiffusionChange: (patch: Partial<StableDiffusionWebUIConfig>) => void;
  onComfyUIChange: (patch: Partial<ComfyUIConfig>) => void;
}

export function BackendConfigDrawer({
  open,
  onOpenChange,
  activeBackend,
  stableDiffusion,
  comfyUI,
  onBackendChange,
  onStableDiffusionChange,
  onComfyUIChange
}: BackendConfigDrawerProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Generation Backend Configuration</DrawerTitle>
          <DrawerDescription>
            Configure API endpoints and local installation folders for Stable
            Diffusion WebUI and ComfyUI.
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-5 overflow-y-auto">
          <BackendConfigPanel
            activeBackend={activeBackend}
            stableDiffusion={stableDiffusion}
            comfyUI={comfyUI}
            onBackendChange={onBackendChange}
            onStableDiffusionChange={onStableDiffusionChange}
            onComfyUIChange={onComfyUIChange}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
