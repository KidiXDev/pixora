import { isSettingsTabPath } from '@/lib/tab-pages';
import { cn } from '@/lib/utils';
import SettingsPage from '@/pages/settings-page';
import { useGalleryStore } from '@/stores/gallery-store';
import { useTabsStore } from '@/stores/tabs-store';
import { useVirtualizer } from '@tanstack/react-virtual';
import { LayoutGrid } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { ScrollablePage } from '../layout/scrollable-page';
import { Skeleton } from '../ui/skeleton';
import { Spinner } from '../ui/spinner';
import { ImageTile } from './image-tile';
import { TabSetup } from './tab-setup';

const TAB_SCROLL_STORAGE_KEY = 'pixora:tab-scroll-top';

function readPersistedTabScroll(): Map<string, number> {
  if (typeof window === 'undefined') {
    return new Map<string, number>();
  }

  try {
    const raw = window.localStorage.getItem(TAB_SCROLL_STORAGE_KEY);
    if (!raw) {
      return new Map<string, number>();
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return new Map<string, number>();
    }

    const entries = Object.entries(parsed as Record<string, unknown>)
      .map(([tabId, value]) => {
        const num = typeof value === 'number' ? value : Number.NaN;
        return [tabId, num] as const;
      })
      .filter((entry) => Number.isFinite(entry[1]) && entry[1] >= 0);

    return new Map<string, number>(entries);
  } catch {
    return new Map<string, number>();
  }
}

let persistScrollTimer: ReturnType<typeof setTimeout> | null = null;

const tabScrollTopById = readPersistedTabScroll();

function queuePersistTabScroll(): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (persistScrollTimer) {
    clearTimeout(persistScrollTimer);
  }

  persistScrollTimer = setTimeout(() => {
    persistScrollTimer = null;
    try {
      const serialized = Object.fromEntries(tabScrollTopById.entries());
      window.localStorage.setItem(
        TAB_SCROLL_STORAGE_KEY,
        JSON.stringify(serialized)
      );
    } catch {
      // Ignore storage access errors.
    }
  }, 120);
}

function flushPersistTabScroll(): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (persistScrollTimer) {
    clearTimeout(persistScrollTimer);
    persistScrollTimer = null;
  }

  try {
    const serialized = Object.fromEntries(tabScrollTopById.entries());
    window.localStorage.setItem(
      TAB_SCROLL_STORAGE_KEY,
      JSON.stringify(serialized)
    );
  } catch {
    // Ignore storage access errors.
  }
}

function setTabScrollTop(tabId: string, scrollTop: number): void {
  const safeScrollTop = Math.max(0, Math.round(scrollTop));
  const current = tabScrollTopById.get(tabId);
  if (current === safeScrollTop) {
    return;
  }

  tabScrollTopById.set(tabId, safeScrollTop);
  queuePersistTabScroll();
}

function removeTabScrollTop(tabId: string): void {
  if (!tabScrollTopById.delete(tabId)) {
    return;
  }

  queuePersistTabScroll();
}

const DEV_MODE = import.meta.env.DEV;
const TAB_SCROLL_DEBUG_ENABLED =
  DEV_MODE && import.meta.env.VITE_DEBUG_TAB_SCROLL === '1';

function logTabScroll(
  message: string,
  details?: Record<string, unknown>
): void {
  if (!TAB_SCROLL_DEBUG_ENABLED) {
    return;
  }

  if (details) {
    console.log('[GalleryGrid][TabScroll]', message, details);
    return;
  }

  console.log('[GalleryGrid][TabScroll]', message);
}

