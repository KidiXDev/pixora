import { isPageTabPath } from '@/lib/tab-pages';
import { create } from 'zustand';
import { ImageRecord } from '../../bindings/pixora/internal/db/models';
import { GetImages } from '../../bindings/pixora/internal/services/galleryservice';
import { useTabsStore } from './tabs-store';

type LayoutMode = 'compact' | 'comfortable' | 'spacious';

let latestFetchRequestId = 0;
let inFlightNextPageKey: string | null = null;
const MAX_TAB_SNAPSHOT_ENTRIES = 8;

interface ActiveTabContext {
  tabId: string;
  folderPath: string;
}

interface GalleryTabSnapshot {
  images: ImageRecord[];
  totalImages: number;
  selectedImageId: number | null;
  compareImageIds: [number, number] | null;
  compareSlider: number;
  offset: number;
  hasMore: boolean;
}

const tabSnapshots = new Map<string, GalleryTabSnapshot>();

function getSnapshot(key: string): GalleryTabSnapshot | null {
  const snapshot = tabSnapshots.get(key);
  if (!snapshot) {
    return null;
  }

  // Keep most recently used snapshots alive and evict stale ones first.
  tabSnapshots.delete(key);
  tabSnapshots.set(key, snapshot);
  return snapshot;
}

function setSnapshot(key: string, snapshot: GalleryTabSnapshot): void {
  if (tabSnapshots.has(key)) {
    tabSnapshots.delete(key);
  }

  tabSnapshots.set(key, snapshot);

  while (tabSnapshots.size > MAX_TAB_SNAPSHOT_ENTRIES) {
    const oldestKey = tabSnapshots.keys().next().value;
    if (typeof oldestKey !== 'string') {
      break;
    }

    tabSnapshots.delete(oldestKey);
  }
}

function buildTabSnapshotKey(tabId: string, query: string): string {
  return `${tabId}|${query}`;
}

function getActiveTabContext(): ActiveTabContext | null {
  const { tabs, activeTabId } = useTabsStore.getState();
  if (!activeTabId) {
    return null;
  }

  const activeTab = tabs?.find((t) => t.id === activeTabId);
  return {
    tabId: activeTabId,
    folderPath: typeof activeTab?.path === 'string' ? activeTab.path : ''
  };
}

function buildNextPageRequestKey(
  tabId: string,
  folderPath: string,
  query: string,
  offset: number,
  limit: number
): string {
  return `${tabId}|${folderPath}|${query}|${offset}|${limit}`;
}

function toSnapshot(state: GalleryState): GalleryTabSnapshot {
  return {
    images: state.images,
    totalImages: state.totalImages,
    selectedImageId: state.selectedImageId,
    compareImageIds: state.compareImageIds,
    compareSlider: state.compareSlider,
    offset: state.offset,
    hasMore: state.hasMore
  };
}

interface GalleryState {
  images: ImageRecord[];
  totalImages: number;
  searchQuery: string;
  selectedImageId: number | null;
  compareImageIds: [number, number] | null;
  compareSlider: number;
  layoutMode: LayoutMode;
  offset: number;
  limit: number;
  hasMore: boolean;
  isLoading: boolean;

  setImages: (images: ImageRecord[], total: number) => void;
  setSearchQuery: (query: string) => void;
  setSelectedImageId: (id: number | null) => void;
  setCompareSlider: (value: number) => void;
  startCompare: (firstId: number, secondId: number) => void;
  closeCompare: () => void;
  swapCompareImages: () => void;
  setLayoutMode: (mode: LayoutMode) => void;
  updateImageRecord: (image: ImageRecord) => void;
  pruneTabScopedState: (tabIds: string[]) => void;
  fetchImages: (clear?: boolean) => Promise<void>;
  fetchNextPage: () => Promise<void>;
}

