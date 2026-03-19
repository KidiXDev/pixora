import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ComfyUILogEntry, ComfyUIStatus } from '@/types/image-generation';
import { LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface ComfyUILogsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  logs: ComfyUILogEntry[];
  status: ComfyUIStatus;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onClear: () => Promise<void>;
}

function resolveLevelClass(level: string): string {
  const normalized = level.toLowerCase();
  if (normalized === 'error') {
    return 'bg-destructive/15 text-destructive border-destructive/30';
  }
  if (normalized === 'warn' || normalized === 'warning') {
    return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';
  }
  return 'bg-muted text-muted-foreground border-border';
}

export function ComfyUILogsDialog({
  open,
  onOpenChange,
  logs,
  status,
  isLoading,
  onRefresh,
  onClear
}: ComfyUILogsDialogProps) {
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [isAutoScrollDisabledByUser, setIsAutoScrollDisabledByUser] =
    useState(false);
  const [isRawMode, setIsRawMode] = useState(false);

  const isAutoScrollEnabled = !isAutoScrollDisabledByUser && isNearBottom;

  useEffect(() => {
    if (!open) {
      setIsNearBottom(true);
      setIsAutoScrollDisabledByUser(false);
      return;
    }

    const viewport = scrollRootRef.current?.querySelector<HTMLDivElement>(
      '[data-slot="scroll-area-viewport"]'
    );
    if (!viewport) {
      return;
    }

    const updateAutoScrollState = () => {
      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      setIsNearBottom(distanceFromBottom <= 24);
    };

    viewport.addEventListener('scroll', updateAutoScrollState, {
      passive: true
    });
    updateAutoScrollState();

    return () => {
      viewport.removeEventListener('scroll', updateAutoScrollState);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !isAutoScrollEnabled) {
      return;
    }

    const viewport = scrollRootRef.current?.querySelector<HTMLDivElement>(
      '[data-slot="scroll-area-viewport"]'
    );
    if (!viewport) {
      return;
    }

    viewport.scrollTop = viewport.scrollHeight;
  }, [logs, open, isAutoScrollEnabled]);

  const handleAutoScrollToggle = () => {
    const nextDisabledState = !isAutoScrollDisabledByUser;
    setIsAutoScrollDisabledByUser(nextDisabledState);

    if (!nextDisabledState) {
      const viewport = scrollRootRef.current?.querySelector<HTMLDivElement>(
        '[data-slot="scroll-area-viewport"]'
      );
      if (!viewport) {
        return;
      }

      viewport.scrollTop = viewport.scrollHeight;
      setIsNearBottom(true);
    }
  };

  const handleRawModeToggle = () => {
    setIsRawMode((current) => !current);
  };

  function buildStatusBadgeColor(status: ComfyUIStatus) {
    if (status.state === 'running') {
      return 'bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30 text-[11px] uppercase tracking-wide';
    }
    if (status.state === 'starting') {
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[11px] uppercase tracking-wide';
    }
    if (status.state === 'stopping') {
      return 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30 text-[11px] uppercase tracking-wide';
    }
    if (status.state === 'error') {
      return 'bg-destructive/15 text-destructive border-destructive/30 text-[11px] uppercase tracking-wide';
    }
    if (status.state === 'stopped') {
      return 'bg-muted text-muted-foreground border-border text-[11px] uppercase tracking-wide';
    }
    return 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30 text-[11px] uppercase tracking-wide';
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-4xl gap-4 p-0">
        <DialogHeader className="border-b border-border/60 px-6 pt-6 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <DialogTitle className="text-base font-semibold">
                ComfyUI Engine Logs
              </DialogTitle>
              <DialogDescription>
                Live output from the embedded ComfyUI process.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 px-6 pb-6">
          <div className="flex items-center justify-between gap-3">
            <Badge variant="outline" className={buildStatusBadgeColor(status)}>
              {status.state}
            </Badge>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={onRefresh}
                disabled={isLoading}
              >
                {isLoading ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={onClear}
                disabled={logs.length === 0}
              >
                <Trash2 className="size-3.5" />
                Clear
              </Button>
              <Button
                variant={isAutoScrollDisabledByUser ? 'outline' : 'secondary'}
                size="sm"
                className="h-8 text-xs"
                onClick={handleAutoScrollToggle}
              >
                {isAutoScrollDisabledByUser
                  ? 'Auto-scroll off'
                  : isNearBottom
                    ? 'Auto-scroll on'
                    : 'Auto-scroll paused'}
              </Button>
              <Button
                variant={isRawMode ? 'secondary' : 'outline'}
                size="sm"
                className="h-8 text-xs"
                onClick={handleRawModeToggle}
              >
                {isRawMode ? 'Raw mode on' : 'Raw mode off'}
              </Button>
            </div>
          </div>

          <div ref={scrollRootRef}>
            <ScrollArea className="h-105 rounded-lg border border-border/60 bg-muted/20 p-3">
              {logs.length === 0 ? (
                <div className="flex h-90 items-center justify-center text-sm text-muted-foreground">
                  No log output yet.
                </div>
              ) : isRawMode ? (
                <div className="rounded-md border border-border/50 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-100">
                  {logs.map((entry, index) => (
                    <p
                      key={`${entry.timestamp}-${entry.stream}-${index.toString()}`}
                      className="wrap-break-word whitespace-pre-wrap"
                    >
                      <span className="text-zinc-400">
                        [{entry.timestamp || '-'}]
                      </span>{' '}
                      <span className="text-zinc-500">
                        ({entry.stream || 'stdout'})
                      </span>{' '}
                      <span>{entry.message}</span>
                    </p>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {logs.map((entry, index) => (
                    <div
                      key={`${entry.timestamp}-${entry.stream}-${index.toString()}`}
                      className="rounded-md border border-border/50 bg-background/70 px-3 py-2"
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
                        <Badge
                          variant="outline"
                          className={resolveLevelClass(entry.level)}
                        >
                          {entry.level || 'info'}
                        </Badge>
                        <span className="font-mono text-muted-foreground">
                          {entry.timestamp || '-'}
                        </span>
                        <span className="font-mono text-muted-foreground/80">
                          {entry.stream || 'stdout'}
                        </span>
                      </div>
                      <p className="wrap-break-word whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/90">
                        {entry.message}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
