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
} from '@/types/image-generation';

interface BackendConfigDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comfyUI: ComfyUIConfig;
  onComfyUIChange: (patch: Partial<ComfyUIConfig>) => void;
}

export function BackendConfigDrawer({
  open,
  onOpenChange,
  comfyUI,
  onComfyUIChange
}: BackendConfigDrawerProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent>
        <div className="mx-auto w-full max-w-lg h-full flex flex-col">
          <DrawerHeader className="px-5 pt-6 pb-2">
            <DrawerTitle className="text-xl font-bold tracking-tight">Embedded Engine Settings</DrawerTitle>
            <DrawerDescription className="text-sm">
              Configure your local ComfyUI instance, launch parameters, and storage locations.
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex-1 px-5 py-4 overflow-y-auto min-h-0 custom-scrollbar">
            <BackendConfigPanel
              comfyUI={comfyUI}
              onComfyUIChange={onComfyUIChange}
            />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
