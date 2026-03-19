import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GeneratedPreviewItem } from '@/types/image-generation';
import { GitBranch, Image as ImageIcon, Square, WandSparkles } from 'lucide-react';

interface GenerationPreviewPanelProps {
  history: ReadonlyArray<GeneratedPreviewItem>;
  isGenerating: boolean;
  isWorkflowLoading?: boolean;
  onGenerate: () => void;
  onInterrupt: () => void;
  onOpenWorkflow: () => void;
}

function resolutionLabel(width: number, height: number): string {
  return `${width}x${height}`;
}

function buildImageURL(imagePath: string): string {
  if (imagePath.startsWith('data:image/')) {
    return imagePath;
  }

  const encoded = encodeURIComponent(imagePath);
  return `/image/?path=${encoded}`;
}

export function GenerationPreviewPanel({
  history,
  isGenerating,
  isWorkflowLoading = false,
  onGenerate,
  onInterrupt,
  onOpenWorkflow
}: GenerationPreviewPanelProps) {
  const latest = history[0] ?? null;

  return (
    <Card className="h-full bg-card/40 backdrop-blur-xl border-border/50 shadow-2xl overflow-hidden group flex flex-col">
      <div className="absolute inset-0 bg-linear-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
      <CardHeader className="space-y-1 py-4 border-b border-border/40 relative">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg font-bold tracking-tight">
            Preview Output
          </CardTitle>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={onOpenWorkflow}
              disabled={isWorkflowLoading}
              className="gap-2 h-10 px-4 text-xs font-semibold"
            >
              <GitBranch className="size-3.5" />
              {isWorkflowLoading ? 'Loading...' : 'View Workflow'}
            </Button>
            <Button
              onClick={() => {
                if (isGenerating) {
                  onInterrupt();
                } else {
                  onGenerate();
                }
              }}
              className="gap-2 h-10 px-6 text-xs font-bold shadow-xl shadow-primary/20 bg-linear-to-r from-primary via-primary to-primary/80 active:scale-[0.98] transition-all duration-300 rounded-lg group/btn"
            >
              {isGenerating ? (
                <>
                  <Square className="size-3.5 fill-current" />
                  Interrupt
                </>
              ) : (
                <>
                  <WandSparkles className="size-3.5 transition-transform duration-300" />
                  Generate
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6 relative flex-1 flex flex-col min-h-0 overflow-hidden">
        <section className="flex-1 w-full rounded-2xl border border-border/50 overflow-hidden bg-background/20 relative group/preview shadow-inner">
          {/* Result Gradient Placeholder / Image Display Area */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(14,165,233,0.4),transparent_40%),radial-gradient(circle_at_85%_20%,rgba(234,179,8,0.35),transparent_45%),radial-gradient(circle_at_45%_80%,rgba(16,185,129,0.3),transparent_50%),linear-gradient(160deg,rgba(2,6,23,1),rgba(30,41,59,0.95))] flex flex-col">
            {latest?.imagePath ? (
              <img
                src={buildImageURL(latest.imagePath)}
                alt="Generated result"
                className="absolute inset-0 h-full w-full object-contain bg-black/35"
              />
            ) : null}

            <div className="flex-1 flex items-center justify-center p-8">
              {!latest?.imagePath && (
                <div className="text-center space-y-4 opacity-30 transform transition-all duration-500">
                  <div className="size-20 mx-auto rounded-3xl bg-linear-to-br from-white/10 to-transparent flex items-center justify-center ring-1 ring-white/20">
                    <ImageIcon className="size-10 text-white" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-base font-bold text-white tracking-wide">
                      {latest?.isGenerating ? 'Generating...' : 'Empty Canvas'}
                    </p>
                    <p className="text-xs text-white/60">
                      {latest?.message || 'Generate an image to view result'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Metadata / Prompt Overlay */}
            <div className="bg-linear-to-t from-black/95 via-black/60 to-transparent p-6 relative z-10 transition-all duration-500 transform">
              {latest ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex flex-wrap items-center gap-y-2 gap-x-5 text-[10px] text-white/50 font-bold uppercase tracking-wider">
                      <div className="flex items-center gap-1.5">
                        <span className="text-white/30 text-[9px]">Res</span>
                        <span className="text-white/80 font-mono">
                          {resolutionLabel(
                            latest.resolution.width,
                            latest.resolution.height
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-white/30 text-[9px]">Steps</span>
                        <span className="text-white/80 font-mono">
                          {latest.steps}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-white/30 text-[9px]">CFG</span>
                        <span className="text-white/80 font-mono">
                          {latest.cfgScale}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-white/30 text-[9px]">Seed</span>
                        <span className="text-white/80 font-mono">
                          {latest.seed ?? 'Random'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-white/30 italic text-xs font-semibold">
                  <span className="size-1 rounded-full bg-white/20 animate-pulse" />
                  Ready for generation
                </div>
              )}
            </div>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