export const useGalleryStore = create<GalleryState>((set, get) => ({
  images: [],
  totalImages: 0,
  searchQuery: '',
  selectedImageId: null,
  compareImageIds: null,
  compareSlider: 50,
  layoutMode: 'comfortable',
  offset: 0,
  limit: 100,
  hasMore: true,
  isLoading: false,

  setImages: (images, total) =>
    set({ images, totalImages: total, hasMore: images.length < total }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSelectedImageId: (selectedImageId) =>
    set({
      selectedImageId,
      ...(selectedImageId !== null
        ? { compareImageIds: null, compareSlider: 50 }
        : {})
    }),
  setCompareSlider: (value) => {
    const next = Math.max(0, Math.min(100, value));
    set({ compareSlider: next });
  },
  startCompare: (firstId, secondId) => {
    if (firstId === secondId) return;

    set({
      selectedImageId: null,
      compareImageIds: [firstId, secondId],
      compareSlider: 50
    });
  },
  closeCompare: () => set({ compareImageIds: null, compareSlider: 50 }),
  swapCompareImages: () => {
    const compareImageIds = get().compareImageIds;
    if (!compareImageIds) return;

    set({ compareImageIds: [compareImageIds[1], compareImageIds[0]] });
  },
  setLayoutMode: (layoutMode) => set({ layoutMode }),
  updateImageRecord: (image) =>
    set((state) => ({
      images: state.images.map((img) => (img.ID === image.ID ? image : img))
    })),
  pruneTabScopedState: (tabIds) => {
    const validTabIds = new Set(tabIds);
    for (const key of tabSnapshots.keys()) {
      const [tabId] = key.split('|');
      if (!validTabIds.has(tabId)) {
        tabSnapshots.delete(key);
      }
    }
  },

  fetchImages: async (clear = false) => {
    const { searchQuery, limit, isLoading } = get();
    // Don't fetch if already loading unless clearing
    if (isLoading && !clear) return;

    const activeContext = getActiveTabContext();
    if (!activeContext || !activeContext.folderPath) {
      set({
        images: [],
        totalImages: 0,
        selectedImageId: null,
        compareImageIds: null,
        compareSlider: 50,
        isLoading: false,
        hasMore: false
      });
      return;
    }

    const { tabId, folderPath } = activeContext;

    if (isPageTabPath(folderPath)) {
      set({
        images: [],
        totalImages: 0,
        selectedImageId: null,
        compareImageIds: null,
        compareSlider: 50,
        isLoading: false,
        hasMore: false
      });
      return;
    }

    const safeQuery = typeof searchQuery === 'string' ? searchQuery : '';
    const safeLimit = Number.isFinite(limit) ? limit : 100;
    const tabSnapshotKey = buildTabSnapshotKey(tabId, safeQuery);

    if (clear) {
      const cachedSnapshot = getSnapshot(tabSnapshotKey);
      if (cachedSnapshot) {
        set({
          ...cachedSnapshot,
          isLoading: false
        });
        return;
      }
    }

    const requestId = ++latestFetchRequestId;

    set({
      isLoading: true,
      ...(clear
        ? {
            images: [],
            totalImages: 0,
            selectedImageId: null,
            compareImageIds: null,
            compareSlider: 50,
            offset: 0,
            hasMore: true
          }
        : {})
    });
    try {
      const res = await GetImages(safeQuery, folderPath, 0, safeLimit);
      if (requestId !== latestFetchRequestId) {
        return;
      }

      const currentContext = getActiveTabContext();
      if (!currentContext || currentContext.tabId !== tabId) {
        return;
      }

      if (res) {
        const nextState = {
          images: (res.images as ImageRecord[]) || [],
          totalImages: res.totalCount || 0,
          offset: 0,
          hasMore: (res.images?.length || 0) < (res.totalCount || 0),
          isLoading: false
        };
        set(nextState);
        setSnapshot(tabSnapshotKey, {
          images: nextState.images,
          totalImages: nextState.totalImages,
          selectedImageId: null,
          compareImageIds: null,
          compareSlider: 50,
          offset: nextState.offset,
          hasMore: nextState.hasMore
        });
      } else {
        set({ isLoading: false });
      }
    } catch (e) {
      if (requestId !== latestFetchRequestId) {
        return;
      }

      console.error('Failed to fetch images:', e);
      set({ isLoading: false });
    }
  },

  fetchNextPage: async () => {
    const { searchQuery, offset, limit, isLoading, hasMore } = get();
    if (isLoading || !hasMore) return;

    const activeContext = getActiveTabContext();
    if (!activeContext || !activeContext.folderPath) return;

    const { tabId, folderPath } = activeContext;

    if (isPageTabPath(folderPath)) {
      set({ isLoading: false, hasMore: false });
      return;
    }

    const safeQuery = typeof searchQuery === 'string' ? searchQuery : '';
    const safeLimit = Number.isFinite(limit) ? limit : 100;

    const nextOffset = offset + safeLimit;
    const requestKey = buildNextPageRequestKey(
      tabId,
      folderPath,
      safeQuery,
      nextOffset,
      safeLimit
    );
    if (inFlightNextPageKey === requestKey) return;
    inFlightNextPageKey = requestKey;

    set({ isLoading: true });
    try {
      const res = await GetImages(safeQuery, folderPath, nextOffset, safeLimit);
      const currentContext = getActiveTabContext();
      const currentSearchQuery = get().searchQuery;
      if (
        !currentContext ||
        currentContext.tabId !== tabId ||
        currentSearchQuery !== safeQuery
      ) {
        return;
      }

      if (res) {
        const incoming = (res.images as ImageRecord[]) || [];
        set((state) => {
          const existingIds = new Set(state.images.map((img) => img.ID));
          const dedupedIncoming = incoming.filter(
            (img) => !existingIds.has(img.ID)
          );
          const mergedImages = [...state.images, ...dedupedIncoming];
          const totalCount = res.totalCount || 0;

          return {
            images: mergedImages,
            totalImages: totalCount,
            offset: nextOffset,
            hasMore: mergedImages.length < totalCount,
            isLoading: false
          };
        });
        setSnapshot(buildTabSnapshotKey(tabId, safeQuery), toSnapshot(get()));
      } else {
        set({ isLoading: false });
      }
    } catch (e) {
      console.error('Failed to fetch next page:', e);
      set({ isLoading: false });
    } finally {
      if (inFlightNextPageKey === requestKey) {
        inFlightNextPageKey = null;
      }
    }
  }
}));
