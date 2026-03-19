import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { ComfyUILogEntry, ComfyUISetupStatus } from '@/types/image-generation';
import { AlertTriangle, CheckCircle2, Terminal } from 'lucide-react';
import { useMemo, useState } from 'react';

interface ComfyUISetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setup: ComfyUISetupStatus;
  logs: ComfyUILogEntry[];
  isInstalling: boolean;
  onRefresh: () => void;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  if (size >= 10 || unitIndex === 0) {
    return `${Math.round(size)} ${units[unitIndex]}`;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function formatDownloadSize(downloaded: number, total: number): string {
  const downloadedLabel = formatBytes(downloaded);
  if (!Number.isFinite(total) || total <= 0) {
    return downloadedLabel;
  }
  return `${downloadedLabel} / ${formatBytes(total)}`;
}

function formatProgress(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0%';
  }
  return `${Math.min(100, Math.max(0, value)).toFixed(1)}%`;
}

export function ComfyUISetupDialog({
  open,
  onOpenChange,
  setup,
  logs,
  isInstalling,
  onRefresh
}: ComfyUISetupDialogProps) {
  const [verbose, setVerbose] = useState(false);
  const latestLogs = useMemo(() => logs.slice(-300), [logs]);
  const isDownloadRunning = useMemo(
    () =>
      setup.steps.some(
        (step) =>
          step.id === 'download_archive' && step.status === 'running'
      ),
    [setup.steps]
  );
  const dialogDescription = isDownloadRunning
    ? 'Installing ComfyUI...'
    : setup.statusMessage || 'Preparing ComfyUI setup status...';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="min-w-[min(90vw,760px)] gap-4 p-0"
        showCloseButton={!isInstalling}
        onInteractOutside={(event) => {
          if (isInstalling) {
            event.preventDefault();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (isInstalling) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader className="border-b border-border/60 px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            {setup.state === 'ready' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : setup.state === 'error' ? (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            ) : null}
            ComfyUI Setup
          </DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 pb-6">
          {!isDownloadRunning && (
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Current Step
                </p>
                {isInstalling && (
                  <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <Spinner className="h-3.5 w-3.5" />
                    In progress
                  </div>
                )}
              </div>
              <p className="mt-1 text-sm font-medium text-foreground">
                {setup.currentStepMessage ||
                  setup.statusMessage ||
                  'Waiting for setup activity...'}
              </p>
            </div>
          )}

          {isDownloadRunning && isInstalling && (
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <p className="text-sm font-medium text-foreground">Download</p>
              <Progress
                value={Math.max(0, Math.min(100, setup.downloadProgress || 0))}
                className="mt-3 h-2"
              />
              <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                <p>
                  Progress:{' '}
                  <span className="text-foreground">
                    {formatProgress(setup.downloadProgress)}
                  </span>
                </p>
                <p>
                  Size:{' '}
                  <span className="text-foreground">
                    {formatDownloadSize(
                      setup.downloadedBytes,
                      setup.totalBytes
                    )}
                  </span>
                </p>
                <p>
                  Speed:{' '}
                  <span className="text-foreground">
                    {formatBytes(setup.downloadSpeed)}/s
                  </span>
                </p>
              </div>
            </div>
          )}

          {(setup.lastError || setup.permissionMessage) && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
              <p className="text-sm font-medium text-destructive">
                Setup failed
              </p>
              <p className="mt-2 text-sm text-foreground">
                {setup.permissionMessage || setup.lastError}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setVerbose((current) => !current)}
            >
              <Terminal className="mr-2 h-4 w-4" />
              {verbose ? 'Hide verbose' : 'Verbose'}
            </Button>
            <Button type="button" variant="secondary" onClick={onRefresh}>
              Refresh
            </Button>
          </div>

          {verbose && (
            <div className="rounded-lg border border-border/60 bg-zinc-950">
              <div className="border-b border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-300">
                Setup Logs
              </div>
              <div className="max-h-56 overflow-auto px-3 py-2 font-mono text-xs leading-5 text-zinc-200">
                {latestLogs.length === 0 ? (
                  <p className="text-zinc-500">No log output yet.</p>
                ) : (
                  latestLogs.map((entry, index) => (
                    <p key={`${entry.timestamp}-${index.toString()}`}>
                      <span className="text-zinc-500">
                        [{entry.timestamp || '--:--:--'}]
                      </span>{' '}
                      <span className="text-emerald-300">
                        {entry.level?.toUpperCase() || 'INFO'}
                      </span>{' '}
                      <span className="text-cyan-300">
                        {entry.stream || 'system'}
                      </span>{' '}
                      {entry.message}
                    </p>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
