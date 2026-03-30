import { BackendConfigPanel } from '@/components/image-generation/backend-config-panel';
import { ScrollablePage } from '@/components/layout/scrollable-page';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { ComfyUIConfig, ComfyUIStatus } from '@/types/image-generation';

interface BackendConfigDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comfyUI: ComfyUIConfig;
  status: ComfyUIStatus;
  isActionPending: boolean;
  isConfigSaving: boolean;
  errorMessage: string;
  onComfyUIChange: (patch: Partial<ComfyUIConfig>) => void;
  onSaveConfig: () => Promise<void>;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onRestart: () => Promise<void>;
  onLogsClick: () => void;
}

export function BackendConfigDrawer({
  open,
  onOpenChange,
  comfyUI,
  status,
  isActionPending,
  isConfigSaving,
  errorMessage,
  onComfyUIChange,
  onSaveConfig,
  onStart,
  onStop,
  onRestart,
  onLogsClick
}: BackendConfigDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="p-0" style={{ maxWidth: '50vw' }}>
        <div className="w-full h-full flex flex-col">
          <SheetHeader className="px-5 pt-8 pb-2">
            <SheetTitle className="text-xl font-bold tracking-tight">
              Engine Settings
            </SheetTitle>
            <SheetDescription className="text-sm">
              Configure your local ComfyUI instance, launch parameters, and
              storage locations.
            </SheetDescription>
          </SheetHeader>

          <ScrollablePage
            containerClassName="flex-1 min-h-0"
            className="px-5 py-4"
          >
            <BackendConfigPanel
              comfyUI={comfyUI}
              status={status}
              isActionPending={isActionPending}
              isConfigSaving={isConfigSaving}
              errorMessage={errorMessage}
              onComfyUIChange={onComfyUIChange}
              onSaveConfig={onSaveConfig}
              onStart={onStart}
              onStop={onStop}
              onRestart={onRestart}
              onLogsClick={onLogsClick}
            />
          </ScrollablePage>
        </div>
      </SheetContent>
    </Sheet>
  );
}
