import { useGalleryStore } from '@/stores/gallery-store';
import { Check, Copy } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { GetImageRawWorkflow } from '../../../bindings/pixora/internal/services/galleryservice';

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
  const [rawWorkflow, setRawWorkflow] = useState('');
  const [rawWorkflowError, setRawWorkflowError] = useState('');
  const [isRawWorkflowLoading, setIsRawWorkflowLoading] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [workflowHeight, setWorkflowHeight] = useState(() => {
    try {
      const saved = window.localStorage.getItem('pixora:workflow-panel-height');
      return saved ? parseInt(saved, 10) : 224;
    } catch {
      return 224;
    }
  });

  const resizableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showRawWorkflow) return;

    const element = resizableRef.current;
    if (!element) return;

    let timeoutId: number;

    const observer = new ResizeObserver(() => {
      const height = element.offsetHeight;
      if (height > 0) {
        window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
          setWorkflowHeight(height);
          try {
            window.localStorage.setItem(
              'pixora:workflow-panel-height',
              String(height)
            );
          } catch (err) {
            console.error('Failed to save workflow panel height', err);
          }
        }, 150);
      }
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeoutId);
    };
  }, [showRawWorkflow]);

  const currentImage = images.find((img) => img.ID === selectedImageId);
  const [activeImage, setActiveImage] = useState<typeof currentImage | null>(
    null
  );

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

  // Reset state when image changes
  useEffect(() => {
    setOffset({ x: 0, y: 0 });
    setScale(1);
    setIsDragging(false);
    setShowRawWorkflow(false);
    setRawWorkflow('');
    setRawWorkflowError('');
    setIsRawWorkflowLoading(false);
    setCopiedRaw(false);
  }, [selectedImageId]);

  if (!image) return null;

  const prettyRawWorkflow = (() => {
    const trimmed = rawWorkflow.trim();
    if (!trimmed) return '';
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return rawWorkflow;
    }
  })();

  const handleToggleRawWorkflow = async () => {
    const nextShow = !showRawWorkflow;
    setShowRawWorkflow(nextShow);
    if (!nextShow || rawWorkflow || isRawWorkflowLoading) return;

    setIsRawWorkflowLoading(true);
    setRawWorkflowError('');
    try {
      const result = await GetImageRawWorkflow(image.Path);
      const trimmed = (result || '').trim();
      if (!trimmed) {
        setRawWorkflowError('No raw workflow metadata found in this image.');
      } else {
        setRawWorkflow(trimmed);
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to load raw workflow metadata.';
      setRawWorkflowError(message);
    } finally {
      setIsRawWorkflowLoading(false);
    }
  };

  const handleCopyRawWorkflow = () => {
    const value = prettyRawWorkflow || rawWorkflow;
    if (!value) return;
    navigator.clipboard.writeText(value).catch(() => {});
    setCopiedRaw(true);
    setTimeout(() => setCopiedRaw(false), 1500);
  };

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
              void handleToggleRawWorkflow();
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
        <div
          className="absolute top-16 left-4 right-[calc(33.333%+1rem)] z-20 pointer-events-auto rounded-lg border border-white/20 bg-black/75 backdrop-blur-sm shadow-xl"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <div className="text-xs font-semibold text-white/90">
              Raw Workflow JSON
            </div>
            <button
              type="button"
              onClick={handleCopyRawWorkflow}
              disabled={!rawWorkflow}
              className="inline-flex items-center gap-1 rounded border border-white/20 px-2 py-1 text-[11px] font-medium text-white/90 disabled:opacity-50 hover:bg-white/10 transition-colors"
            >
              {copiedRaw ? <Check size={12} /> : <Copy size={12} />}
              {copiedRaw ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div
            ref={resizableRef}
            style={{ height: `${workflowHeight}px` }}
            className="min-h-24 max-h-[65vh] resize-y overflow-auto p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all text-white/85 select-text cursor-text"
          >
            {isRawWorkflowLoading && 'Loading raw workflow...'}
            {!isRawWorkflowLoading && rawWorkflowError && rawWorkflowError}
            {!isRawWorkflowLoading && !rawWorkflowError && prettyRawWorkflow}
          </div>
        </div>
      )}

      <div
        className="flex-1 w-full h-full p-8 pr-[33.333%] flex items-center justify-center overflow-hidden"
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
