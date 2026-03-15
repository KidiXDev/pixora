import { isSettingsTabPath } from '@/lib/tab-pages';
import { cn } from '@/lib/utils';
import SettingsPage from '@/pages/settings-page';
import { useGalleryStore } from '@/stores/gallery-store';
import { useTabsStore } from '@/stores/tabs-store';
import { useVirtualizer } from '@tanstack/react-virtual';
import { LayoutGrid } from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
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
const TAB_SCROLL_DEBUG_ENABLED = DEV_MODE;
const TAB_ACTIVATION_PROFILE_ENABLED = DEV_MODE;
const ACTIVATION_OVERSCAN_ROWS = 2;
const NORMAL_OVERSCAN_ROWS = 8;

interface TabActivationProfile {
  tabId: string;
  startMs: number;
  measureCalls: number;
  measureTotalMs: number;
  virtualItemsCalls: number;
  virtualItemsTotalMs: number;
  restoreCalls: number;
  restoreTotalMs: number;
}

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

function createTabActivationProfile(tabId: string): TabActivationProfile {
  return {
    tabId,
    startMs: performance.now(),
    measureCalls: 0,
    measureTotalMs: 0,
    virtualItemsCalls: 0,
    virtualItemsTotalMs: 0,
    restoreCalls: 0,
    restoreTotalMs: 0
  };
}

function finalizeTabActivationProfile(
  profile: TabActivationProfile,
  context: {
    imagesLength: number;
    totalImages: number;
    virtualItemsLength: number;
    columns: number;
    layoutMode: 'compact' | 'comfortable' | 'spacious';
  }
): void {
  if (!TAB_ACTIVATION_PROFILE_ENABLED) {
    return;
  }

  const totalMs = performance.now() - profile.startMs;
  console.log('[GalleryGrid][Perf] Tab activation', {
    tabId: profile.tabId,
    totalMs: Number(totalMs.toFixed(2)),
    measureCalls: profile.measureCalls,
    measureTotalMs: Number(profile.measureTotalMs.toFixed(2)),
    virtualItemsCalls: profile.virtualItemsCalls,
    virtualItemsTotalMs: Number(profile.virtualItemsTotalMs.toFixed(2)),
    restoreCalls: profile.restoreCalls,
    restoreTotalMs: Number(profile.restoreTotalMs.toFixed(2)),
    imagesLength: context.imagesLength,
    totalImages: context.totalImages,
    virtualItemsLength: context.virtualItemsLength,
    columns: context.columns,
    layoutMode: context.layoutMode
  });
}

