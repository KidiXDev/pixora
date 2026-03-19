import { isPageTabPath } from '@/lib/tab-pages';
import { create } from 'zustand';
import { ImageRecord } from '../../bindings/pixora/internal/db/models';
import {
  BrowseFolder,
  GetImages
} from '../../bindings/pixora/internal/services/galleryservice';
import { useTabsStore } from './tabs-store';

type LayoutMode = 'compact' | 'comfortable' | 'spacious';
export type GallerySortBy = 'created' | 'modified' | 'name' | 'size';
export type GallerySortDirection = 'asc' | 'desc';

export interface FolderEntry {
  name: string;
  path: string;
}

interface FolderBrowseResponse {
  rootPath: string;
  currentPath: string;
  parentPath: string;
  folders: FolderEntry[];
  images: ImageRecord[];
  totalCount: number;
  offset: number;
  limit: number;
}

const GALLERY_SORT_STORAGE_KEY = 'pixora:gallery-sort-preferences';
const TAB_FOLDER_STORAGE_KEY = 'pixora:tab-folder-path';
const DEFAULT_GALLERY_SORT_BY: GallerySortBy = 'modified';
const DEFAULT_GALLERY_SORT_DIRECTION: GallerySortDirection = 'desc';
const MAX_TAB_SNAPSHOT_ENTRIES = 12;

let latestFetchRequestId = 0;
let inFlightNextPageKey: string | null = null;
let persistTabFolderTimer: ReturnType<typeof setTimeout> | null = null;

interface ActiveTabContext {
  tabId: string;
  rootPath: string;
  isWalk: boolean;
}

interface GalleryTabSnapshot {
  rootFolderPath: string;
  currentFolderPath: string;
  parentFolderPath: string;
  folders: FolderEntry[];
  images: ImageRecord[];
  totalImages: number;
  selectedImageId: number | null;
  compareImageIds: [number, number] | null;
  compareSlider: number;
  offset: number;
  hasMore: boolean;
}

const tabSnapshots = new Map<string, GalleryTabSnapshot>();

const tabFolderPathById = readPersistedTabFolderPaths();

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

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return '';
  }

  const sep = trimmed.includes('\\') ? '\\' : '/';
  const splitPattern = /[/\\]+/;
  const root = /^[A-Za-z]:/.test(trimmed) ? trimmed.slice(0, 2) : '';
  const tail = root ? trimmed.slice(2) : trimmed;
  const parts = tail.split(splitPattern).filter((part) => part.length > 0);
  const joined = parts.join(sep);

  return root ? `${root}${sep}${joined}` : `${sep}${joined}`;
}

function pathWithinRoot(path: string, root: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root);
  if (!normalizedPath || !normalizedRoot) {
    return false;
  }

  if (normalizedPath === normalizedRoot) {
    return true;
  }

  const rootWithSep =
    normalizedRoot.endsWith('\\') || normalizedRoot.endsWith('/')
      ? normalizedRoot
      : `${normalizedRoot}${normalizedRoot.includes('\\') ? '\\' : '/'}`;

  return normalizedPath.startsWith(rootWithSep);
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = normalizePath(left);
  const normalizedRight = normalizePath(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
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

function readPersistedTabFolderPaths(): Map<string, string> {
  if (typeof window === 'undefined') {
    return new Map<string, string>();
  }

  try {
    const raw = window.localStorage.getItem(TAB_FOLDER_STORAGE_KEY);
    if (!raw) {
      return new Map<string, string>();
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return new Map<string, string>();
    }

    const entries = Object.entries(parsed as Record<string, unknown>)
      .map(([tabId, value]) => {
        const path = typeof value === 'string' ? normalizePath(value) : '';
        return [tabId, path] as const;
      })
      .filter((entry) => entry[1].length > 0);

    return new Map<string, string>(entries);
  } catch {
    return new Map<string, string>();
  }
}

function queuePersistTabFolderPaths(): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (persistTabFolderTimer) {
    clearTimeout(persistTabFolderTimer);
  }

  persistTabFolderTimer = setTimeout(() => {
    persistTabFolderTimer = null;
    try {
      const serialized = Object.fromEntries(tabFolderPathById.entries());
      window.localStorage.setItem(
        TAB_FOLDER_STORAGE_KEY,
        JSON.stringify(serialized)
      );
    } catch {}
  }, 120);
}

