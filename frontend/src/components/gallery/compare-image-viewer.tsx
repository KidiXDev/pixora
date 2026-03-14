import { Slider } from '@/components/ui/slider';
import { useGalleryStore } from '@/stores/gallery-store';
import { MoveHorizontal } from 'lucide-react';
import { useRef } from 'react';

export function CompareImageViewer() {
  const images = useGalleryStore((state) => state.images);
  const compareImageIds = useGalleryStore((state) => state.compareImageIds);
  const compareSlider = useGalleryStore((state) => state.compareSlider);
  const setCompareSlider = useGalleryStore((state) => state.setCompareSlider);
  const frameRef = useRef<HTMLDivElement>(null);

  if (!compareImageIds) return null;

  const firstImage = images.find((img) => img.ID === compareImageIds[0]);
  const secondImage = images.find((img) => img.ID === compareImageIds[1]);

  if (!firstImage || !secondImage) return null;

  const updateFromPointerX = (clientX: number) => {
    const frame = frameRef.current;
    if (!frame) return;

    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0) return;

    const ratio = (clientX - rect.left) / rect.width;
    setCompareSlider(ratio * 100);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    updateFromPointerX(e.clientX);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    updateFromPointerX(e.clientX);
  };

  const onImageError = (
    e: React.SyntheticEvent<HTMLImageElement, Event>,
    hash: string
  ) => {
    const target = e.currentTarget;
    if (target.src.includes('/image/')) {
      target.src = `/thumbs/${hash}.jpg`;
    }
  };

  return (
    <div className="relative h-full w-full bg-black/95">
      <div className="absolute top-0 left-0 w-full p-4 z-10 bg-linear-to-b from-black/70 to-transparent">
        <div className="flex items-center justify-between gap-3 text-sm text-white/90">
          <div className="truncate max-w-[45%]">
            A: {firstImage.Path.split(/[/\\]/).pop()}
          </div>
          <MoveHorizontal size={16} className="text-white/70" />
          <div className="truncate text-right max-w-[45%]">
            B: {secondImage.Path.split(/[/\\]/).pop()}
          </div>
        </div>
      </div>

      <div className="absolute inset-0 p-6 pt-16 pb-24">
        <div
          ref={frameRef}
          className="relative h-full w-full touch-none select-none overflow-hidden rounded-lg border border-white/10 bg-black"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
        >
          <img
            src={`/image/?path=${encodeURIComponent(secondImage.Path)}`}
            alt="Compare image B"
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
            onError={(e) => onImageError(e, secondImage.Hash)}
          />

          <img
            src={`/image/?path=${encodeURIComponent(firstImage.Path)}`}
            alt="Compare image A"
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
            style={{ clipPath: `inset(0 ${100 - compareSlider}% 0 0)` }}
            onError={(e) => onImageError(e, firstImage.Hash)}
          />

          <div
            className="pointer-events-none absolute inset-y-0 z-20"
            style={{ left: `${compareSlider}%` }}
          >
            <div className="absolute -left-px top-0 h-full w-0.5 bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" />
            <div className="absolute -left-5 top-1/2 -translate-y-1/2 rounded-full border border-white/50 bg-black/70 p-2 text-white shadow-lg">
              <MoveHorizontal size={14} />
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-4 left-1/2 z-20 w-[min(560px,80%)] -translate-x-1/2 rounded-xl border border-white/10 bg-black/60 px-4 py-3 backdrop-blur-md">
        <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-white/70">
          <span>Swipe Divider</span>
          <span>{Math.round(compareSlider)}%</span>
        </div>
        <Slider
          value={[compareSlider]}
          min={0}
          max={100}
          step={1}
          onValueChange={(value) => {
            const next = Array.isArray(value) ? value[0] : value;
            if (typeof next === 'number') {
              setCompareSlider(next);
            }
          }}
        />
      </div>
    </div>
  );
}
