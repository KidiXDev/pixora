import { BackendConfigDrawer } from '@/components/image-generation/backend-config-drawer';
import { ComfyUILogsDialog } from '@/components/image-generation/comfyui-logs-dialog';
import { GenerationParametersPanel } from '@/components/image-generation/generation-parameters-panel';
import { GenerationPreviewPanel } from '@/components/image-generation/generation-preview-panel';
import { GenerationSideNav } from '@/components/image-generation/generation-side-nav';
import { useImageGenerationStore } from '@/stores/image-generation-store';
import { useEffect, useState } from 'react';

export default function ImageGenerationPage() {
  const [isConfigSheetOpen, setIsConfigSheetOpen] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const {
    mode,
    comfyUI,
    comfyStatus,
    modelCatalog,
    comfyLogs,
    comfyError,
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

  return (
    <div className="flex h-full overflow-hidden bg-[radial-gradient(ellipse_at_top_right,var(--tw-gradient-stops))] from-primary/5 via-background to-background">
      <GenerationSideNav
        mode={mode}
        onModeChange={setMode}
        onOpenSettings={() => setIsConfigSheetOpen(true)}
      />

      <main className="flex-1 flex min-w-0 overflow-hidden">
        <div className="flex-1 flex gap-8 p-6 lg:p-8 min-w-0 overflow-hidden">
          <aside className="w-100 shrink-0 overflow-y-auto overflow-x-hidden pr-4">
            <GenerationParametersPanel
              mode={mode}
              modelCatalog={modelCatalog}
              modelCatalogLoading={isModelCatalogLoading}
              txt2img={txt2img}
              img2img={img2img}
              isGenerating={isGenerating}
              onTxt2ImgChange={updateTxt2Img}
              onImg2ImgChange={updateImg2Img}
              onGenerate={() => {
                void generateText2Image();
              }}
              onInterrupt={() => {
                void interruptGeneration();
              }}
            />
          </aside>

          <div className="flex-1 min-w-0 h-full">
            <GenerationPreviewPanel history={history} />
          </div>
        </div>
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