function setPersistedTabFolderPath(tabId: string, path: string): void {
  if (!tabId) {
    return;
  }

  const normalizedPath = normalizePath(path);
  if (!normalizedPath) {
    if (tabFolderPathById.delete(tabId)) {
      queuePersistTabFolderPaths();
    }
    return;
  }

  const current = tabFolderPathById.get(tabId);
  if (current === normalizedPath) {
    return;
  }

  tabFolderPathById.set(tabId, normalizedPath);
  queuePersistTabFolderPaths();
}

function getPersistedTabFolderPath(tabId: string): string {
  return tabFolderPathById.get(tabId) || '';
}

function prunePersistedTabFolderPaths(validTabIds: Set<string>): void {
  let changed = false;
  for (const tabId of tabFolderPathById.keys()) {
    if (!validTabIds.has(tabId)) {
      tabFolderPathById.delete(tabId);
      changed = true;
    }
  }

  if (changed) {
    queuePersistTabFolderPaths();
  }
}

function getActiveTabContext(): ActiveTabContext | null {
  const { tabs, activeTabId } = useTabsStore.getState();
  if (!activeTabId) {
    return null;
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const rootPath = typeof activeTab?.path === 'string' ? activeTab.path : '';

  return {
    tabId: activeTabId,
    rootPath: normalizePath(rootPath),
    isWalk: Boolean(activeTab?.isWalk)
  };
}

function buildTabSnapshotKey(
  tabId: string,
  isWalk: boolean,
  currentFolderPath: string,
  query: string,
  sortBy: GallerySortBy,
  sortDirection: GallerySortDirection
): string {
  return `${tabId}|${isWalk ? 'walk' : 'normal'}|${currentFolderPath}|${query}|${sortBy}|${sortDirection}`;
}

function buildNextPageRequestKey(
  tabId: string,
  isWalk: boolean,
  rootPath: string,
  currentPath: string,
  query: string,
  sortBy: GallerySortBy,
  sortDirection: GallerySortDirection,
  offset: number,
  limit: number
): string {
  return `${tabId}|${isWalk ? 'walk' : 'normal'}|${rootPath}|${currentPath}|${query}|${sortBy}|${sortDirection}|${offset}|${limit}`;
}

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

function toSnapshot(state: GalleryState): GalleryTabSnapshot {
  return {
    rootFolderPath: state.rootFolderPath,
    currentFolderPath: state.currentFolderPath,
    parentFolderPath: state.parentFolderPath,
    folders: state.folders,
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
  rootFolderPath: string;
  currentFolderPath: string;
  parentFolderPath: string;
  folders: FolderEntry[];
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
  navigateToFolder: (path: string) => Promise<void>;
  navigateToParentFolder: () => Promise<void>;
  setCurrentFolderPath: (path: string) => void;
  fetchImages: (clear?: boolean) => Promise<void>;
  fetchNextPage: () => Promise<void>;
}

const persistedSortPreferences = readPersistedGallerySortPreferences();

export const useGalleryStore = create<GalleryState>((set, get) => ({
  rootFolderPath: '',
  currentFolderPath: '',
  parentFolderPath: '',
  folders: [],
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
  hasMore: false,
  isLoading: false,

  setImages: (images, total) =>
    set({
      folders: [],
      images,
      totalImages: total,
      hasMore: images.length < total
    }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSortBy: (sortBy) => {
    persistGallerySortPreferences(sortBy, get().sortDirection);
    set({ sortBy });
  },
  setSortDirection: (sortDirection) => {
    persistGallerySortPreferences(get().sortBy, sortDirection);
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
    if (!compareImageIds) {
      return;
    }

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

    prunePersistedTabFolderPaths(validTabIds);
  },

  setCurrentFolderPath: (path) => {
    const normalizedTarget = normalizePath(path);
    const root = get().rootFolderPath;
    if (!normalizedTarget || !root || !pathWithinRoot(normalizedTarget, root)) {
      return;
    }

    set({
      currentFolderPath: normalizedTarget,
      selectedImageId: null,
      compareImageIds: null,
      compareSlider: 50
    });

    const activeContext = getActiveTabContext();
    if (activeContext && !activeContext.isWalk) {
      setPersistedTabFolderPath(activeContext.tabId, normalizedTarget);
    }
  },

  navigateToFolder: async (path) => {
    const normalizedPath = normalizePath(path);
    const root = get().rootFolderPath;
    if (!normalizedPath || !root || !pathWithinRoot(normalizedPath, root)) {
      return;
    }

    set({
      currentFolderPath: normalizedPath,
      selectedImageId: null,
      compareImageIds: null,
      compareSlider: 50
    });

    const activeContext = getActiveTabContext();
    if (activeContext && !activeContext.isWalk) {
      setPersistedTabFolderPath(activeContext.tabId, normalizedPath);
    }

    await get().fetchImages(true);
  },

  navigateToParentFolder: async () => {
    const { parentFolderPath, rootFolderPath } = get();
    const nextPath = parentFolderPath || rootFolderPath;
    if (!nextPath) {
      return;
    }

    await get().navigateToFolder(nextPath);
  },

  hydrateActiveTabSnapshot: () => {
    const activeContext = getActiveTabContext();
    if (!activeContext || !activeContext.rootPath) {
      set({
        rootFolderPath: '',
        currentFolderPath: '',
        parentFolderPath: '',
        folders: [],
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

    const { tabId, rootPath, isWalk } = activeContext;
    if (isPageTabPath(rootPath)) {
      set({
        rootFolderPath: rootPath,
        currentFolderPath: rootPath,
        parentFolderPath: '',
        folders: [],
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

    const { searchQuery, sortBy, sortDirection } = get();
    const safeQuery = typeof searchQuery === 'string' ? searchQuery : '';
    const persistedCurrentPath = getPersistedTabFolderPath(tabId);
    const currentState = get();
    const canReuseStateCurrentPath =
      samePath(currentState.rootFolderPath, rootPath) &&
      pathWithinRoot(currentState.currentFolderPath, rootPath) &&
      currentState.currentFolderPath.length > 0;
    const preferredCurrentPath = isWalk
      ? rootPath
      : canReuseStateCurrentPath
        ? currentState.currentFolderPath
        : pathWithinRoot(persistedCurrentPath, rootPath)
          ? persistedCurrentPath
          : rootPath;

    const snapshotKey = buildTabSnapshotKey(
      tabId,
      isWalk,
      preferredCurrentPath,
      safeQuery,
      sortBy,
      sortDirection
    );
    const snapshot = getSnapshot(snapshotKey);

    if (snapshot) {
      set({ ...snapshot, isLoading: false });
      if (!isWalk) {
        setPersistedTabFolderPath(
          tabId,
          snapshot.currentFolderPath || rootPath
        );
      }
      return true;
    }

    set({
      rootFolderPath: rootPath,
      currentFolderPath: rootPath,
      parentFolderPath: '',
      folders: [],
      images: [],
      totalImages: 0,
      selectedImageId: null,
      compareImageIds: null,
      compareSlider: 50,
      offset: 0,
      isLoading: false,
      hasMore: false
    });

    if (!isWalk) {
      setPersistedTabFolderPath(tabId, rootPath);
    }

    return false;
  },

  fetchImages: async (clear = false) => {
    const { searchQuery, limit, isLoading, sortBy, sortDirection } = get();
    if (isLoading && !clear) {
      return;
    }

    const activeContext = getActiveTabContext();
    if (!activeContext || !activeContext.rootPath) {
      set({
        rootFolderPath: '',
        currentFolderPath: '',
        parentFolderPath: '',
        folders: [],
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

    const { tabId, rootPath, isWalk } = activeContext;
    if (isPageTabPath(rootPath)) {
      set({
        rootFolderPath: rootPath,
        currentFolderPath: rootPath,
        parentFolderPath: '',
        folders: [],
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
    const currentState = get();
    const currentStateCurrentPath = currentState.currentFolderPath;
    const persistedCurrentPath = getPersistedTabFolderPath(tabId);
    const canReuseStateCurrentPath =
      samePath(currentState.rootFolderPath, rootPath) &&
      pathWithinRoot(currentStateCurrentPath, rootPath) &&
      currentStateCurrentPath.length > 0;
    const requestedCurrentPath = isWalk
      ? rootPath
      : canReuseStateCurrentPath
        ? currentStateCurrentPath
        : pathWithinRoot(persistedCurrentPath, rootPath)
          ? persistedCurrentPath
          : rootPath;

    const snapshotKey = buildTabSnapshotKey(
      tabId,
      isWalk,
      requestedCurrentPath,
      safeQuery,
      sortBy,
      sortDirection
    );

    if (clear) {
      tabSnapshots.delete(snapshotKey);
    }

    const requestId = ++latestFetchRequestId;

    set({
      rootFolderPath: rootPath,
      currentFolderPath: requestedCurrentPath,
      isLoading: true,
      ...(clear
        ? {
            parentFolderPath: '',
            folders: [],
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
      if (isWalk) {
        const response = await GetImages(
          safeQuery,
          rootPath,
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

        if (!response) {
          set({ isLoading: false });
          return;
        }

        const nextState = {
          rootFolderPath: rootPath,
          currentFolderPath: rootPath,
          parentFolderPath: '',
          folders: [] as FolderEntry[],
          images: (response.images || []) as ImageRecord[],
          totalImages: response.totalCount || 0,
          offset: 0,
          hasMore: (response.images?.length || 0) < (response.totalCount || 0),
          isLoading: false
        };

        set(nextState);
        setPersistedTabFolderPath(tabId, rootPath);
        setSnapshot(snapshotKey, {
          ...toSnapshot(get()),
          ...nextState
        });
        return;
      }

      const response = (await BrowseFolder(
        safeQuery,
        rootPath,
        requestedCurrentPath,
        0,
        safeLimit,
        sortBy,
        sortDirection
      )) as FolderBrowseResponse | null;

      if (requestId !== latestFetchRequestId) {
        return;
      }

      const currentContext = getActiveTabContext();
      if (!currentContext || currentContext.tabId !== tabId) {
        return;
      }

      if (!response) {
        set({ isLoading: false });
        return;
      }

      const nextState = {
        rootFolderPath: normalizePath(response.rootPath || rootPath),
        currentFolderPath: normalizePath(
          response.currentPath || requestedCurrentPath
        ),
        parentFolderPath: normalizePath(response.parentPath || ''),
        folders: (response.folders || []) as FolderEntry[],
        images: (response.images || []) as ImageRecord[],
        totalImages: response.totalCount || 0,
        offset: 0,
        hasMore: (response.images?.length || 0) < (response.totalCount || 0),
        isLoading: false
      };

      set(nextState);
      setPersistedTabFolderPath(tabId, nextState.currentFolderPath || rootPath);
      setSnapshot(snapshotKey, {
        ...toSnapshot(get()),
        ...nextState
      });
    } catch (error) {
      if (requestId !== latestFetchRequestId) {
        return;
      }

      console.error('Failed to browse folder:', error);
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
      sortDirection,
      currentFolderPath
    } = get();
    if (isLoading || !hasMore) {
      return;
    }

    const activeContext = getActiveTabContext();
    if (!activeContext || !activeContext.rootPath) {
      return;
    }

    const { tabId, rootPath, isWalk } = activeContext;
    if (isPageTabPath(rootPath)) {
      set({ isLoading: false, hasMore: false });
      return;
    }

    const safeQuery = typeof searchQuery === 'string' ? searchQuery : '';
    const safeLimit = Number.isFinite(limit) ? limit : 100;
    const effectiveCurrentPath =
      pathWithinRoot(currentFolderPath, rootPath) &&
      currentFolderPath.length > 0
        ? currentFolderPath
        : rootPath;

    const nextOffset = offset + safeLimit;
    const requestKey = buildNextPageRequestKey(
      tabId,
      isWalk,
      rootPath,
      effectiveCurrentPath,
      safeQuery,
      sortBy,
      sortDirection,
      nextOffset,
      safeLimit
    );
    if (inFlightNextPageKey === requestKey) {
      return;
    }
    inFlightNextPageKey = requestKey;

    set({ isLoading: true });
    try {
      if (isWalk) {
        const response = await GetImages(
          safeQuery,
          rootPath,
          nextOffset,
          safeLimit,
          sortBy,
          sortDirection
        );

        const currentContext = getActiveTabContext();
        if (!currentContext || currentContext.tabId !== tabId) {
          return;
        }

        if (!response) {
          set({ isLoading: false });
          return;
        }

        set((state) => {
          const existingIds = new Set(state.images.map((img) => img.ID));
          const incoming = (response.images || []) as ImageRecord[];
          const dedupedIncoming = incoming.filter(
            (img) => !existingIds.has(img.ID)
          );
          const mergedImages = [...state.images, ...dedupedIncoming];
          const totalCount = response.totalCount || 0;

          return {
            rootFolderPath: rootPath,
            currentFolderPath: rootPath,
            parentFolderPath: '',
            folders: [] as FolderEntry[],
            images: mergedImages,
            totalImages: totalCount,
            offset: nextOffset,
            hasMore: mergedImages.length < totalCount,
            isLoading: false
          };
        });

        setSnapshot(
          buildTabSnapshotKey(
            tabId,
            isWalk,
            rootPath,
            safeQuery,
            sortBy,
            sortDirection
          ),
          toSnapshot(get())
        );
        setPersistedTabFolderPath(tabId, rootPath);
        return;
      }

      const response = (await BrowseFolder(
        safeQuery,
        rootPath,
        effectiveCurrentPath,
        nextOffset,
        safeLimit,
        sortBy,
        sortDirection
      )) as FolderBrowseResponse | null;

      const currentContext = getActiveTabContext();
      if (!currentContext || currentContext.tabId !== tabId) {
        return;
      }

      if (!response) {
        set({ isLoading: false });
        return;
      }

      set((state) => {
        const existingIds = new Set(state.images.map((img) => img.ID));
        const incoming = (response.images || []) as ImageRecord[];
        const dedupedIncoming = incoming.filter(
          (img) => !existingIds.has(img.ID)
        );
        const mergedImages = [...state.images, ...dedupedIncoming];
        const totalCount = response.totalCount || 0;

        return {
          rootFolderPath: normalizePath(response.rootPath || rootPath),
          currentFolderPath: normalizePath(
            response.currentPath || effectiveCurrentPath
          ),
          parentFolderPath: normalizePath(response.parentPath || ''),
          folders: (response.folders || []) as FolderEntry[],
          images: mergedImages,
          totalImages: totalCount,
          offset: nextOffset,
          hasMore: mergedImages.length < totalCount,
          isLoading: false
        };
      });

      setSnapshot(
        buildTabSnapshotKey(
          tabId,
          isWalk,
          effectiveCurrentPath,
          safeQuery,
          sortBy,
          sortDirection
        ),
        toSnapshot(get())
      );
      setPersistedTabFolderPath(
        tabId,
        normalizePath(response.currentPath || effectiveCurrentPath || rootPath)
      );
    } catch (error) {
      console.error('Failed to fetch next folder page:', error);
      set({ isLoading: false });
    } finally {
      if (inFlightNextPageKey === requestKey) {
        inFlightNextPageKey = null;
      }
    }
  }
}));
