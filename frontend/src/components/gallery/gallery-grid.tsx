import { cn } from '@/lib/utils';
import { isSettingsTabPath } from '@/lib/tab-pages';
import SettingsPage from '@/pages/settings-page';
import { useGalleryStore } from '@/stores/gallery-store';
import { useTabsStore } from '@/stores/tabs-store';
import { useVirtualizer } from '@tanstack/react-virtual';
import { LayoutGrid } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollablePage } from '../layout/scrollable-page';
import { ImageTile } from './image-tile';
import { TabSetup } from './tab-setup';
import { Skeleton } from '../ui/skeleton';
import { Spinner } from '../ui/spinner';

export function GalleryGrid() {
  const searchQuery = useGalleryStore((state) => state.searchQuery);
  const fetchImages = useGalleryStore((state) => state.fetchImages);
  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);

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
  const images = useGalleryStore((state) => state.images);
  const layoutMode = useGalleryStore((state) => state.layoutMode);
  const selectedImageId = useGalleryStore((state) => state.selectedImageId);
  const setSelectedImageId = useGalleryStore(
    (state) => state.setSelectedImageId
  );
  const startCompare = useGalleryStore((state) => state.startCompare);
  const fetchNextPage = useGalleryStore((state) => state.fetchNextPage);
  const hasMore = useGalleryStore((state) => state.hasMore);
  const isLoading = useGalleryStore((state) => state.isLoading);

  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [draggingImageId, setDraggingImageId] = useState<number | null>(null);
  const [comparePickImageId, setComparePickImageId] = useState<number | null>(
    null
  );
  const lastFetchTriggerRowsRef = useRef(-1);

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
  const totalRows = Math.ceil(images.length / columns);
  const lastVirtualIndex =
    virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1;

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

  const imageIdSet = useMemo(
    () => new Set(images.map((img) => img.ID)),
    [images]
  );

  useEffect(() => {
    if (comparePickImageId === null) return;
    if (!imageIdSet.has(comparePickImageId)) {
      setComparePickImageId(null);
    }
  }, [comparePickImageId, imageIdSet]);

  useEffect(() => {
    lastFetchTriggerRowsRef.current = -1;
  }, [activeTabId, searchQuery]);

  // Infinite scroll detection
  useEffect(() => {
    if (lastVirtualIndex < 0) return;
    if (!hasMore || isLoading) return;
    if (lastVirtualIndex < totalRows - 2) return;

    if (lastFetchTriggerRowsRef.current === totalRows) return;
    lastFetchTriggerRowsRef.current = totalRows;
    fetchNextPage();
  }, [lastVirtualIndex, totalRows, hasMore, isLoading, fetchNextPage]);

  const handleTileClick = useCallback(
    (imageId: number) => {
      setSelectedImageId(imageId);
    },
    [setSelectedImageId]
  );

  const handleCompareDragStart = useCallback((imageId: number) => {
    setDraggingImageId(imageId);
  }, []);

  const handleCompareDragEnd = useCallback(() => {
    setDraggingImageId(null);
  }, []);

  const handleCompareDrop = useCallback(
    (sourceId: number, targetId: number) => {
      setDraggingImageId(null);
      setComparePickImageId(null);
      if (sourceId !== targetId) {
        startCompare(sourceId, targetId);
      }
    },
    [startCompare]
  );

  const handleCompareQuickPick = useCallback(
    (targetId: number) => {
      setComparePickImageId((prev) => {
        if (prev === null) {
          return targetId;
        }

        if (prev === targetId) {
          return null;
        }

        startCompare(prev, targetId);
        return null;
      });
    },
    [startCompare]
  );

  return (
    <ScrollablePage
      ref={parentRef}
      className="p-4 custom-scrollbar"
      containerClassName="h-full w-full"
    >
      <div className="h-full w-full">
        {images.length === 0 ? (
          isLoading ? (
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {Array.from({ length: columns * 3 }).map((_, i) => (
                <Skeleton 
                  key={i} 
                  className={cn(
                    "w-full rounded-md",
                    layoutMode === 'compact' ? 'h-40' : layoutMode === 'comfortable' ? 'h-64' : 'h-80'
                  )} 
                />
              ))}
            </div>
          ) : (
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
          )
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative'
            }}
          >
            {virtualItems.map((virtualRow) => (
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
                        onClick={handleTileClick}
                        layoutMode={layoutMode}
                        draggingImageId={draggingImageId}
                        isCompareDragging={draggingImageId !== null}
                        isCompareDragSource={draggingImageId === image.ID}
                        onCompareDragStart={handleCompareDragStart}
                        onCompareDragEnd={handleCompareDragEnd}
                        onCompareDrop={handleCompareDrop}
                        isCompareQuickSource={comparePickImageId === image.ID}
                        onCompareQuickPick={handleCompareQuickPick}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {isLoading && images.length > 0 && (
          <div className="flex justify-center p-8">
            <Spinner className="size-6 text-primary" />
          </div>
        )}
      </div>
    </ScrollablePage>
  );
}
