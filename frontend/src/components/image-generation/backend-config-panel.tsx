import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ComfyUIConfig } from '@/types/image-generation';
import {
  Cpu,
  Folder,
  Play,
  RotateCcw,
  ScrollText,
  Square,
  Terminal
} from 'lucide-react';

import { useState } from 'react';

interface BackendConfigPanelProps {
  comfyUI: ComfyUIConfig;
  onComfyUIChange: (patch: Partial<ComfyUIConfig>) => void;
}

export function BackendConfigPanel({
  comfyUI,
  onComfyUIChange
}: BackendConfigPanelProps) {
  const [isRunning, setIsRunning] = useState(true);
  return (
    <div className="space-y-6">
      {/* Backend Status Card */}
      <section className="rounded-2xl border border-border/50 bg-card/50 p-5 shadow-sm backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Cpu className="size-4 text-primary" />
              Embedded ComfyUI
            </h3>
            <p className="text-xs text-muted-foreground">
              Manage your local generation engine
            </p>
          </div>
          {isRunning ? (
            <Badge
              variant="outline"
              className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 gap-1.5 px-2 py-0.5"
            >
              <div className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Running
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="bg-muted text-muted-foreground border-border gap-1.5 px-2 py-0.5"
            >
              <div className="size-1.5 rounded-full bg-muted-foreground/40" />
              Stopped
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {/* Start/Stop Toggle Button */}
          {isRunning ? (
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-2 text-xs font-medium text-destructive hover:bg-destructive/10 px-2"
              onClick={() => setIsRunning(false)}
            >
              <Square className="size-3.5 fill-current" />
              Stop
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-2 text-xs font-medium px-2"
              onClick={() => setIsRunning(true)}
            >
              <Play className="size-3.5 fill-current" />
              Start
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2 text-xs font-medium px-2"
            disabled={!isRunning}
          >
            <RotateCcw className="size-3.5" />
            Restart
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2 text-xs font-medium px-2"
          >
            <ScrollText className="size-3.5" />
            Logs
          </Button>
        </div>
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
              placeholder="--listen 127.0.0.1 --port 7180 --normalvram --preview-method-auto --use-pytorch-cross-attention --enable-manager"
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
        </div>
      </div>
    </div>
  );
}
