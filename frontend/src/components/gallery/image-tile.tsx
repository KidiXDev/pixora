import { getBaseName } from '@/lib/utils';
import { Browser } from '@wailsio/runtime';
import {
  Copy,
  ExternalLink,
  FolderOpen,
  GitCompareArrows,
  Image as ImageIcon
} from 'lucide-react';
import { memo, useMemo, useRef, useState } from 'react';
import { ImageRecord } from '../../../bindings/pixora/internal/db/models';
import {
  OpenExternally,
  ShowInFolder
} from '../../../bindings/pixora/internal/services/galleryservice';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '../ui/context-menu';

interface ImageTileProps {
  image: ImageRecord;
  isSelected: boolean;
  onClick: (imageId: number) => void;
  layoutMode: 'compact' | 'comfortable' | 'spacious';
  draggingImageId?: number | null;
  isCompareDragging?: boolean;
  isCompareDragSource?: boolean;
  onCompareDragStart?: (imageId: number) => void;
  onCompareDragEnd?: () => void;
  onCompareDrop?: (sourceImageId: number, targetImageId: number) => void;
  isCompareQuickSource?: boolean;
  onCompareQuickPick?: (imageId: number) => void;
}

export const ImageTile = memo(function ImageTile({
  image,
  isSelected,
  onClick,
  layoutMode,
  draggingImageId = null,
  isCompareDragging = false,
  isCompareDragSource = false,
  onCompareDragStart,
  onCompareDragEnd,
  onCompareDrop,
  isCompareQuickSource = false,
  onCompareQuickPick
}: ImageTileProps) {
  const [isCompareDropTarget, setIsCompareDropTarget] = useState(false);
  const suppressClickRef = useRef(false);
  const fileName = useMemo(() => getBaseName(image.Path), [image.Path]);

  const heightClass =
    layoutMode === 'compact'
      ? 'h-40'
      : layoutMode === 'comfortable'
        ? 'h-64'
        : 'h-80';

  const handleDoubleClick = () => {
    // Open the original image in the system's default viewer
    Browser.OpenURL('file://' + image.Path).catch(console.error);
  };

  const handleOpenExternal = async () => {
    if (!image.Path) return;
    await OpenExternally(image.Path).catch(console.error);
  };

  const handleShowInFolder = async () => {
    if (!image.Path) return;
    await ShowInFolder(image.Path).catch(console.error);
  };

  const handleCopyPath = () => {
    if (!image.Path) return;
    navigator.clipboard.writeText(image.Path).catch(() => {});
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onCompareDragStart) return;

    suppressClickRef.current = true;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-pixora-image-id', String(image.ID));
    e.dataTransfer.setData('text/plain', String(image.ID));
    onCompareDragStart(image.ID);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isCompareDragging || isCompareDragSource) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsCompareDropTarget(true);
  };

  const handleDragLeave = () => {
    setIsCompareDropTarget(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsCompareDropTarget(false);
    suppressClickRef.current = true;

    if (!onCompareDrop) return;

    const sourceIdRaw =
      e.dataTransfer.getData('application/x-pixora-image-id') ||
      e.dataTransfer.getData('text/plain');
    const parsedSourceId = Number.parseInt(sourceIdRaw, 10);
    const sourceId = Number.isFinite(parsedSourceId)
      ? parsedSourceId
      : draggingImageId;

    if (!sourceId) return;
    onCompareDrop(sourceId, image.ID);
  };

  const handleDragEnd = () => {
    setIsCompareDropTarget(false);
    onCompareDragEnd?.();
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    onClick(image.ID);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          draggable
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          className={`group relative cursor-pointer overflow-hidden rounded-md bg-muted/50 w-full ${heightClass} ${
            isSelected
              ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
              : 'hover:ring-1 hover:ring-border hover:ring-offset-1 hover:ring-offset-background'
          } ${isCompareDragSource ? 'opacity-60 scale-[0.985]' : ''} ${
            isCompareDropTarget
              ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-background'
              : ''
          }`}
        >
          <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
            <img
              src={`/thumbs/${image.Hash}.jpg`}
              alt={fileName}
              className="h-full w-full object-contain"
              decoding="async"
              draggable={false}
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                target.nextElementSibling?.classList.remove('hidden');
              }}
            />

            <div className="absolute bottom-0 left-0 right-0 flex h-16 items-end justify-center bg-linear-to-t from-black/80 to-transparent px-2 pb-2 pt-2 text-center text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
              <span className="truncate">{fileName}</span>
            </div>
          </div>

          {/* Decorative gradient to simulate an image load */}
          <div className="absolute inset-0 bg-linear-to-tr from-transparent to-black/10 mix-blend-overlay pointer-events-none"></div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCompareQuickPick?.(image.ID);
            }}
            className={`absolute top-2 left-2 inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold tracking-wide text-white backdrop-blur-sm transition-all ${
              isCompareQuickSource
                ? 'bg-emerald-600/90 ring-1 ring-emerald-300/70'
                : 'bg-black/65 opacity-0 group-hover:opacity-100'
            }`}
            title={
              isCompareQuickSource
                ? 'Selected as compare source. Click to clear.'
                : 'Pick image for compare'
            }
          >
            <GitCompareArrows size={12} />
            {isCompareQuickSource ? 'Pick B' : 'Compare'}
          </button>

          {isCompareDragging && !isCompareDragSource && (
            <div className="absolute top-2 right-2 rounded bg-black/70 px-2 py-1 text-[10px] font-semibold tracking-wide text-white backdrop-blur-sm pointer-events-none">
              Drop to Compare
            </div>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52" sideOffset={8}>
        <ContextMenuItem onClick={handleClick}>
          <ImageIcon size={14} />
          Select Image
        </ContextMenuItem>
        <ContextMenuItem onClick={handleOpenExternal}>
          <ExternalLink size={14} />
          Open Externally
        </ContextMenuItem>
        <ContextMenuItem onClick={handleShowInFolder}>
          <FolderOpen size={14} />
          Show in Folder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => {
            onCompareQuickPick?.(image.ID);
          }}
        >
          <GitCompareArrows size={14} />
          {isCompareQuickSource ? 'Clear Compare Source' : 'Pick for Compare'}
        </ContextMenuItem>
        <ContextMenuItem onClick={handleCopyPath}>
          <Copy size={14} />
          Copy Path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