export function GalleryGrid() {
  const searchQuery = useGalleryStore((state) => state.searchQuery);
  const sortBy = useGalleryStore((state) => state.sortBy);
  const sortDirection = useGalleryStore((state) => state.sortDirection);
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

    // Defer fetch off the click frame to reduce tab-switch handler blocking.
    const frameId = requestAnimationFrame(() => {
      void fetchImages(true);
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [
    searchQuery,
    sortBy,
    sortDirection,
    activeTabId,
    activeTabPath,
    fetchImages
  ]);

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

  return (
    <ImageGrid
      activeTabId={activeTabId}
      searchQuery={searchQuery}
      sortBy={sortBy}
      sortDirection={sortDirection}
    />
  );
}

function ImageGrid({
  activeTabId,
  searchQuery,
  sortBy,
  sortDirection
}: {
  activeTabId: string | null;
  searchQuery: string;
  sortBy: ReturnType<typeof useGalleryStore.getState>['sortBy'];
  sortDirection: ReturnType<typeof useGalleryStore.getState>['sortDirection'];
}) {
  const hydrateActiveTabSnapshot = useGalleryStore(
    (state) => state.hydrateActiveTabSnapshot
  );
  const renderSignature = `${activeTabId ?? 'none'}|${searchQuery}|${sortBy}|${sortDirection}`;
  const [hydratedSignature, setHydratedSignature] = useState<string | null>(
    null
  );

  useLayoutEffect(() => {
    hydrateActiveTabSnapshot();
    setHydratedSignature(renderSignature);
  }, [renderSignature, hydrateActiveTabSnapshot]);

  if (hydratedSignature !== renderSignature) {
    return null;
  }

  return (
    <TabScopedImageGrid
      key={renderSignature}
      activeTabId={activeTabId}
      searchQuery={searchQuery}
      sortBy={sortBy}
      sortDirection={sortDirection}
    />
  );
}

function TabScopedImageGrid({
  activeTabId,
  searchQuery,
  sortBy,
  sortDirection
}: {
  activeTabId: string | null;
  searchQuery: string;
  sortBy: ReturnType<typeof useGalleryStore.getState>['sortBy'];
  sortDirection: ReturnType<typeof useGalleryStore.getState>['sortDirection'];
}) {
  const layoutMode = useGalleryStore((state) => state.layoutMode);
  const images = useGalleryStore((state) => state.images);
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
  const [overscanRows, setOverscanRows] =
    useState<number>(NORMAL_OVERSCAN_ROWS);
  const lastFetchTriggerRowsRef = useRef(-1);
  const restoreFetchInFlightRef = useRef(false);
  const isRestoringScrollRef = useRef(false);
  const didRestoreScrollRef = useRef(false);
  const tabActivationProfileRef = useRef<TabActivationProfile | null>(null);
  const hasLoggedTabActivationProfileRef = useRef(false);

  useEffect(() => {
    hasLoggedTabActivationProfileRef.current = false;
    if (!TAB_ACTIVATION_PROFILE_ENABLED || !activeTabId) {
      tabActivationProfileRef.current = null;
      return;
    }

    tabActivationProfileRef.current = createTabActivationProfile(activeTabId);
  }, [activeTabId]);

  useEffect(() => {
    setOverscanRows(ACTIVATION_OVERSCAN_ROWS);

    // Restore normal overscan after first paint to keep scrolling smooth.
    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        setOverscanRows(NORMAL_OVERSCAN_ROWS);
      });
    });

    return () => {
      cancelAnimationFrame(frame1);
      if (frame2) {
        cancelAnimationFrame(frame2);
      }
    };
  }, [activeTabId]);

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
    overscan: overscanRows,
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
    const frameId = requestAnimationFrame(() => {
      const targetScrollTop = tabScrollTopById.get(activeTabId) ?? 0;
      if (targetScrollTop <= 0) {
        didRestoreScrollRef.current = true;
        isRestoringScrollRef.current = false;
        return;
      }

      const currentScrollTop = el.scrollTop;
      if (Math.abs(currentScrollTop - targetScrollTop) <= 2) {
        didRestoreScrollRef.current = true;
        isRestoringScrollRef.current = false;
        setTabScrollTop(activeTabId, currentScrollTop);
        logTabScroll('restore success (initial offset)', {
          tabId: activeTabId,
          scrollTop: currentScrollTop
        });
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

      const restoreStartMs = performance.now();
      rowVirtualizer.scrollToOffset(targetScrollTop, { align: 'start' });
      const actual = el.scrollTop;
      const restored = Math.abs(actual - targetScrollTop) <= 2;
      if (TAB_ACTIVATION_PROFILE_ENABLED && tabActivationProfileRef.current) {
        tabActivationProfileRef.current.restoreCalls += 1;
        tabActivationProfileRef.current.restoreTotalMs +=
          performance.now() - restoreStartMs;
      }
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
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
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

  const virtualItemsStartMs =
    TAB_ACTIVATION_PROFILE_ENABLED && tabActivationProfileRef.current
      ? performance.now()
      : 0;
  const virtualItems = rowVirtualizer.getVirtualItems();
  if (TAB_ACTIVATION_PROFILE_ENABLED && tabActivationProfileRef.current) {
    // Record cost of reading virtual rows from the virtualizer state machine.
    const virtualItemsDurationMs = performance.now() - virtualItemsStartMs;
    tabActivationProfileRef.current.virtualItemsCalls += 1;
    tabActivationProfileRef.current.virtualItemsTotalMs +=
      virtualItemsDurationMs;
  }
  const loadedRows = Math.ceil(images.length / columns);
  const lastVirtualIndex =
    virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1;

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      const measureStartMs = performance.now();
      rowVirtualizer.measure();
      if (TAB_ACTIVATION_PROFILE_ENABLED && tabActivationProfileRef.current) {
        tabActivationProfileRef.current.measureCalls += 1;
        tabActivationProfileRef.current.measureTotalMs +=
          performance.now() - measureStartMs;
      }
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
    if (!TAB_ACTIVATION_PROFILE_ENABLED) {
      return;
    }

    const profile = tabActivationProfileRef.current;
    if (!profile || hasLoggedTabActivationProfileRef.current) {
      return;
    }

    if (!didRestoreScrollRef.current && images.length === 0 && isLoading) {
      return;
    }

    hasLoggedTabActivationProfileRef.current = true;
    const frameId = requestAnimationFrame(() => {
      finalizeTabActivationProfile(profile, {
        imagesLength: images.length,
        totalImages,
        virtualItemsLength: virtualItems.length,
        columns,
        layoutMode
      });
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [
    images.length,
    totalImages,
    virtualItems.length,
    columns,
    layoutMode,
    isLoading
  ]);

  useEffect(() => {
    lastFetchTriggerRowsRef.current = -1;
  }, [activeTabId, searchQuery, sortBy, sortDirection]);

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

  const rowContainerHeight = useMemo(
    () => `${rowVirtualizer.getTotalSize()}px`,
    [rowVirtualizer, virtualItems.length, images.length, columns]
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
          <VirtualizedRows
            rowContainerHeight={rowContainerHeight}
            virtualItems={virtualItems}
            columns={columns}
            images={images}
            selectedImageId={selectedImageId}
            layoutMode={layoutMode}
            draggingImageId={draggingImageId}
            comparePickImageId={comparePickImageId}
            onTileClick={handleTileClick}
            onCompareDragStart={handleCompareDragStart}
            onCompareDragEnd={handleCompareDragEnd}
            onCompareDrop={handleCompareDrop}
            onCompareQuickPick={handleCompareQuickPick}
          />
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

interface VirtualizedRowsProps {
  rowContainerHeight: string;
  virtualItems: ReturnType<
    ReturnType<typeof useVirtualizer>['getVirtualItems']
  >;
  columns: number;
  images: ReturnType<typeof useGalleryStore.getState>['images'];
  selectedImageId: number | null;
  layoutMode: 'compact' | 'comfortable' | 'spacious';
  draggingImageId: number | null;
  comparePickImageId: number | null;
  onTileClick: (imageId: number) => void;
  onCompareDragStart: (imageId: number) => void;
  onCompareDragEnd: () => void;
  onCompareDrop: (sourceId: number, targetId: number) => void;
  onCompareQuickPick: (targetId: number) => void;
}

const VirtualizedRows = memo(function VirtualizedRows({
  rowContainerHeight,
  virtualItems,
  columns,
  images,
  selectedImageId,
  layoutMode,
  draggingImageId,
  comparePickImageId,
  onTileClick,
  onCompareDragStart,
  onCompareDragEnd,
  onCompareDrop,
  onCompareQuickPick
}: VirtualizedRowsProps) {
  return (
    <div
      style={{
        height: rowContainerHeight,
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
              return <div key={`empty-${columnIndex}`} className="flex-1" />;
            }

            return (
              <div key={image.ID} className="flex-1">
                <ImageTile
                  image={image}
                  isSelected={selectedImageId === image.ID}
                  onClick={onTileClick}
                  layoutMode={layoutMode}
                  draggingImageId={draggingImageId}
                  isCompareDragging={draggingImageId !== null}
                  isCompareDragSource={draggingImageId === image.ID}
                  onCompareDragStart={onCompareDragStart}
                  onCompareDragEnd={onCompareDragEnd}
                  onCompareDrop={onCompareDrop}
                  isCompareQuickSource={comparePickImageId === image.ID}
                  onCompareQuickPick={onCompareQuickPick}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
});
