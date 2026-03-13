import { useGalleryStore } from '@/stores/gallery-store';

export function FullImageViewer() {
  const { images, selectedImageId } = useGalleryStore();
  
  if (!selectedImageId) return null;

  const image = images.find((img) => img.ID === selectedImageId);
  if (!image) return null;

  return (
    <div className="relative w-full h-full bg-black/95 flex flex-col">
      {/* Top toolbar */}
      <div className="absolute top-0 left-0 w-full p-4 flex items-center justify-between z-10 bg-linear-to-b from-black/60 to-transparent">
        <div className="text-white/80 text-sm truncate max-w-md">
          {image.Path.split(/[/\\]/).pop()}
        </div>
      </div>

      <div className="flex-1 w-full h-full p-8 flex items-center justify-center overflow-hidden">
        <img
          src={`/image/?path=${encodeURIComponent(image.Path)}`}
          alt="Full preview"
          className="max-w-full max-h-screen object-contain select-none shadow-2xl rounded-sm"
          draggable={false}
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
