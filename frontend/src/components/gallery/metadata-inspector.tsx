import { Button } from '@/components/ui/button';
import { useGalleryStore } from '@/stores/gallery-store';
import { Check, Copy, ExternalLink, FolderOpen, X } from 'lucide-react';
import { useState } from 'react';
import {
  OpenExternally,
  ShowInFolder
} from '../../../bindings/pixora/internal/services/galleryservice';

export function MetadataInspector() {
  const { images, selectedImageId, setSelectedImageId } = useGalleryStore();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!selectedImageId) return null;

  const image = images.find((img) => img.ID === selectedImageId);
  if (!image) return null;

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openDirectory = async () => {
    if (image.Path) {
      await ShowInFolder(image.Path).catch(console.error);
    }
  };

  const openExternal = async () => {
    await OpenExternally(image.Path).catch(console.error);
  };

  const renderPrompt = (prompt: string) => {
    if (!prompt)
      return (
        <span className="text-muted-foreground italic">No prompt data</span>
      );

    const parts = prompt.split(/(<[^>]+>|\([^)]+:\d+(?:\.\d+)?\))/g);

    return parts.map((part, i) => {
      if (part.startsWith('<') && part.endsWith('>')) {
        return (
          <span key={i} className="text-primary font-semibold">
            {part}
          </span>
        );
      }
      if (part.startsWith('(') && part.endsWith(')')) {
        return (
          <span key={i} className="text-chart-2 font-medium">
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="h-full flex flex-col p-6 overflow-y-auto custom-scrollbar">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-card-foreground">
          Generation Data
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={openExternal}
            title="Open Image Extenally"
          >
            <ExternalLink size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={openDirectory}
            title="Show in Folder"
          >
            <FolderOpen size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSelectedImageId(null)}
            title="Close Inspector"
          >
            <X size={18} />
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Prompt */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm font-medium text-muted-foreground select-none">
            <span>Prompt</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => copyToClipboard(image.Prompt, 'prompt')}
            >
              {copiedId === 'prompt' ? <Check size={12} /> : <Copy size={12} />}
            </Button>
          </div>
          <div className="text-sm bg-muted/30 p-3 rounded-lg border border-white/5 break-all font-sans leading-relaxed">
            {renderPrompt(image.Prompt)}
          </div>
        </div>

        {/* Negative Prompt */}
        {image.NegativePrompt && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-medium text-muted-foreground select-none">
              <span>Negative Prompt</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() =>
                  copyToClipboard(image.NegativePrompt, 'negative')
                }
              >
                {copiedId === 'negative' ? (
                  <Check size={12} />
                ) : (
                  <Copy size={12} />
                )}
              </Button>
            </div>
            <div className="text-sm bg-destructive/5 text-destructive-foreground/80 p-3 rounded-lg border border-destructive/10 break-all font-sans leading-relaxed">
              {image.NegativePrompt}
            </div>
          </div>
        )}

        {/* Parameters Grid */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-muted/30 p-2.5 rounded-md border border-white/5 flex flex-col">
            <span className="text-xs text-muted-foreground mb-1 select-none">
              Model
            </span>
            <span
              className="font-medium truncate"
              title={image.Model || 'Unknown'}
            >
              {image.Model || '-'}
            </span>
          </div>
          <div className="bg-muted/30 p-2.5 rounded-md border border-white/5 flex flex-col">
            <span className="text-xs text-muted-foreground mb-1 select-none">
              Sampler
            </span>
            <span className="font-medium truncate">{image.Sampler || '-'}</span>
          </div>
          <div className="bg-muted/30 p-2.5 rounded-md border border-white/5 flex flex-col">
            <span className="text-xs text-muted-foreground mb-1 select-none">
              Seed
            </span>
            <div className="flex items-center justify-between group">
              <span className="font-mono truncate">{image.Seed || '-'}</span>
              {image.Seed && (
                <button
                  onClick={() => copyToClipboard(image.Seed, 'seed')}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                >
                  {copiedId === 'seed' ? (
                    <Check size={12} />
                  ) : (
                    <Copy size={12} />
                  )}
                </button>
              )}
            </div>
          </div>
          <div className="bg-muted/30 p-2.5 rounded-md border border-white/5 flex flex-col">
            <span className="text-xs text-muted-foreground mb-1 select-none">
              CFG Scale
            </span>
            <span className="font-mono">
              {image.CfgScale ? image.CfgScale.toFixed(1) : '-'}
            </span>
          </div>
          <div className="bg-muted/30 p-2.5 rounded-md border border-white/5 flex flex-col">
            <span className="text-xs text-muted-foreground mb-1 select-none">
              Dimensions
            </span>
            <span className="font-mono">
              {image.Width}x{image.Height}
            </span>
          </div>
          <div className="bg-muted/30 p-2.5 rounded-md border border-white/5 flex flex-col">
            <span className="text-xs text-muted-foreground mb-1 select-none">
              Hash
            </span>
            <div className="flex items-center justify-between group">
              <span
                className="font-mono truncate max-w-[80px]"
                title={image.Hash}
              >
                {image.Hash?.substring(0, 10)}
              </span>
              {image.Hash && (
                <button
                  onClick={() => copyToClipboard(image.Hash, 'hash')}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                >
                  {copiedId === 'hash' ? (
                    <Check size={12} />
                  ) : (
                    <Copy size={12} />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Copy All Button */}
        <Button
          variant="outline"
          className="w-full gap-2 mt-4 bg-muted/20 border-white/10 hover:bg-muted/50"
          onClick={() => {
            const lines = [];
            if (image.Prompt) lines.push(image.Prompt);
            if (image.NegativePrompt)
              lines.push(`Negative prompt: ${image.NegativePrompt}`);
            lines.push(
              `Steps: 20, Sampler: ${image.Sampler}, CFG scale: ${image.CfgScale}, Seed: ${image.Seed}, Size: ${image.Width}x${image.Height}, Model: ${image.Model}`
            );
            copyToClipboard(lines.join('\n'), 'all');
          }}
        >
          {copiedId === 'all' ? <Check size={14} /> : <Copy size={14} />}
          {copiedId === 'all' ? 'Copied!' : 'Copy Generation Data'}
        </Button>
      </div>
    </div>
  );
}
