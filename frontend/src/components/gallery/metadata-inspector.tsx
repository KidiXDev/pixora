import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useGalleryStore } from '@/stores/gallery-store';
import {
  Calendar,
  Check,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  Hash,
  Info,
  Layers,
  Maximize,
  Search,
  X
} from 'lucide-react';
import { useCallback, useState } from 'react';
import {
  OpenExternally,
  ShowInFolder
} from '../../../bindings/pixora/internal/services/galleryservice';

export function MetadataInspector() {
  const selectedImageId = useGalleryStore((state) => state.selectedImageId);
  const setSelectedImageId = useGalleryStore(
    (state) => state.setSelectedImageId
  );
  const image = useGalleryStore(
    useCallback(
      (state) =>
        selectedImageId === null
          ? null
          : state.images.find((img) => img.ID === selectedImageId) || null,
      [selectedImageId]
    )
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [promptMode, setPromptMode] = useState<'normal' | 'raw'>('normal');

  if (!selectedImageId) return null;

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
    if (image.Path) {
      await OpenExternally(image.Path).catch(console.error);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (date: string | number | Date | null | undefined) => {
    if (!date) return '-';
    try {
      // Handle Go/Wails time representation
      const d = new Date(date);
      if (isNaN(d.getTime())) return '-';
      return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(d);
    } catch {
      return '-';
    }
  };

  const renderPrompt = (prompt: string) => {
    if (!prompt)
      return (
        <span className="text-muted-foreground italic text-xs">
          No prompt data found
        </span>
      );

    if (promptMode === 'raw') {
      return (
        <div className="text-xs font-mono break-all whitespace-pre-wrap select-text leading-relaxed text-foreground/90">
          {prompt}
        </div>
      );
    }

    const tags = prompt
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    return (
      <div className="flex flex-wrap gap-1.5 overflow-hidden">
        {tags.map((tag, i) => {
          const parts = tag.split(/(<[^>]+>|\([^)]+:\d+(?:\.\d+)?\))/g);
          const isSpecial = tag.startsWith('<') || tag.startsWith('(');

          return (
            <span
              key={i}
              className={`inline-flex items-center px-2 py-0.5 rounded-md text-[13px] border transition-colors select-text break-all max-w-full ${
                isSpecial
                  ? 'bg-primary/10 border-primary/20 text-primary font-medium'
                  : 'bg-muted/40 border-white/5 text-foreground/90 hover:bg-muted/60'
              }`}
            >
              <div className="w-full">
                {parts.map((part, pi) => {
                  if (part.startsWith('<') && part.endsWith('>')) {
                    return (
                      <span key={pi} className="text-primary font-bold">
                        {part}
                      </span>
                    );
                  }
                  if (part.startsWith('(') && part.endsWith(')')) {
                    return (
                      <span key={pi} className="text-chart-2 font-medium">
                        {part}
                      </span>
                    );
                  }
                  return <span key={pi}>{part}</span>;
                })}
              </div>
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col p-6 overflow-y-auto custom-scrollbar select-none">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-card-foreground">
          Generation Data
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={openExternal}
            title="Open Image Externally"
            className="hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <ExternalLink size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={openDirectory}
            title="Show in Folder"
            className="hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <FolderOpen size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSelectedImageId(null)}
            title="Close Inspector"
            className="hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <X size={18} />
          </Button>
        </div>
      </div>

      <div className="space-y-8">
        {/* Prompt Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm font-medium text-muted-foreground px-1">
            <div className="flex items-center gap-2">
              <FileText size={14} />
              <span>Prompt</span>
              <div className="flex items-center bg-muted/40 rounded-md p-0.5 border border-white/5 ml-1">
                <button
                  onClick={() => setPromptMode('normal')}
                  className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded transition-all ${
                    promptMode === 'normal'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Normal
                </button>
                <button
                  onClick={() => setPromptMode('raw')}
                  className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded transition-all ${
                    promptMode === 'raw'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Raw
                </button>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 hover:bg-primary/10 hover:text-primary"
              onClick={() => copyToClipboard(image.Prompt, 'prompt')}
            >
              {copiedId === 'prompt' ? <Check size={12} /> : <Copy size={12} />}
            </Button>
          </div>
          <div className="text-sm bg-muted/20 p-4 rounded-xl border border-white/5 leading-relaxed shadow-inner overflow-hidden">
            {renderPrompt(image.Prompt)}
          </div>
        </div>

        {/* Negative Prompt Section */}
        {image.NegativePrompt && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm font-medium text-muted-foreground px-1">
              <div className="flex items-center gap-2">
                <Info size={14} className="text-destructive/70" />
                <span>Negative Prompt</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
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
            <div className="text-sm bg-destructive/5 text-foreground/80 p-4 rounded-xl border border-destructive/10 leading-relaxed italic break-all overflow-hidden">
              {image.NegativePrompt}
            </div>
          </div>
        )}

        {/* Parameters Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/20 p-3 rounded-xl border border-white/5 group hover:border-primary/20 transition-all">
            <div className="flex items-center gap-1.5 mb-1.5 text-muted-foreground">
              <Layers size={13} />
              <span className="text-[11px] font-bold uppercase tracking-wider">
                Model
              </span>
            </div>
            <div
              className="font-medium text-sm truncate select-text"
              title={image.Model || 'Unknown'}
            >
              {image.Model || '-'}
            </div>
          </div>

          <div className="bg-muted/20 p-3 rounded-xl border border-white/5 group hover:border-primary/20 transition-all">
            <div className="flex items-center gap-1.5 mb-1.5 text-muted-foreground">
              <Search size={13} />
              <span className="text-[11px] font-bold uppercase tracking-wider">
                Sampler
              </span>
            </div>
            <div className="font-medium text-sm truncate select-text">
              {image.Sampler || '-'}
            </div>
          </div>

          <div className="bg-muted/20 p-3 rounded-xl border border-white/5 group hover:border-primary/20 transition-all">
            <div className="flex items-center gap-1.5 mb-1.5 text-muted-foreground">
              <Hash size={13} />
              <span className="text-[11px] font-bold uppercase tracking-wider">
                Seed
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="font-mono text-xs truncate select-text">
                {image.Seed || '-'}
              </div>
              {image.Seed && (
                <button
                  onClick={() => copyToClipboard(image.Seed, 'seed')}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-all ml-2"
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

          <div className="bg-muted/20 p-3 rounded-xl border border-white/5 group hover:border-primary/20 transition-all">
            <div className="flex items-center gap-1.5 mb-1.5 text-muted-foreground">
              <Info size={13} />
              <span className="text-[11px] font-bold uppercase tracking-wider">
                CFG Scale
              </span>
            </div>
            <div className="font-mono text-sm select-text">
              {image.CfgScale ? image.CfgScale.toFixed(1) : '-'}
            </div>
          </div>
        </div>

        <Separator className="bg-white/5" />

        {/* File Details Section */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-2 px-1">
            <div className="w-1 h-3 bg-primary rounded-full" />
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">
              File Registry
            </h3>
          </div>

          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-1.5 group">
                <div className="flex items-center gap-1.5 text-muted-foreground/60 group-hover:text-foreground transition-colors">
                  <Maximize size={11} />
                  <span className="text-[10px] font-bold uppercase">Size</span>
                </div>
                <div className="font-bold tabular-nums">
                  {image.Width}{' '}
                  <span className="text-muted-foreground font-normal">×</span>{' '}
                  {image.Height}
                </div>
              </div>

              <div className="space-y-1.5 group">
                <div className="flex items-center gap-1.5 text-muted-foreground/60 group-hover:text-foreground transition-colors">
                  <Info size={11} />
                  <span className="text-[10px] font-bold uppercase">
                    Weight
                  </span>
                </div>
                <div className="font-bold tabular-nums">
                  {formatBytes(image.FileSize)}
                </div>
              </div>

              <div className="space-y-1.5 group">
                <div className="flex items-center gap-1.5 text-muted-foreground/60 group-hover:text-foreground transition-colors">
                  <Calendar size={11} />
                  <span className="text-[10px] font-bold uppercase">
                    Archived
                  </span>
                </div>
                <div
                  className="font-bold text-[11px] truncate"
                  title={formatDate(image.AddedAt)}
                >
                  {formatDate(image.AddedAt)}
                </div>
              </div>

              <div className="space-y-1.5 group">
                <div className="flex items-center gap-1.5 text-muted-foreground/60 group-hover:text-foreground transition-colors">
                  <Hash size={11} />
                  <span className="text-[10px] font-bold uppercase">Hash</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="font-mono text-[10px] text-muted-foreground truncate max-w-20">
                    {image.Hash}
                  </div>
                  {image.Hash && (
                    <button
                      onClick={() => copyToClipboard(image.Hash, 'hash')}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/5 text-muted-foreground hover:text-primary transition-all active:scale-90"
                    >
                      {copiedId === 'hash' ? (
                        <Check size={11} className="text-green-500" />
                      ) : (
                        <Copy size={11} />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-white/5 space-y-2 group">
              <div className="flex items-center gap-1.5 text-muted-foreground/60 group-hover:text-foreground transition-colors">
                <FolderOpen size={11} />
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  File Path
                </span>
              </div>
              <div
                className="text-[11px] font-mono break-all text-muted-foreground/70 group-hover:text-foreground/90 transition-colors select-all leading-tight p-3 rounded-xl bg-black/20 border border-white/5"
                title={image.Path}
              >
                {image.Path}
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-2 bg-primary/5 border-primary/10 hover:bg-primary/10 text-xs py-5"
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
            {copiedId === 'all'
              ? 'Copied Full Metadata'
              : 'Copy All Parameters'}
          </Button>
        </div>
      </div>
    </div>
  );
}
