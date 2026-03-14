import { isSettingsTabPath } from '@/lib/tab-pages';
import SettingsPage from '@/pages/settings-page';
import { useGalleryStore } from '@/stores/gallery-store';
import { useTabsStore } from '@/stores/tabs-store';
import { useVirtualizer } from '@tanstack/react-virtual';
import { LayoutGrid, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollablePage } from '../layout/scrollable-page';
import { ImageTile } from './image-tile';
import { TabSetup } from './tab-setup';

export function GalleryGrid() {
  const { searchQuery, fetchImages } = useGalleryStore();
  const { tabs, activeTabId } = useTabsStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  useEffect(() => {
    fetchImages(true);
  }, [searchQuery, activeTabId, fetchImages]);

  if (activeTab && isSettingsTabPath(activeTab.path)) {
    return <SettingsPage />;
  }

  // If we have an active tab but no path, show the setup screen
  if (activeTab && !activeTab.path) {
    return <TabSetup />;
  }

  return <ImageGrid activeTabId={activeTabId} searchQuery={searchQuery} />;
}

function ImageGrid({
  activeTabId,
  searchQuery
}: {
  activeTabId: string | null;
  searchQuery: string;
}) {
  const {
    images,
    layoutMode,
    selectedImageId,
    setSelectedImageId,
    fetchNextPage,
    hasMore,
    isLoading
  } = useGalleryStore();

  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    let rafId: number;
    const updateWidth = () => {
      if (el) setContainerWidth(el.clientWidth);
    };

    updateWidth();

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateWidth);
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, []);

  const columns = useMemo(() => {
    const gap = 16;
    const horizontalPadding = 32;
    const availableWidth = Math.max(320, containerWidth - horizontalPadding);

    const minTileWidth =
      layoutMode === 'compact' ? 130 : layoutMode === 'comfortable' ? 180 : 240;

    const maxColumns =
      layoutMode === 'compact' ? 10 : layoutMode === 'comfortable' ? 7 : 5;

    const fitColumns = Math.floor(
      (availableWidth + gap) / (minTileWidth + gap)
    );
    return Math.max(1, Math.min(maxColumns, fitColumns));
  }, [containerWidth, layoutMode]);

  // Virtualizer for the grid rows
  const rowVirtualizer = useVirtualizer({
    count: Math.ceil(images.length / columns),
    getScrollElement: () => parentRef.current,
    estimateSize: () =>
      layoutMode === 'compact' ? 176 : layoutMode === 'comfortable' ? 272 : 336,
    overscan: 10,
    scrollMargin: 10
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    if (selectedImageId) {
      return;
    }

    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        rowVirtualizer.measure();
      });
      return () => cancelAnimationFrame(raf2);
    });

    return () => cancelAnimationFrame(raf1);
  }, [selectedImageId, columns, rowVirtualizer]);

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
    activeTabId
  ]);

  return (
    <ScrollablePage
      ref={parentRef}
      className="p-4 custom-scrollbar"
      containerClassName="h-full w-full"
    >
      <div className="h-full w-full">
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
    </ScrollablePage>
  );
}
