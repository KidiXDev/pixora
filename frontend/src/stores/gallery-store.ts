import { isPageTabPath } from '@/lib/tab-pages';
import { create } from 'zustand';
import { ImageRecord } from '../../bindings/pixora/internal/db/models';
import { GetImages } from '../../bindings/pixora/internal/services/galleryservice';
import { useTabsStore } from './tabs-store';

type LayoutMode = 'compact' | 'comfortable' | 'spacious';
export type GallerySortBy = 'created' | 'modified' | 'name' | 'size';
export type GallerySortDirection = 'asc' | 'desc';

const GALLERY_SORT_STORAGE_KEY = 'pixora:gallery-sort-preferences';

const DEFAULT_GALLERY_SORT_BY: GallerySortBy = 'modified';
const DEFAULT_GALLERY_SORT_DIRECTION: GallerySortDirection = 'desc';

function isGallerySortBy(value: unknown): value is GallerySortBy {
  return (
    value === 'created' ||
    value === 'modified' ||
    value === 'name' ||
    value === 'size'
  );
}

function isGallerySortDirection(value: unknown): value is GallerySortDirection {
  return value === 'asc' || value === 'desc';
}

function readPersistedGallerySortPreferences(): {
  sortBy: GallerySortBy;
  sortDirection: GallerySortDirection;
} {
  if (typeof window === 'undefined') {
    return {
      sortBy: DEFAULT_GALLERY_SORT_BY,
      sortDirection: DEFAULT_GALLERY_SORT_DIRECTION
    };
  }

  try {
    const raw = window.localStorage.getItem(GALLERY_SORT_STORAGE_KEY);
    if (!raw) {
      return {
        sortBy: DEFAULT_GALLERY_SORT_BY,
        sortDirection: DEFAULT_GALLERY_SORT_DIRECTION
      };
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {
        sortBy: DEFAULT_GALLERY_SORT_BY,
        sortDirection: DEFAULT_GALLERY_SORT_DIRECTION
      };
    }

    const parsedRecord = parsed as Record<string, unknown>;
    const sortBy = isGallerySortBy(parsedRecord.sortBy)
      ? parsedRecord.sortBy
      : DEFAULT_GALLERY_SORT_BY;
    const sortDirection = isGallerySortDirection(parsedRecord.sortDirection)
      ? parsedRecord.sortDirection
      : DEFAULT_GALLERY_SORT_DIRECTION;

    return { sortBy, sortDirection };
  } catch {
    return {
      sortBy: DEFAULT_GALLERY_SORT_BY,
      sortDirection: DEFAULT_GALLERY_SORT_DIRECTION
    };
  }
}

function persistGallerySortPreferences(
  sortBy: GallerySortBy,
  sortDirection: GallerySortDirection
): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      GALLERY_SORT_STORAGE_KEY,
      JSON.stringify({ sortBy, sortDirection })
    );
  } catch {}
}

const persistedSortPreferences = readPersistedGallerySortPreferences();

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

function buildTabSnapshotKey(
  tabId: string,
  query: string,
  sortBy: GallerySortBy,
  sortDirection: GallerySortDirection
): string {
  return `${tabId}|${query}|${sortBy}|${sortDirection}`;
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
  sortBy: GallerySortBy,
  sortDirection: GallerySortDirection,
  offset: number,
  limit: number
): string {
  return `${tabId}|${folderPath}|${query}|${sortBy}|${sortDirection}|${offset}|${limit}`;
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
  sortBy: GallerySortBy;
  sortDirection: GallerySortDirection;
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
  setSortBy: (sortBy: GallerySortBy) => void;
  setSortDirection: (direction: GallerySortDirection) => void;
  setSelectedImageId: (id: number | null) => void;
  setCompareSlider: (value: number) => void;
  startCompare: (firstId: number, secondId: number) => void;
  closeCompare: () => void;
  swapCompareImages: () => void;
  setLayoutMode: (mode: LayoutMode) => void;
  updateImageRecord: (image: ImageRecord) => void;
  pruneTabScopedState: (tabIds: string[]) => void;
  hydrateActiveTabSnapshot: () => boolean;
  fetchImages: (clear?: boolean) => Promise<void>;
  fetchNextPage: () => Promise<void>;
}

