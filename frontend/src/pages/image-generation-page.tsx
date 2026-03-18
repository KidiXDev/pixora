import { BackendConfigDrawer } from '@/components/image-generation/backend-config-drawer';
import { GenerationParametersPanel } from '@/components/image-generation/generation-parameters-panel';
import { GenerationPreviewPanel } from '@/components/image-generation/generation-preview-panel';
import { GenerationSideNav } from '@/components/image-generation/generation-side-nav';
import { useImageGenerationStore } from '@/stores/image-generation-store';
import { useState } from 'react';

export default function ImageGenerationPage() {
  const [isConfigSheetOpen, setIsConfigSheetOpen] = useState(false);
  const {
    mode,
    comfyUI,
    txt2img,
    img2img,
    history,
    setMode,
    updateComfyUIConfig,
    updateTxt2Img,
    updateImg2Img,
    generatePreviewPlaceholder
  } = useImageGenerationStore();

  return (
    <div className="flex h-full overflow-hidden bg-[radial-gradient(ellipse_at_top_right,var(--tw-gradient-stops))] from-primary/5 via-background to-background">
      <GenerationSideNav
        mode={mode}
        onModeChange={setMode}
        onOpenSettings={() => setIsConfigSheetOpen(true)}
      />

      <main className="flex-1 flex min-w-0 overflow-hidden">
        <div className="flex-1 flex gap-8 p-6 lg:p-8 min-w-0 overflow-hidden">
          <aside className="w-[400px] shrink-0 overflow-y-auto overflow-x-hidden pr-4">
            <GenerationParametersPanel
              mode={mode}
              txt2img={txt2img}
              img2img={img2img}
              onTxt2ImgChange={updateTxt2Img}
              onImg2ImgChange={updateImg2Img}
              onGenerate={generatePreviewPlaceholder}
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
        onComfyUIChange={updateComfyUIConfig}
      />
    </div>
  );
}
