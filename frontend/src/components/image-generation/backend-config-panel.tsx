import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ComfyUIConfig, ComfyUIStatus } from '@/types/image-generation';
import {
  Cpu,
  Folder,
  LoaderCircle,
  Play,
  RotateCcw,
  Save,
  ScrollText,
  Square,
  Terminal
} from 'lucide-react';

interface BackendConfigPanelProps {
  comfyUI: ComfyUIConfig;
  status: ComfyUIStatus;
  isActionPending: boolean;
  isConfigSaving: boolean;
  errorMessage: string;
  onComfyUIChange: (patch: Partial<ComfyUIConfig>) => void;
  onSaveConfig: () => Promise<void>;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onRestart: () => Promise<void>;
  onLogsClick: () => void;
}

export function BackendConfigPanel({
  comfyUI,
  status,
  isActionPending,
  isConfigSaving,
  errorMessage,
  onComfyUIChange,
  onSaveConfig,
  onStart,
  onStop,
  onRestart,
  onLogsClick
}: BackendConfigPanelProps) {
  const isRunning = status.state === 'running';
  const isStarting = status.state === 'starting';
  const isStopping = status.state === 'stopping';
  const isError = status.state === 'error';
  const isBusy = isActionPending || isStarting || isStopping;

  const badge = (() => {
    if (isRunning) {
      return {
        label: 'Running',
        className:
          'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 gap-1.5 px-2 py-0.5'
      };
    }
    if (isStarting) {
      return {
        label: 'Starting',
        className:
          'bg-amber-500/10 text-amber-600 border-amber-500/20 gap-1.5 px-2 py-0.5'
      };
    }
    if (isStopping) {
      return {
        label: 'Stopping',
        className:
          'bg-orange-500/10 text-orange-600 border-orange-500/20 gap-1.5 px-2 py-0.5'
      };
    }
    if (isError) {
      return {
        label: 'Error',
        className:
          'bg-destructive/10 text-destructive border-destructive/30 gap-1.5 px-2 py-0.5'
      };
    }
    return {
      label: 'Stopped',
      className:
        'bg-muted text-muted-foreground border-border gap-1.5 px-2 py-0.5'
    };
  })();

  return (
    <div className="space-y-6">
      {/* Backend Status Card */}
      <section className="rounded-2xl border border-border/50 bg-card/50 p-5 shadow-sm backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Cpu className="size-4 text-primary" />
              Comfy Engine
            </h3>
          </div>
          <Badge variant="outline" className={badge.className}>
            <div
              className={`size-1.5 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : isStarting || isStopping ? 'bg-amber-500 animate-pulse' : isError ? 'bg-destructive' : 'bg-muted-foreground/40'}`}
            />
            {badge.label}
          </Badge>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {/* Start/Stop Toggle Button */}
          {isRunning ? (
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-2 text-xs font-medium text-destructive hover:bg-destructive/10 px-2"
              onClick={onStop}
              disabled={isBusy}
            >
              {isBusy ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Square className="size-3.5 fill-current" />
              )}
              {isStopping ? 'Stopping...' : isBusy ? 'Working...' : 'Stop'}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-2 text-xs font-medium px-2"
              onClick={onStart}
              disabled={isBusy}
            >
              {isBusy ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5 fill-current" />
              )}
              {isStarting ? 'Starting...' : isBusy ? 'Working...' : 'Start'}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2 text-xs font-medium px-2"
            disabled={!isRunning || isBusy}
            onClick={onRestart}
          >
            <RotateCcw className="size-3.5" />
            Restart
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2 text-xs font-medium px-2"
            onClick={onLogsClick}
          >
            <ScrollText className="size-3.5" />
            Logs
          </Button>
        </div>

        {errorMessage ? (
          <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
            {errorMessage}
          </p>
        ) : null}
        {!errorMessage && status.statusMessage ? (
          <p className="mt-3 rounded-md border border-border/50 bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
            {status.statusMessage}
          </p>
        ) : null}
      </section>

      <Separator className="opacity-50" />

      {/* Operational Settings */}
      <div className="space-y-4 pt-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70 px-1">
          Operational Settings
        </h4>

        <div className="space-y-4">
          <div className="space-y-1.5 px-1">
            <Label className="text-xs font-medium opacity-80 flex items-center gap-2">
              <Terminal className="size-3.5" />
              Launch Arguments
            </Label>
            <Input
              value={comfyUI.args}
              onChange={(e) => onComfyUIChange({ args: e.target.value })}
              className="h-10 bg-background/50 border-border/60 focus:border-primary/50 transition-all font-mono text-[13px]"
              placeholder="--listen 127.0.0.1 --port 7180 --normalvram --preview-method auto --use-pytorch-cross-attention --enable-manager"
            />
            <p className="text-[10px] text-muted-foreground mt-1 px-1">
              Custom CLI arguments passed to the ComfyUI process on startup.
            </p>
          </div>

          <div className="space-y-1.5 px-1">
            <Label className="text-xs font-medium opacity-80 flex items-center gap-2">
              <Folder className="size-3.5" />
              Output Directory
            </Label>
            <div className="flex gap-2">
              <Input
                value={comfyUI.outputDir}
                onChange={(e) => onComfyUIChange({ outputDir: e.target.value })}
                className="h-10 grow bg-background/50 border-border/60 focus:border-primary/50 transition-all text-[13px]"
                placeholder="Relative to app or absolute path"
              />
              <Button
                variant="secondary"
                size="icon"
                className="h-10 w-10 shrink-0 border border-border/60"
              >
                <Folder className="size-4" />
              </Button>
            </div>
          </div>

          <div className="px-1">
            <Button
              variant="secondary"
              className="h-9 gap-2 text-xs font-medium"
              disabled={isConfigSaving}
              onClick={onSaveConfig}
            >
              {isConfigSaving ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Save Configuration
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
