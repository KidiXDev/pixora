import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useGalleryStore } from '@/stores/gallery-store';
import { motion } from 'framer-motion';
import {
  ArrowLeftRight,
  ExternalLink,
  FolderOpen,
  Layers,
  X
} from 'lucide-react';
import {
  OpenExternally,
  ShowInFolder
} from '../../../bindings/pixora/internal/services/galleryservice';

export function CompareInspector() {
  const images = useGalleryStore((state) => state.images);
  const compareImageIds = useGalleryStore((state) => state.compareImageIds);
  const closeCompare = useGalleryStore((state) => state.closeCompare);
  const swapCompareImages = useGalleryStore((state) => state.swapCompareImages);

  if (!compareImageIds) return null;

  const firstImage = images.find((img) => img.ID === compareImageIds[0]);
  const secondImage = images.find((img) => img.ID === compareImageIds[1]);

  if (!firstImage || !secondImage) return null;

  const openFirstInFolder = async () => {
    await ShowInFolder(firstImage.Path).catch(console.error);
  };

  const openSecondInFolder = async () => {
    await ShowInFolder(secondImage.Path).catch(console.error);
  };

  const openFirstExternal = async () => {
    await OpenExternally(firstImage.Path).catch(console.error);
  };

  const openSecondExternal = async () => {
    await OpenExternally(secondImage.Path).catch(console.error);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="h-full flex flex-col p-6 overflow-y-auto custom-scrollbar"
    >
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-card-foreground">
            Compare
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Drag one image onto another to open this mode. Swipe or drag in the
            viewer to compare details.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={closeCompare}
          title="Close Compare"
          className="hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <X size={18} />
        </Button>
      </div>

      <Button
        variant="outline"
        className="mb-6 w-full justify-center gap-2"
        onClick={swapCompareImages}
      >
        <ArrowLeftRight size={14} />
        Swap A / B
      </Button>

      <div className="space-y-5">
        <CompareCard
          title="Image A"
          imagePath={firstImage.Path}
          imageHash={firstImage.Hash}
          model={firstImage.Model}
          seed={firstImage.Seed}
          onOpenExternal={openFirstExternal}
          onShowInFolder={openFirstInFolder}
        />

        <Separator className="bg-white/5" />

        <CompareCard
          title="Image B"
          imagePath={secondImage.Path}
          imageHash={secondImage.Hash}
          model={secondImage.Model}
          seed={secondImage.Seed}
          onOpenExternal={openSecondExternal}
          onShowInFolder={openSecondInFolder}
        />
      </div>
    </motion.div>
  );
}

function CompareCard({
  title,
  imagePath,
  imageHash,
  model,
  seed,
  onOpenExternal,
  onShowInFolder
}: {
  title: string;
  imagePath: string;
  imageHash: string;
  model?: string;
  seed?: string;
  onOpenExternal: () => Promise<void>;
  onShowInFolder: () => Promise<void>;
}) {
  const fileName = imagePath.split(/[/\\]/).pop() || imagePath;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenExternal}
            title="Open Externally"
            className="hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <ExternalLink size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onShowInFolder}
            title="Show in Folder"
            className="hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <FolderOpen size={15} />
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10 bg-muted/20">
        <div className="aspect-video bg-black/60">
          <img
            src={`/thumbs/${imageHash}.jpg`}
            alt={fileName}
            className="h-full w-full object-contain"
            onError={(e) => {
              const target = e.currentTarget;
              target.src = `/image/?path=${encodeURIComponent(imagePath)}`;
            }}
          />
        </div>

        <div className="space-y-3 p-3">
          <div className="truncate text-sm font-medium" title={imagePath}>
            {fileName}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-white/10 bg-background/40 p-2">
              <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                <Layers size={11} />
                Model
              </div>
              <div className="truncate text-xs font-medium">{model || '-'}</div>
            </div>

            <div className="rounded-md border border-white/10 bg-background/40 p-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Seed
              </div>
              <div className="truncate font-mono text-xs">{seed || '-'}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
