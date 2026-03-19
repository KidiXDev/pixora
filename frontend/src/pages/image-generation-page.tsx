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
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

const workflowPreviewMethodNames = [
  'pixora/internal/services.GenerationService.PreviewText2ImageWorkflow',
  'services.GenerationService.PreviewText2ImageWorkflow'
] as const;

const workflowEmbedMethodNames = [
  'pixora/internal/services.GenerationService.PrepareEmbeddedText2ImageWorkflow',
  'services.GenerationService.PrepareEmbeddedText2ImageWorkflow'
] as const;

export default function ImageGenerationPage() {
  const [isConfigSheetOpen, setIsConfigSheetOpen] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [isWorkflowOpen, setIsWorkflowOpen] = useState(false);
  const [isWorkflowLoading, setIsWorkflowLoading] = useState(false);
  const [isComfyEmbedLoading, setIsComfyEmbedLoading] = useState(false);
  const [workflowJSON, setWorkflowJSON] = useState('');
  const [comfyEmbedURL, setComfyEmbedURL] = useState('');
  const [stagedComfyWorkflowPath, setStagedComfyWorkflowPath] = useState('');
  const lastComfyErrorRef = useRef('');
  const lastModelCatalogErrorRef = useRef('');
  const {
    mode,
    comfyUI,
    comfyStatus,
    modelCatalog,
    comfyError,
    modelCatalogError,
    isModelCatalogLoading,
    isComfyActionPending,
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
    setMode,
    updateComfyUIConfig,
    updateTxt2Img,
    updateImg2Img,
    generateText2Image,
    interruptGeneration
  } = useImageGenerationStore(
    useShallow((state) => ({
      mode: state.mode,
      comfyUI: state.comfyUI,
      comfyStatus: state.comfyStatus,
      modelCatalog: state.modelCatalog,
      comfyError: state.comfyError,
      modelCatalogError: state.modelCatalogError,
      isModelCatalogLoading: state.isModelCatalogLoading,
      isComfyActionPending: state.isComfyActionPending,
      isComfyConfigSaving: state.isComfyConfigSaving,
      isGenerating: state.isGenerating,
      txt2img: state.txt2img,
      img2img: state.img2img,
      history: state.history,
      initializeComfyLifecycle: state.initializeComfyLifecycle,
      saveComfyUIConfig: state.saveComfyUIConfig,
      startComfyUI: state.startComfyUI,
      stopComfyUI: state.stopComfyUI,
      restartComfyUI: state.restartComfyUI,
      setMode: state.setMode,
      updateComfyUIConfig: state.updateComfyUIConfig,
      updateTxt2Img: state.updateTxt2Img,
      updateImg2Img: state.updateImg2Img,
      generateText2Image: state.generateText2Image,
      interruptGeneration: state.interruptGeneration
    }))
  );
  const {
    comfyLogs,
    isComfyLogsLoading,
    loadComfyLogs,
    clearComfyLogs
  } = useImageGenerationStore(
    useShallow((state) => ({
      comfyLogs: state.comfyLogs,
      isComfyLogsLoading: state.isComfyLogsLoading,
      loadComfyLogs: state.loadComfyLogs,
      clearComfyLogs: state.clearComfyLogs
    }))
  );

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

  const handleGenerate = useCallback(() => {
    if (mode !== 'txt2img') {
      toast.error('Only txt2img is available right now.');
      return;
    }

    if (!comfyStatus.running) {
      const backendState =
        comfyStatus.state === 'starting'
          ? 'ComfyUI is still starting.'
          : comfyStatus.state === 'stopping'
            ? 'ComfyUI is shutting down.'
            : comfyStatus.state === 'error'
              ? 'ComfyUI is in an error state.'
              : 'ComfyUI is not running.';

      toast.error('Cannot start generation', {
        description: `${backendState} ${comfyStatus.statusMessage?.trim() || 'Start the backend first, then try again.'}`,
        action: {
          label: 'Open settings',
          onClick: () => setIsConfigSheetOpen(true)
        }
      });
      return;
    }

    void generateText2Image();
  }, [mode, comfyStatus, generateText2Image]);


  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === 'Enter'
      ) {
        handleGenerate();
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleGenerate]);


  const buildWorkflowRequest = useCallback(
    () => ({
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
    }),
    [mode, txt2img]
  );


  const callGenerationService = async (
    methodNames: readonly string[],
    request: ReturnType<typeof buildWorkflowRequest>
  ) => {
    let result: unknown;
    let lastError: unknown = null;

    for (const methodName of methodNames) {
      try {
        result = await Call.ByName(methodName, request);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError !== null) {
      throw lastError;
    }

    return result;
  };

  const loadWorkflowPreview = async () => {
    if (mode !== 'txt2img') {
      toast.error('Workflow preview is only available for txt2img right now.');
      return;
    }

    setIsWorkflowLoading(true);
    try {
      const payload = await callGenerationService(
        workflowPreviewMethodNames,
        buildWorkflowRequest()
      );

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

  const prepareComfyEmbed = async () => {
    if (mode !== 'txt2img') {
      toast.error('Embedded ComfyUI is only available for txt2img right now.');
      return;
    }

    if (!comfyStatus.running) {
      toast.error('ComfyUI is not running.', {
        description: 'Start the backend before opening the embedded interface.'
      });
      return;
    }

    setIsComfyEmbedLoading(true);
    try {
      const payload = await callGenerationService(
        workflowEmbedMethodNames,
        buildWorkflowRequest()
      );
      const stagedPath = typeof payload === 'string' ? payload.trim() : '';
      if (stagedPath === '') {
        throw new Error('Embedded workflow path was empty.');
      }

      const embedURL = new URL(comfyUI.apiUrl);
      embedURL.searchParams.set('pixoraWorkflow', stagedPath);

      setStagedComfyWorkflowPath(stagedPath);
      if (comfyEmbedURL === '') {
        setComfyEmbedURL(embedURL.toString());
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to stage workflow for ComfyUI.';
      toast.error('Embedded ComfyUI failed', {
        description: message
      });
    } finally {
      setIsComfyEmbedLoading(false);
    }
  };

  const reloadComfyEmbed = async () => {
    if (comfyEmbedURL === '' || stagedComfyWorkflowPath === '') {
      await prepareComfyEmbed();
      return;
    }

    try {
      const embedURL = new URL(comfyUI.apiUrl);
      embedURL.searchParams.set('pixoraWorkflow', stagedComfyWorkflowPath);
      embedURL.searchParams.set('pixoraNonce', Date.now().toString());
      setComfyEmbedURL(embedURL.toString());
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to reload embedded ComfyUI.';
      toast.error('Embedded ComfyUI failed', {
        description: message
      });
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
        comfyEmbedURL={comfyEmbedURL}
        stagedComfyWorkflowPath={stagedComfyWorkflowPath}
        isComfyEmbedLoading={isComfyEmbedLoading}
        onRefresh={() => {
          void loadWorkflowPreview();
        }}
        onReloadComfyEmbed={() => {
          void reloadComfyEmbed();
        }}
        onLoadComfyWorkflow={() => {
          void prepareComfyEmbed();
        }}
      />
    </div>
  );
}
