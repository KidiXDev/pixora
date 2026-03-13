import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useGalleryStore } from '@/stores/gallery-store';
import { GetImages } from '../../../bindings/pixora/internal/services/galleryservice';
import { ImageTile } from './image-tile';

export function GalleryGrid() {
  const { images, setImages, searchQuery, layoutMode, selectedImageId, setSelectedImageId } = useGalleryStore();
  const parentRef = useRef<HTMLDivElement>(null);
  
  // Columns based on layout mode
  const columns = layoutMode === 'compact' ? 6 : layoutMode === 'comfortable' ? 4 : 3;

  useEffect(() => {
    // Initial fetch
    let active = true;
    GetImages(searchQuery, 0, 100).then((res: { images?: unknown[]; totalCount?: number } | null) => {
      if (active && res) {
        setImages((res.images as import('../../../bindings/pixora/internal/db/models').ImageRecord[]) || [], res.totalCount || 0);
      }
    });
    return () => { active = false; };
  }, [searchQuery, setImages]);

  // Virtualizer for the grid rows
  const rowVirtualizer = useVirtualizer({
    count: Math.ceil(images.length / columns),
    getScrollElement: () => parentRef.current,
    estimateSize: () => (layoutMode === 'compact' ? 140 : layoutMode === 'comfortable' ? 200 : 260),
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="h-full w-full overflow-auto p-4 custom-scrollbar">
      {images.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          {searchQuery ? "No images found matching your search." : "Your gallery is empty. Add folders in settings."}
        </div>
      ) : (
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => (
            <div
              key={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="flex gap-4 pb-4"
            >
              {Array.from({ length: columns }).map((_, columnIndex) => {
                const imageIndex = virtualRow.index * columns + columnIndex;
                const image = images[imageIndex];

                if (!image) {
                  return <div key={`empty-${columnIndex}`} className="flex-1" />;
                }

                return (
                  <div key={image.ID} className="flex-1">
                    <ImageTile
                      image={image}
                      isSelected={selectedImageId === image.ID}
                      onClick={() => setSelectedImageId(image.ID)}
                      layoutMode={layoutMode}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
