import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  ComfyUIConfig,
  ImageGenerationBackend,
  ImageGenerationMode
} from '@/types/image-generation';
import { Clock3, Eraser, SlidersHorizontal, WandSparkles } from 'lucide-react';

interface GenerationSecondaryPanelProps {
  activeBackend: ImageGenerationBackend;
  mode: ImageGenerationMode;
  historyCount: number;
  comfyUI: ComfyUIConfig;
  onGenerate: () => void;
  onOpenConfig: () => void;
  onClearHistory: () => void;
}

export function GenerationSecondaryPanel({
  activeBackend,
  mode,
  historyCount,
  onGenerate,
  onOpenConfig,
  onClearHistory
}: GenerationSecondaryPanelProps) {
  return (
    <Card className="bg-card/90">
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">Generation Controls</CardTitle>
        <CardDescription>
          Secondary actions and runtime context for the current generation
          session.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{activeBackend}</Badge>
          <Badge variant="outline">{mode}</Badge>
          <Badge variant="outline">{historyCount} result(s)</Badge>
        </div>

        {activeBackend === 'comfyui' && (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Selected Workflow</p>
          </div>
        )}

        <div className="space-y-2">
          <Button onClick={onGenerate} className="w-full gap-2">
            <WandSparkles className="size-4" />
            Generate
          </Button>

          <Button
            variant="outline"
            onClick={onOpenConfig}
            className="w-full gap-2"
          >
            <SlidersHorizontal className="size-4" />
            Backend Configuration
          </Button>
        </div>

        <Separator />

        <div className="space-y-2">
          <Button
            variant="ghost"
            onClick={onClearHistory}
            disabled={historyCount === 0}
            className="w-full justify-start gap-2 text-muted-foreground"
          >
            <Eraser className="size-4" />
            Clear Preview History
          </Button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" />
            Placeholder execution only. API wiring can be connected later.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
