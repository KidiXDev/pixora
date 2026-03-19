import { BackendConfigDrawer } from '@/components/image-generation/backend-config-drawer';
import { ComfyUILogsDialog } from '@/components/image-generation/comfyui-logs-dialog';
import { GenerationParametersPanel } from '@/components/image-generation/generation-parameters-panel';
import { GenerationPreviewPanel } from '@/components/image-generation/generation-preview-panel';
import { GenerationSideNav } from '@/components/image-generation/generation-side-nav';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@/components/ui/resizable';
import { useImageGenerationStore } from '@/stores/image-generation-store';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

export default function ImageGenerationPage() {
  const [isConfigSheetOpen, setIsConfigSheetOpen] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const lastComfyErrorRef = useRef('');
  const lastModelCatalogErrorRef = useRef('');
  const {
    mode,
    comfyUI,
    comfyStatus,
    modelCatalog,
    comfyLogs,
    comfyError,
    modelCatalogError,
    isModelCatalogLoading,
    isComfyActionPending,
    isComfyLogsLoading,
    isComfyConfigSaving,
    isGenerating,
    txt2img,
    img2img,
    history,
    initializeComfyLifecycle,
    saveComfyUIConfig,
    startComfyUI,
    stopComfyUI,
    restartComfyUI,
    loadComfyLogs,
    clearComfyLogs,
    setMode,
    updateComfyUIConfig,
    updateTxt2Img,
    updateImg2Img,
    generateText2Image,
    interruptGeneration
  } = useImageGenerationStore();

  useEffect(() => {
    void initializeComfyLifecycle();
  }, [initializeComfyLifecycle]);

  useEffect(() => {
    if (!isLogsOpen) {
      return;
    }

    void loadComfyLogs(500);
  }, [isLogsOpen, loadComfyLogs]);

  useEffect(() => {
    const nextError = comfyError.trim();
    if (nextError === '' || nextError === lastComfyErrorRef.current) {
      lastComfyErrorRef.current = nextError;
      return;
    }

    toast.error('ComfyUI error', {
      description: nextError
    });
    lastComfyErrorRef.current = nextError;
  }, [comfyError]);

  useEffect(() => {
    const nextError = modelCatalogError.trim();
    if (
      nextError === '' ||
      nextError === lastModelCatalogErrorRef.current
    ) {
      lastModelCatalogErrorRef.current = nextError;
      return;
    }

    toast.error('Model catalog unavailable', {
      description: nextError
    });
    lastModelCatalogErrorRef.current = nextError;
  }, [modelCatalogError]);

  const handleGenerate = () => {
    if (mode !== 'txt2img') {
      toast.error('Only txt2img is available right now.');
      return;
    }

    if (!comfyStatus.running) {
      const backendState =
        comfyStatus.state === 'starting'
          ? 'ComfyUI is still starting.'
          : 'ComfyUI is not running.';

      toast.error('Cannot start generation', {
        description: `${backendState} Start the backend first, then try again.`,
        action: {
          label: 'Open settings',
          onClick: () => setIsConfigSheetOpen(true)
        }
      });
      return;
    }

    void generateText2Image();
  };

  return (
    <div className="flex h-full overflow-hidden bg-[radial-gradient(ellipse_at_top_right,var(--tw-gradient-stops))] from-primary/5 via-background to-background">
      <GenerationSideNav
        mode={mode}
        onModeChange={setMode}
        onOpenSettings={() => setIsConfigSheetOpen(true)}
      />

      <main className="flex-1 flex min-w-0 overflow-hidden">
        <ResizablePanelGroup
          orientation="horizontal"
          className="flex-1 items-stretch"
        >
          <ResizablePanel
            defaultSize="30"
            minSize="27"
            maxSize="65"
            className="flex flex-col bg-card/10 min-h-0 overflow-hidden"
          >
            <GenerationParametersPanel
              mode={mode}
              modelCatalog={modelCatalog}
              modelCatalogLoading={isModelCatalogLoading}
              txt2img={txt2img}
              img2img={img2img}
              isGenerating={isGenerating}
              onTxt2ImgChange={updateTxt2Img}
              onImg2ImgChange={updateImg2Img}
            />
          </ResizablePanel>

          <ResizableHandle
            withHandle
            className="bg-border/30 hover:bg-primary/20 transition-colors w-1.5"
          />

          <ResizablePanel defaultSize="70" className="flex flex-col min-h-0">
            <div className="flex-1 min-w-0 h-full p-6 lg:p-8 overflow-hidden">
              <GenerationPreviewPanel
                history={history}
                isGenerating={isGenerating}
                onGenerate={handleGenerate}
                onInterrupt={() => {
                  void interruptGeneration();
                }}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>

      <BackendConfigDrawer
        open={isConfigSheetOpen}
        onOpenChange={setIsConfigSheetOpen}
        comfyUI={comfyUI}
        status={comfyStatus}
        isActionPending={isComfyActionPending}
        isConfigSaving={isComfyConfigSaving}
        errorMessage={comfyError}
        onComfyUIChange={updateComfyUIConfig}
        onSaveConfig={saveComfyUIConfig}
        onStart={startComfyUI}
        onStop={stopComfyUI}
        onRestart={restartComfyUI}
        onLogsClick={() => setIsLogsOpen(true)}
      />

      <ComfyUILogsDialog
        open={isLogsOpen}
        onOpenChange={setIsLogsOpen}
        logs={comfyLogs}
        status={comfyStatus}
        isLoading={isComfyLogsLoading}
        onRefresh={() => loadComfyLogs(500)}
        onClear={clearComfyLogs}
      />
    </div>
  );
}
