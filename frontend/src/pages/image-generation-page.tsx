import { BackendConfigDrawer } from '@/components/image-generation/backend-config-drawer';
import { ComfyUILogsDialog } from '@/components/image-generation/comfyui-logs-dialog';
import { GenerationParametersPanel } from '@/components/image-generation/generation-parameters-panel';
import { GenerationPreviewPanel } from '@/components/image-generation/generation-preview-panel';
import { GenerationSideNav } from '@/components/image-generation/generation-side-nav';
import { GenerationWorkflowDialog } from '@/components/image-generation/generation-workflow-dialog';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@/components/ui/resizable';
import { Call } from '@wailsio/runtime';
import { useImageGenerationStore } from '@/stores/image-generation-store';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

const workflowPreviewMethodNames = [
  'pixora/internal/services.GenerationService.PreviewText2ImageWorkflow',
  'services.GenerationService.PreviewText2ImageWorkflow'
] as const;

export default function ImageGenerationPage() {
  const [isConfigSheetOpen, setIsConfigSheetOpen] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [isWorkflowOpen, setIsWorkflowOpen] = useState(false);
  const [isWorkflowLoading, setIsWorkflowLoading] = useState(false);
  const [workflowJSON, setWorkflowJSON] = useState('');
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

  const loadWorkflowPreview = async () => {
    if (mode !== 'txt2img') {
      toast.error('Workflow preview is only available for txt2img right now.');
      return;
    }

    setIsWorkflowLoading(true);
    try {
      const request = {
        requestId: '',
        mode,
        prompt: txt2img.prompt,
        negativePrompt: txt2img.negativePrompt,
        seed: txt2img.seed,
        steps: txt2img.steps,
        cfgScale: txt2img.cfgScale,
        width: txt2img.resolution.width,
        height: txt2img.resolution.height,
        model: txt2img.model,
        vae: txt2img.vae,
        sampler: txt2img.sampler,
        scheduler: txt2img.scheduler
      };

      let payload: unknown;
      let lastError: unknown = null;

      for (const methodName of workflowPreviewMethodNames) {
        try {
          payload = await Call.ByName(methodName, request);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (lastError !== null) {
        throw lastError;
      }

      setWorkflowJSON(typeof payload === 'string' ? payload : '');
      setIsWorkflowOpen(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to build workflow.';
      toast.error('Workflow preview failed', {
        description: message
      });
    } finally {
      setIsWorkflowLoading(false);
    }
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
                isWorkflowLoading={isWorkflowLoading}
                onGenerate={handleGenerate}
                onInterrupt={() => {
                  void interruptGeneration();
                }}
                onOpenWorkflow={() => {
                  void loadWorkflowPreview();
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

      <GenerationWorkflowDialog
        open={isWorkflowOpen}
        onOpenChange={setIsWorkflowOpen}
        workflowJSON={workflowJSON}
        isLoading={isWorkflowLoading}
        onRefresh={() => {
          void loadWorkflowPreview();
        }}
      />
    </div>
  );
}
