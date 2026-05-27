import { useGalleryStore } from '@/stores/gallery-store';
import { useState, useEffect } from 'react';
import { RawWorkflowInspector } from './raw-workflow-inspector';

export function FullImageViewer() {
  const images = useGalleryStore((state) => state.images);
  const selectedImageId = useGalleryStore((state) => state.selectedImageId);
  const setSelectedImageId = useGalleryStore(
    (state) => state.setSelectedImageId
  );
  const isLoading = useGalleryStore((state) => state.isLoading);

  const [scale, setScale] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [showRawWorkflow, setShowRawWorkflow] = useState(false);

  const currentImage = images.find((img) => img.ID === selectedImageId);
  const [activeImage, setActiveImage] = useState<typeof currentImage | null>(
    null
  );

  // Sync state during render immediately if we are switching images (not closing)
  // to avoid showing the old image while switching tabs or images.
  if (currentImage && activeImage !== currentImage) {
    setActiveImage(currentImage);
  }

  useEffect(() => {
    if (currentImage) {
      setActiveImage(currentImage);
    }
  }, [currentImage]);

  const image = activeImage;
  const metadataStatus = image?.MetadataStatus;
  const isMetadataUnavailable = metadataStatus === 2;

  useEffect(() => {
    if (selectedImageId && !currentImage && !isLoading) {
      setSelectedImageId(null);
    }
  }, [selectedImageId, currentImage, isLoading, setSelectedImageId]);

  useEffect(() => {
    setOffset({ x: 0, y: 0 });
    setScale(1);
    setIsDragging(false);
    setShowRawWorkflow(false);
  }, [selectedImageId]);

  if (!image) return null;

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    setIsDragging(true);
    setDragStart({
      x: e.clientX - offset.x,
      y: e.clientY - offset.y
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const handleWheel = (e: React.WheelEvent) => {
    const delta = -e.deltaY;
    const factor = 0.002;
    setScale((prev) => {
      const next = prev + delta * factor;
      return Math.max(1, Math.min(5, next));
    });
  };

  return (
    <div className="relative w-full h-full flex flex-col full-image-viewer-panel">
      {/* Top toolbar */}
      <div className="absolute top-0 left-0 w-full pr-[33.333%] p-4 flex items-center justify-between z-10 bg-linear-to-b from-black/60 to-transparent pointer-events-none">
        <div className="text-white/80 text-sm truncate max-w-md pointer-events-auto">
          {image.Path.split(/[/\\]/).pop()}
        </div>
        <div className="pointer-events-auto flex items-center gap-2 mr-4">
          <button
            type="button"
            onClick={() => {
              setShowRawWorkflow(!showRawWorkflow);
            }}
            className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
              showRawWorkflow
                ? 'border-cyan-300/50 bg-cyan-500/20 text-cyan-100'
                : 'border-white/20 bg-black/35 text-white/85 hover:bg-black/55'
            }`}
          >
            {showRawWorkflow ? 'Hide Raw Workflow' : 'Raw Workflow'}
          </button>
          {isMetadataUnavailable && (
            <div className="rounded-md border border-amber-400/40 bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-100">
              No parseable metadata found
            </div>
          )}
        </div>
      </div>

      {showRawWorkflow && (
        <RawWorkflowInspector
          imagePath={image.Path}
          onClose={() => setShowRawWorkflow(false)}
        />
      )}

      <div
        className="flex-1 w-full h-full p-8 pr-[33.333%] flex items-center justify-center overflow-hidden relative"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setSelectedImageId(null);
          }
        }}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
      >
        <img
          src={`/image/?path=${encodeURIComponent(image.Path)}`}
          alt="Full preview"
          className="max-w-full max-h-full object-contain select-none shadow-2xl rounded-sm transition-transform duration-150 ease-out"
          draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: isDragging ? 'none' : undefined,
            cursor: isDragging ? 'grabbing' : scale > 1 ? 'grab' : 'grab'
          }}
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            if (target.src.includes('/image/')) {
              target.src = `/thumbs/${image.Hash}.jpg`;
            }
          }}
        />
      </div>
    </div>
  );
}