export function GalleryGrid() {
  const searchQuery = useGalleryStore((state) => state.searchQuery);
  const fetchImages = useGalleryStore((state) => state.fetchImages);
  const pruneTabScopedState = useGalleryStore(
    (state) => state.pruneTabScopedState
  );
  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeTabPath = activeTab?.path ?? null;

  useEffect(() => {
    // On startup, activeTabId may be restored before tabs are loaded.
    // Wait until tab config resolves so we don't clear the gallery prematurely.
    if (activeTabId && activeTabPath === null) {
      return;
    }

    fetchImages(true);
  }, [searchQuery, activeTabId, activeTabPath, fetchImages]);

  useEffect(() => {
    if (tabs.length === 0) {
      // Tabs are loaded asynchronously on startup; avoid clearing persisted scroll too early.
      return;
    }

    const validTabIds = new Set(tabs.map((tab) => tab.id));

    for (const tabId of tabScrollTopById.keys()) {
      if (!validTabIds.has(tabId)) {
        removeTabScrollTop(tabId);
      }
    }

    pruneTabScopedState(Array.from(validTabIds));
  }, [tabs, pruneTabScopedState]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      flushPersistTabScroll();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      flushPersistTabScroll();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

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
  const totalImages = useGalleryStore((state) => state.totalImages);

  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [draggingImageId, setDraggingImageId] = useState<number | null>(null);
  const [comparePickImageId, setComparePickImageId] = useState<number | null>(
    null
  );
  const lastFetchTriggerRowsRef = useRef(-1);
  const restoreFetchInFlightRef = useRef(false);
  const isRestoringScrollRef = useRef(false);
  const didRestoreScrollRef = useRef(false);

  const debouncedSetTabScrollTop = useDebouncedCallback(
    (tabId: string, scrollTop: number) => {
      setTabScrollTop(tabId, scrollTop);
      logTabScroll('scroll saved (debounced)', {
        tabId,
        scrollTop
      });
    },
    200
  );

  useEffect(() => {
    const el = parentRef.current;
    if (!el || !activeTabId) {
      isRestoringScrollRef.current = false;
      didRestoreScrollRef.current = false;
      return;
    }

    const savedScrollTop = tabScrollTopById.get(activeTabId) ?? 0;
    isRestoringScrollRef.current = savedScrollTop > 0;
    didRestoreScrollRef.current = savedScrollTop <= 0;
    logTabScroll('tab mount', {
      tabId: activeTabId,
      savedScrollTop,
      isRestoring: isRestoringScrollRef.current
    });

    const handleScroll = () => {
      if (isRestoringScrollRef.current) {
        return;
      }

      debouncedSetTabScrollTop(activeTabId, el.scrollTop);
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      if (el.scrollTop > 0) {
        setTabScrollTop(activeTabId, el.scrollTop);
      }
      logTabScroll('tab unmount keep', {
        tabId: activeTabId,
        domScrollTop: el.scrollTop,
        keptScrollTop: tabScrollTopById.get(activeTabId) ?? 0
      });
      el.removeEventListener('scroll', handleScroll);
    };
  }, [activeTabId]);

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

  const initialOffset = useMemo(() => {
    if (!activeTabId) {
      return 0;
    }

    return tabScrollTopById.get(activeTabId) ?? 0;
  }, [activeTabId]);

  // Virtualizer for the grid rows
  const rowVirtualizer = useVirtualizer({
    count: Math.ceil(Math.max(images.length, totalImages) / columns),
    initialOffset,
    getScrollElement: () => parentRef.current,
    estimateSize: () =>
      layoutMode === 'compact' ? 176 : layoutMode === 'comfortable' ? 272 : 336,
    overscan: 10,
    scrollMargin: 10
  });

  useEffect(() => {
    if (!activeTabId || didRestoreScrollRef.current) {
      return;
    }

    const el = parentRef.current;
    if (!el) {
      return;
    }

    const targetScrollTop = tabScrollTopById.get(activeTabId) ?? 0;
    if (targetScrollTop <= 0) {
      didRestoreScrollRef.current = true;
      isRestoringScrollRef.current = false;
      return;
    }

    const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    if (maxScrollTop + 1 < targetScrollTop) {
      logTabScroll('restore waiting for content height', {
        tabId: activeTabId,
        targetScrollTop,
        maxScrollTop,
        images: images.length,
        totalImages,
        isLoading
      });

      if (hasMore && !isLoading && !restoreFetchInFlightRef.current) {
        restoreFetchInFlightRef.current = true;
        void fetchNextPage().finally(() => {
          restoreFetchInFlightRef.current = false;
        });
      }

      return;
    }

    rowVirtualizer.scrollToOffset(targetScrollTop, { align: 'start' });
    const actual = el.scrollTop;
    const restored = Math.abs(actual - targetScrollTop) <= 2;
    logTabScroll('restore attempt', {
      tabId: activeTabId,
      targetScrollTop,
      actualScrollTop: actual,
      restored
    });

    if (restored) {
      didRestoreScrollRef.current = true;
      isRestoringScrollRef.current = false;
      setTabScrollTop(activeTabId, actual);
      logTabScroll('restore success', {
        tabId: activeTabId,
        scrollTop: actual
      });
    }
  }, [
    activeTabId,
    rowVirtualizer,
    images.length,
    totalImages,
    columns,
    layoutMode,
    isLoading,
    hasMore,
    fetchNextPage
  ]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const loadedRows = Math.ceil(images.length / columns);
  const lastVirtualIndex =
    virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1;

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      rowVirtualizer.measure();
    });

    return () => cancelAnimationFrame(rafId);
  }, [columns, layoutMode, images.length, rowVirtualizer]);

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
    if (loadedRows <= 0) return;
    if (lastVirtualIndex < loadedRows - 2) return;

    if (lastFetchTriggerRowsRef.current === loadedRows) return;
    lastFetchTriggerRowsRef.current = loadedRows;
    fetchNextPage();
  }, [lastVirtualIndex, loadedRows, hasMore, isLoading, fetchNextPage]);

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
            <div
              className="grid gap-4"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
              }}
            >
              {Array.from({ length: columns * 3 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className={cn(
                    'w-full rounded-md',
                    layoutMode === 'compact'
                      ? 'h-40'
                      : layoutMode === 'comfortable'
                        ? 'h-64'
                        : 'h-80'
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
