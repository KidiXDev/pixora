import { useGalleryStore } from '@/stores/gallery-store';
import { useTabsStore } from '@/stores/tabs-store';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2, LayoutGrid } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ImageTile } from './image-tile';
import { TabSetup } from './tab-setup';

export function GalleryGrid() {
  const { searchQuery, fetchImages } = useGalleryStore();
  const { tabs, activeTabId } = useTabsStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  useEffect(() => {
    fetchImages(true);
  }, [searchQuery, activeTabId, fetchImages]);

  // If we have an active tab but no path, show the setup screen
  if (activeTab && !activeTab.path) {
    return <TabSetup />;
  }

  return <ImageGrid activeTabId={activeTabId} searchQuery={searchQuery} />;
}

function ImageGrid({ activeTabId, searchQuery }: { activeTabId: string | null; searchQuery: string }) {
  const {
    images,
    layoutMode,
    selectedImageId,
    setSelectedImageId,
    fetchNextPage,
    hasMore,
    isLoading,
  } = useGalleryStore();

  const parentRef = useRef<HTMLDivElement>(null);

  // Columns based on layout mode
  const columns =
    layoutMode === 'compact' ? 10 : layoutMode === 'comfortable' ? 7 : 5;

  // Virtualizer for the grid rows
  const rowVirtualizer = useVirtualizer({
    count: Math.ceil(images.length / columns),
    getScrollElement: () => parentRef.current,
    estimateSize: () =>
      layoutMode === 'compact' ? 176 : layoutMode === 'comfortable' ? 272 : 336,
    overscan: 10,
    scrollMargin: 10,
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
  }, [
    virtualItems,
    images.length,
    columns,
    hasMore,
    isLoading,
    fetchNextPage,
    activeTabId,
  ]);

  return (
    <div
      ref={parentRef}
      className="h-full w-full overflow-auto p-4 custom-scrollbar"
    >
      {images.length === 0 && !isLoading ? (
        <div className="flex h-full w-full flex-col items-center justify-center text-muted-foreground p-12 text-center animate-in fade-in duration-500">
          <div className="w-20 h-20 rounded-full bg-muted/30 flex items-center justify-center mb-6">
            <LayoutGrid size={40} className="text-muted-foreground/40" />
          </div>
          <h3 className="text-xl font-semibold text-foreground mb-2">
            {!activeTabId
              ? 'Welcome to Pixora'
              : searchQuery
              ? 'No Results'
              : 'Folder is Empty'}
          </h3>
          <p className="max-w-xs mb-8">
            {!activeTabId
              ? 'Start browsing your AI generated art by creating your first folder tab.'
              : searchQuery
              ? `We couldn't find any images matching "${searchQuery}" in this folder.`
              : 'This folder is being indexed or contains no supported image formats.'}
          </p>
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
