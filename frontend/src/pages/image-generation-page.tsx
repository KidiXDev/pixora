import { BackendConfigDrawer } from '@/components/image-generation/backend-config-drawer';
import { ComfyUILogsDialog } from '@/components/image-generation/comfyui-logs-dialog';
import { ComfyUIOnboarding } from '@/components/image-generation/comfyui-onboarding';
import { ComfyUISetupDialog } from '@/components/image-generation/comfyui-setup-dialog';
import { GenerationParametersPanel } from '@/components/image-generation/generation-parameters-panel';
import { GenerationPreviewPanel } from '@/components/image-generation/generation-preview-panel';
import { GenerationSideNav } from '@/components/image-generation/generation-side-nav';
import { GenerationWorkflowDialog } from '@/components/image-generation/generation-workflow-dialog';
import { useConfirmation } from '@/components/providers/confirmation-provider';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@/components/ui/resizable';
import { useImageGenerationStore } from '@/stores/image-generation-store';
import { Call } from '@wailsio/runtime';
import { Loader2 } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
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
  const confirm = useConfirmation();
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
  const workflowPreviewRequestSeqRef = useRef(0);
  const workflowEmbedRequestSeqRef = useRef(0);
  const {
    mode,
    comfyUI,
    comfyStatus,
    comfySetup,
    comfyError,
    modelCatalogError,
    isComfyActionPending,
    isComfySetupLoading,
    isComfySetupInstalling,
    isComfyConfigSaving,
    initializeComfyLifecycle,
    refreshComfySetup,
    installComfyUI,
    saveComfyUIConfig,
    startComfyUI,
    stopComfyUI,
    restartComfyUI,
    setMode,
    updateComfyUIConfig,
    generateText2Image
  } = useImageGenerationStore(
    useShallow((state) => ({
      mode: state.mode,
      comfyUI: state.comfyUI,
      comfyStatus: state.comfyStatus,
      comfySetup: state.comfySetup,
      comfyError: state.comfyError,
      modelCatalogError: state.modelCatalogError,
      isComfyActionPending: state.isComfyActionPending,
      isComfySetupLoading: state.isComfySetupLoading,
      isComfySetupInstalling: state.isComfySetupInstalling,
      isComfyConfigSaving: state.isComfyConfigSaving,
      initializeComfyLifecycle: state.initializeComfyLifecycle,
      refreshComfySetup: state.refreshComfySetup,
      installComfyUI: state.installComfyUI,
      saveComfyUIConfig: state.saveComfyUIConfig,
      startComfyUI: state.startComfyUI,
      stopComfyUI: state.stopComfyUI,
      restartComfyUI: state.restartComfyUI,
      setMode: state.setMode,
      updateComfyUIConfig: state.updateComfyUIConfig,
      generateText2Image: state.generateText2Image
    }))
  );
  const { comfyLogs, isComfyLogsLoading, loadComfyLogs, clearComfyLogs } =
    useImageGenerationStore(
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
    if (nextError === '' || nextError === lastModelCatalogErrorRef.current) {
      lastModelCatalogErrorRef.current = nextError;
      return;
    }

    toast.error('Model catalog unavailable', {
      description: nextError
    });
    lastModelCatalogErrorRef.current = nextError;
  }, [modelCatalogError]);

  const handleGenerate = useCallback(() => {
    if (!comfySetup.isReady) {
      toast.error('ComfyUI setup is not complete', {
        description:
          comfySetup.statusMessage ||
          comfySetup.lastError ||
          'Install ComfyUI from the onboarding page first.'
      });
      return;
    }

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
  }, [mode, comfySetup, comfyStatus, generateText2Image]);

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        handleGenerate();
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleGenerate]);

  const buildWorkflowRequest = useCallback(() => {
    const state = useImageGenerationStore.getState();
    const currentMode = state.mode;
    const currentTxt2Img = state.txt2img;

    return {
      requestId: '',
      mode: currentMode,
      prompt: currentTxt2Img.prompt,
      negativePrompt: currentTxt2Img.negativePrompt,
      seed: currentTxt2Img.seed,
      steps: currentTxt2Img.steps,
      cfgScale: currentTxt2Img.cfgScale,
      width: currentTxt2Img.resolution.width,
      height: currentTxt2Img.resolution.height,
      model: currentTxt2Img.model,
      vae: currentTxt2Img.vae,
      sampler: currentTxt2Img.sampler,
      scheduler: currentTxt2Img.scheduler,
      batchSize: currentTxt2Img.batchSize,
      refine: currentTxt2Img.refine
    };
  }, []);

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
    if (!comfySetup.isReady) {
      toast.error('ComfyUI setup is not complete.', {
        description:
          comfySetup.statusMessage ||
          comfySetup.lastError ||
          'Install ComfyUI first.'
      });
      return;
    }

    if (mode !== 'txt2img') {
      toast.error('Workflow preview is only available for txt2img right now.');
      return;
    }

    workflowPreviewRequestSeqRef.current += 1;
    const requestSeq = workflowPreviewRequestSeqRef.current;

    setIsWorkflowLoading(true);
    try {
      const payload = await callGenerationService(
        workflowPreviewMethodNames,
        buildWorkflowRequest()
      );

      if (workflowPreviewRequestSeqRef.current !== requestSeq) {
        return;
      }

      setWorkflowJSON(typeof payload === 'string' ? payload : '');
      setIsWorkflowOpen(true);
    } catch (error) {
      if (workflowPreviewRequestSeqRef.current !== requestSeq) {
        return;
      }

      const message =
        error instanceof Error ? error.message : 'Failed to build workflow.';
      toast.error('Workflow preview failed', {
        description: message
      });
    } finally {
      if (workflowPreviewRequestSeqRef.current === requestSeq) {
        setIsWorkflowLoading(false);
      }
    }
  };

  const prepareComfyEmbed = async () => {
    if (!comfySetup.isReady) {
      toast.error('ComfyUI setup is not complete.', {
        description:
          comfySetup.statusMessage ||
          comfySetup.lastError ||
          'Install ComfyUI first.'
      });
      return;
    }

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

    workflowEmbedRequestSeqRef.current += 1;
    const requestSeq = workflowEmbedRequestSeqRef.current;

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

      if (workflowEmbedRequestSeqRef.current !== requestSeq) {
        return;
      }

      const embedURL = new URL(comfyUI.apiUrl);
      embedURL.searchParams.set('pixoraWorkflow', stagedPath);
      embedURL.searchParams.set('pixoraNonce', Date.now().toString());

      setStagedComfyWorkflowPath(stagedPath);
      setComfyEmbedURL(embedURL.toString());
    } catch (error) {
      if (workflowEmbedRequestSeqRef.current !== requestSeq) {
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : 'Failed to stage workflow for ComfyUI.';
      toast.error('Embedded ComfyUI failed', {
        description: message
      });
    } finally {
      if (workflowEmbedRequestSeqRef.current === requestSeq) {
        setIsComfyEmbedLoading(false);
      }
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

  const shouldShowSetupOnboarding =
    !isComfySetupLoading &&
    (!comfySetup.isReady ||
      comfySetup.requiresOnboarding ||
      comfySetup.state === 'installing' ||
      comfySetup.permissionProblem);

  const handleInstallComfyUI = useCallback(async () => {
    if (isComfySetupInstalling) {
      return;
    }

    const confirmed = await confirm.confirm({
      title: 'Install ComfyUI?',
      description:
        'Pixora will download and extract ComfyUI into backend/comfy.',
      confirmText: 'Install ComfyUI',
      cancelText: 'Cancel'
    });
    if (!confirmed) {
      return;
    }

    void installComfyUI();
  }, [confirm, installComfyUI, isComfySetupInstalling]);

  if (isComfySetupLoading) {
    return (
      <div className="flex h-full overflow-hidden bg-[radial-gradient(ellipse_at_top_right,var(--tw-gradient-stops))] from-primary/5 via-background to-background">
        <GenerationSideNav
          mode={mode}
          onModeChange={setMode}
          onOpenSettings={() => setIsConfigSheetOpen(true)}
        />
        <main className="flex min-w-0 flex-1 items-center justify-center px-8">
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <Loader2 className="size-7 animate-spin text-primary" />
            <h2 className="font-semibold text-lg text-foreground">
              Preparing Image Generation
            </h2>
            <p className="text-sm text-muted-foreground">
              Checking ComfyUI setup and loading your generation workspace...
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (shouldShowSetupOnboarding) {
    return (
      <div className="flex h-full overflow-hidden bg-[radial-gradient(ellipse_at_top_right,var(--tw-gradient-stops))] from-primary/5 via-background to-background">
        <GenerationSideNav
          mode={mode}
          onModeChange={setMode}
          onOpenSettings={() => setIsConfigSheetOpen(true)}
        />
        <main className="flex min-w-0 flex-1 overflow-hidden">
          <ComfyUIOnboarding
            setup={comfySetup}
            isInstalling={isComfySetupInstalling}
            onInstall={() => {
              void handleInstallComfyUI();
            }}
            onRefresh={() => {
              void refreshComfySetup();
            }}
          />
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

        <ComfyUISetupDialog
          open={isComfySetupInstalling}
          onOpenChange={() => {
            // The setup dialog is controlled by installer state and only appears while installing.
          }}
          setup={comfySetup}
          logs={comfyLogs}
          isInstalling={isComfySetupInstalling}
          onRefresh={() => {
            void refreshComfySetup();
          }}
        />
      </div>
    );
  }

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
            defaultSize="40"
            minSize="40"
            maxSize="65"
            className="flex flex-col bg-card/10 min-h-0 overflow-hidden"
          >
            <GenerationParametersPanelContainer />
          </ResizablePanel>

          <ResizableHandle
            withHandle
            className="bg-border/30 hover:bg-primary/20 transition-colors w-1.5"
          />

          <ResizablePanel defaultSize="70" className="flex flex-col min-h-0">
            <div className="flex-1 min-w-0 h-full p-6 lg:p-8 overflow-hidden">
              <GenerationPreviewPanelContainer
                isWorkflowLoading={isWorkflowLoading}
                onGenerate={handleGenerate}
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

const GenerationParametersPanelContainer = memo(
  function GenerationParametersPanelContainer() {
    const {
      mode,
      modelCatalog,
      isModelCatalogLoading,
      txt2img,
      img2img,
      isGenerating,
      loadModelCatalog,
      updateTxt2Img,
      updateImg2Img
    } = useImageGenerationStore(
      useShallow((state) => ({
        mode: state.mode,
        modelCatalog: state.modelCatalog,
        isModelCatalogLoading: state.isModelCatalogLoading,
        txt2img: state.txt2img,
        img2img: state.img2img,
        isGenerating: state.isGenerating,
        loadModelCatalog: state.loadModelCatalog,
        updateTxt2Img: state.updateTxt2Img,
        updateImg2Img: state.updateImg2Img
      }))
    );

    return (
      <GenerationParametersPanel
        mode={mode}
        modelCatalog={modelCatalog}
        modelCatalogLoading={isModelCatalogLoading}
        txt2img={txt2img}
        img2img={img2img}
        isGenerating={isGenerating}
        onRefreshModelCatalog={() => {
          void loadModelCatalog();
        }}
        onTxt2ImgChange={updateTxt2Img}
        onImg2ImgChange={updateImg2Img}
      />
    );
  }
);

const GenerationPreviewPanelContainer = memo(function GenerationPreviewPanelContainer({
  isWorkflowLoading,
  onGenerate,
  onOpenWorkflow
}: {
  isWorkflowLoading: boolean;
  onGenerate: () => void;
  onOpenWorkflow: () => void;
}) {
  const {
    history,
    isGenerating,
    interruptGeneration,
    generateForever,
    setGenerateForever
  } = useImageGenerationStore(
    useShallow((state) => ({
      history: state.history,
      isGenerating: state.isGenerating,
      interruptGeneration: state.interruptGeneration,
      generateForever: state.generateForever,
      setGenerateForever: state.setGenerateForever
    }))
  );

  return (
    <GenerationPreviewPanel
      history={history}
      isGenerating={isGenerating}
      isWorkflowLoading={isWorkflowLoading}
      onGenerate={onGenerate}
      onInterrupt={() => {
        void interruptGeneration();
      }}
      onOpenWorkflow={onOpenWorkflow}
      generateForever={generateForever}
      onGenerateForeverChange={setGenerateForever}
    />
  );
});

