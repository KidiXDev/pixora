import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { GeneratedPreviewItem } from '@/types/image-generation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  GitBranch,
  Image as ImageIcon,
  Square,
  WandSparkles,
  X
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

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

function buildImageURL(imagePath: string, cacheKey?: string): string {
  if (imagePath.startsWith('data:image/')) {
    return imagePath;
  }

  const encoded = encodeURIComponent(imagePath);
  if (!cacheKey || cacheKey.trim() === '') {
    return `/image/?path=${encoded}`;
  }

  return `/image/?path=${encoded}&v=${encodeURIComponent(cacheKey)}`;
}

function formatDuration(start: string, end?: string): string {
  if (!start) return '0.0s';
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  const diff = Math.max(0, (endTime - startTime) / 1000);
  return diff.toFixed(1) + 's';
}

function GenerationPreviewPanelBase({
  history,
  isGenerating,
  isWorkflowLoading = false,
  onGenerate,
  onInterrupt,
  onOpenWorkflow
}: GenerationPreviewPanelProps) {
  const latest = history[0] ?? null;
  const hasImage = !!latest?.imagePath;
  const showLoading = isGenerating && !hasImage;
  const [isFullPreviewOpen, setIsFullPreviewOpen] = useState(false);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (isFullPreviewOpen) {
      setScale(1);
    }
  }, [isFullPreviewOpen]);

  const handleWheel = (e: React.WheelEvent) => {
    if (!isFullPreviewOpen) return;
    const delta = -e.deltaY * 0.001;
    setScale((s) => Math.min(Math.max(s + delta, 0.5), 20));
  };
  const latestImageURL = useMemo(
    () => {
      if (!latest?.imagePath) {
        return '';
      }

      const cacheKey = [
        latest.status || '',
        latest.message || '',
        latest.completedAtISO || '',
        latest.createdAtISO || '',
        latest.promptId || ''
      ].join('|');

      return buildImageURL(latest.imagePath, cacheKey);
    },
    [
      latest?.imagePath,
      latest?.status,
      latest?.message,
      latest?.completedAtISO,
      latest?.createdAtISO,
      latest?.promptId
    ]
  );
  const canOpenFullscreen = latest?.status === 'completed';

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
                  <WandSparkles className="size-3.5 transition-transform duration-300 group-hover:rotate-12" />
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
            <AnimatePresence mode="wait">
              {showLoading ? (
                <motion.div
                  key="generating"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="absolute inset-0 z-20 flex flex-col items-center justify-center p-8 bg-black/40 backdrop-blur-md rounded-2xl"
                >
                  <div className="relative">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{
                        duration: 3,
                        repeat: Infinity,
                        ease: 'linear'
                      }}
                      className="size-32 rounded-full border-t-2 border-r-2 border-primary shadow-[0_0_20px_rgba(var(--primary),0.3)]"
                    />
                    <motion.div
                      animate={{ scale: [1, 1.1, 1], rotate: [-10, 10, -10] }}
                      transition={{
                        duration: 4,
                        repeat: Infinity,
                        ease: 'easeInOut'
                      }}
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <div className="size-16 rounded-2xl bg-primary/20 backdrop-blur-xl border border-primary/40 flex items-center justify-center shadow-2xl">
                        <WandSparkles className="size-8 text-primary" />
                      </div>
                    </motion.div>
                  </div>

                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-8 text-center space-y-2"
                  >
                    <motion.h3
                      animate={{ opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="text-lg font-black text-white tracking-[0.2em] uppercase"
                    >
                      Imagining...
                    </motion.h3>
                    <p className="text-xs text-primary/70 font-medium animate-pulse">
                      {latest?.message || 'Processing workflow steps'}
                    </p>
                  </motion.div>
                </motion.div>
              ) : hasImage ? (
                <motion.div
                  key={latest.id} // STABLE KEY: Prevents looping animation on live updates
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className={cn(
                    'absolute inset-0 flex items-center justify-center overflow-hidden rounded-2xl group/img cursor-pointer'
                  )}
                  onClick={() => {
                    if (canOpenFullscreen) {
                      setIsFullPreviewOpen(true);
                    }
                  }}
                >
                  <motion.img
                    src={latestImageURL}
                    alt="Generated result"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="h-full w-full object-contain bg-black/35 transition-all duration-300"
                  />
                  {/* Subtle vignette/glow over the image */}
                  <div className="absolute inset-0 pointer-events-none bg-radial-vignette opacity-50 rounded-2xl" />
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex flex-col items-center justify-center p-8 z-10 rounded-2xl"
                >
                  <div className="text-center space-y-4 opacity-30 transform transition-all duration-500">
                    <div className="size-20 mx-auto rounded-3xl bg-linear-to-br from-white/10 to-transparent flex items-center justify-center ring-1 ring-white/20">
                      <ImageIcon className="size-10 text-white" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-base font-bold text-white tracking-wide">
                        Empty Canvas
                      </p>
                      <p className="text-xs text-white/60">
                        Generate an image to view result
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Metadata / Prompt Overlay - Always visible but contents change */}
            <div className="mt-auto bg-linear-to-t from-black/95 via-black/60 to-transparent p-6 relative z-30 transition-all duration-300 transform rounded-b-2xl">
              <AnimatePresence mode="wait">
                {latest ? (
                  <motion.div
                    key="metadata"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-4"
                  >
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex flex-wrap items-center gap-y-2 gap-x-5 text-[10px] text-white/50 font-bold uppercase tracking-wider w-full">
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
                          <span className="text-white/30 text-[9px]">
                            Steps
                          </span>
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

                        {/* Time Elapsed / Generation Time */}
                        <div className="flex items-center gap-1.5 ml-auto">
                          <span className="text-white/30 text-[9px]">Time</span>
                          <span className="font-mono text-primary">
                            <ElapsedTime
                              start={latest.createdAtISO}
                              end={latest.completedAtISO}
                              isLive={
                                isGenerating ||
                                (!latest.completedAtISO &&
                                  latest.status === 'running')
                              }
                            />
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="ready"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-2 text-white/30 italic text-xs font-semibold"
                  >
                    <span className="size-1 rounded-full bg-white/20 animate-pulse" />
                    Ready for generation
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </section>
      </CardContent>

      {/* Full Screen Preview Overlay (Portaled) */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {isFullPreviewOpen && latest?.imagePath && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onWheel={handleWheel}
                className="fixed inset-0 z-100 bg-black/95 backdrop-blur-2xl flex items-center justify-center cursor-default"
                onClick={() => setIsFullPreviewOpen(false)}
              >
                <div className="absolute inset-0 z-0 overflow-hidden flex items-center justify-center p-12">
                  <motion.div
                    drag={scale > 1}
                    dragMomentum={false}
                  initial={{ opacity: 0 }}
                  animate={{ scale, opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{
                    type: 'spring',
                    damping: 30,
                    stiffness: 450,
                    scale: { duration: 0.15 }
                  }}
                    className={cn(
                      'relative flex items-center justify-center',
                      scale > 1 ? 'cursor-move' : 'cursor-default'
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <img
                      src={latestImageURL}
                      alt="Full screen preview"
                      className="max-w-[85vw] max-h-[85vh] object-contain shadow-[0_0_100px_rgba(0,0,0,0.8)] rounded-xl ring-1 ring-white/10 select-none"
                      draggable={false}
                    />

                    {/* Floating Action Hint */}
                    {scale === 1 && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="absolute -bottom-10 flex items-center gap-2 text-[9px] text-white/30 uppercase tracking-widest font-bold"
                      >
                        <span>Scroll to Zoom</span>
                      </motion.div>
                    )}
                  </motion.div>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-8 right-8 text-white/50 hover:text-white hover:bg-white/10 z-50 rounded-full border border-white/10 size-12 shadow-2xl"
                  onClick={() => setIsFullPreviewOpen(false)}
                >
                  <X className="size-6" />
                </Button>

                {/* Quick Info Overlay */}
                <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center justify-center gap-6 text-[10px] text-white/40 font-bold uppercase tracking-widest bg-black/40 backdrop-blur-md py-3 px-8 rounded-full border border-white/5 z-50 shadow-2xl">
                  <div className="flex items-center gap-2">
                    <span className="text-white/20">Resolution:</span>
                    <span className="text-white/70">
                      {resolutionLabel(
                        latest.resolution.width,
                        latest.resolution.height
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-white/20">Seed:</span>
                    <span className="text-white/70">{latest.seed}</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </Card>
  );
}

const ElapsedTime = React.memo(function ElapsedTime({
  start,
  end,
  isLive
}: {
  start: string;
  end?: string;
  isLive: boolean;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isLive) {
      return;
    }

    const interval = window.setInterval(() => {
      setTick((value) => value + 1);
    }, 250);

    return () => window.clearInterval(interval);
  }, [isLive]);

  return <>{formatDuration(start, end)}</>;
});

export const GenerationPreviewPanel = React.memo(GenerationPreviewPanelBase);
