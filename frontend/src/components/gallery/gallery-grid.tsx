import { useGalleryStore } from '@/stores/gallery-store';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ImageTile } from './image-tile';

export function GalleryGrid() {
  const {
    images,
    searchQuery,
    layoutMode,
    selectedImageId,
    setSelectedImageId,
    fetchImages,
    fetchNextPage,
    hasMore,
    isLoading
  } = useGalleryStore();
  const parentRef = useRef<HTMLDivElement>(null);

  // Columns based on layout mode
  const columns =
    layoutMode === 'compact' ? 6 : layoutMode === 'comfortable' ? 4 : 3;

  useEffect(() => {
    fetchImages();
  }, [searchQuery, fetchImages]);

  // Virtualizer for the grid rows
  const rowVirtualizer = useVirtualizer({
    count: Math.ceil(images.length / columns),
    getScrollElement: () => parentRef.current,
    estimateSize: () =>
      layoutMode === 'compact' ? 140 : layoutMode === 'comfortable' ? 200 : 260,
    overscan: 10,
    scrollMargin: 10
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  // Infinite scroll detection
  useEffect(() => {
    const lastItem = virtualItems[virtualItems.length - 1];
    if (!lastItem) return;

    if (
      lastItem.index >= Math.ceil(images.length / columns) - 2 &&
      hasMore &&
      !isLoading
    ) {
      fetchNextPage();
    }
  }, [virtualItems, images.length, columns, hasMore, isLoading, fetchNextPage]);

  return (
    <div
      ref={parentRef}
      className="h-full w-full overflow-auto p-4 custom-scrollbar"
    >
      {images.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          {searchQuery
            ? 'No images found matching your search.'
            : 'Your gallery is empty. Add folders in settings.'}
        </div>
      ) : (
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative'
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
                transform: `translateY(${virtualRow.start}px)`
              }}
              className="flex gap-4 pb-4"
            >
              {Array.from({ length: columns }).map((_, columnIndex) => {
                const imageIndex = virtualRow.index * columns + columnIndex;
                const image = images[imageIndex];

                if (!image) {
                  return (
                    <div key={`empty-${columnIndex}`} className="flex-1" />
                  );
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
      {isLoading && (
        <div className="flex justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
}