export const useGalleryStore = create<GalleryState>((set, get) => ({
  images: [],
  totalImages: 0,
  searchQuery: '',
  sortBy: persistedSortPreferences.sortBy,
  sortDirection: persistedSortPreferences.sortDirection,
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
  setSortBy: (sortBy) => {
    const nextDirection = get().sortDirection;
    persistGallerySortPreferences(sortBy, nextDirection);
    set({ sortBy });
  },
  setSortDirection: (sortDirection) => {
    const nextSortBy = get().sortBy;
    persistGallerySortPreferences(nextSortBy, sortDirection);
    set({ sortDirection });
  },
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

  hydrateActiveTabSnapshot: () => {
    const { searchQuery, sortBy, sortDirection } = get();
    const activeContext = getActiveTabContext();
    if (!activeContext || !activeContext.folderPath) {
      set({
        images: [],
        totalImages: 0,
        selectedImageId: null,
        compareImageIds: null,
        compareSlider: 50,
        offset: 0,
        isLoading: false,
        hasMore: false
      });
      return false;
    }

    const { tabId, folderPath } = activeContext;
    if (isPageTabPath(folderPath)) {
      set({
        images: [],
        totalImages: 0,
        selectedImageId: null,
        compareImageIds: null,
        compareSlider: 50,
        offset: 0,
        isLoading: false,
        hasMore: false
      });
      return false;
    }

    const safeQuery = typeof searchQuery === 'string' ? searchQuery : '';
    const tabSnapshotKey = buildTabSnapshotKey(
      tabId,
      safeQuery,
      sortBy,
      sortDirection
    );
    const cachedSnapshot = getSnapshot(tabSnapshotKey);

    if (cachedSnapshot) {
      set({
        ...cachedSnapshot,
        isLoading: false
      });
      return true;
    }

    set({
      images: [],
      totalImages: 0,
      selectedImageId: null,
      compareImageIds: null,
      compareSlider: 50,
      offset: 0,
      isLoading: false,
      hasMore: false
    });
    return false;
  },

  fetchImages: async (clear = false) => {
    const { searchQuery, limit, isLoading, sortBy, sortDirection } = get();
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
    const tabSnapshotKey = buildTabSnapshotKey(
      tabId,
      safeQuery,
      sortBy,
      sortDirection
    );

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
      const res = await GetImages(
        safeQuery,
        folderPath,
        0,
        safeLimit,
        sortBy,
        sortDirection
      );
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
    const {
      searchQuery,
      offset,
      limit,
      isLoading,
      hasMore,
      sortBy,
      sortDirection
    } = get();
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
      sortBy,
      sortDirection,
      nextOffset,
      safeLimit
    );
    if (inFlightNextPageKey === requestKey) return;
    inFlightNextPageKey = requestKey;

    set({ isLoading: true });
    try {
      const res = await GetImages(
        safeQuery,
        folderPath,
        nextOffset,
        safeLimit,
        sortBy,
        sortDirection
      );
      const currentContext = getActiveTabContext();
      const currentSearchQuery = get().searchQuery;
      const currentSortBy = get().sortBy;
      const currentSortDirection = get().sortDirection;
      if (
        !currentContext ||
        currentContext.tabId !== tabId ||
        currentSearchQuery !== safeQuery ||
        currentSortBy !== sortBy ||
        currentSortDirection !== sortDirection
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
        setSnapshot(
          buildTabSnapshotKey(tabId, safeQuery, sortBy, sortDirection),
          toSnapshot(get())
        );
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
