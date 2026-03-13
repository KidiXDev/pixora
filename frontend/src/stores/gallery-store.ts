import { create } from 'zustand';
import { ImageRecord } from '../../bindings/pixora/internal/db/models';
import { GetImages } from '../../bindings/pixora/internal/services/galleryservice';
import { useTabsStore } from './tabs-store';

type LayoutMode = 'compact' | 'comfortable' | 'spacious';

interface GalleryState {
  images: ImageRecord[];
  totalImages: number;
  searchQuery: string;
  selectedImageId: number | null;
  layoutMode: LayoutMode;
  offset: number;
  limit: number;
  hasMore: boolean;
  isLoading: boolean;

  setImages: (images: ImageRecord[], total: number) => void;
  setSearchQuery: (query: string) => void;
  setSelectedImageId: (id: number | null) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  fetchImages: (clear?: boolean) => Promise<void>;
  fetchNextPage: () => Promise<void>;
}

export const useGalleryStore = create<GalleryState>((set, get) => ({
  images: [],
  totalImages: 0,
  searchQuery: '',
  selectedImageId: null,
  layoutMode: 'comfortable',
  offset: 0,
  limit: 100,
  hasMore: true,
  isLoading: false,

  setImages: (images, total) =>
    set({ images, totalImages: total, hasMore: images.length < total }),
  setSearchQuery: (searchQuery) => {
    set({ searchQuery });
    get().fetchImages(true);
  },
  setSelectedImageId: (selectedImageId) => set({ selectedImageId }),
  setLayoutMode: (layoutMode) => set({ layoutMode }),

  fetchImages: async (clear = false) => {
    const { searchQuery, limit, isLoading } = get();
    // Don't fetch if already loading unless clearing
    if (isLoading && !clear) return;

    // Get active tab info from tabs store
    const { tabs, activeTabId } = useTabsStore.getState();

    if (!activeTabId) {
      set({ images: [], totalImages: 0, isLoading: false, hasMore: false });
      return;
    }

    const activeTab = tabs?.find((t) => t.id === activeTabId);
    const folderPath =
      typeof activeTab?.path === 'string' ? activeTab.path : '';
    const safeQuery = typeof searchQuery === 'string' ? searchQuery : '';
    const safeLimit = Number.isFinite(limit) ? limit : 100;

    set({
      isLoading: true,
      ...(clear
        ? {
            images: [],
            totalImages: 0,
            selectedImageId: null,
            offset: 0,
            hasMore: true
          }
        : {})
    });
    try {
      const res = await GetImages(safeQuery, folderPath, 0, safeLimit);
      if (res) {
        set({
          images: (res.images as ImageRecord[]) || [],
          totalImages: res.totalCount || 0,
          offset: 0,
          hasMore: (res.images?.length || 0) < (res.totalCount || 0),
          isLoading: false
        });
      } else {
        set({ isLoading: false });
      }
    } catch (e) {
      console.error('Failed to fetch images:', e);
      set({ isLoading: false });
    }
  },

  fetchNextPage: async () => {
    const { searchQuery, offset, limit, images, isLoading, hasMore } = get();
    if (isLoading || !hasMore) return;

    // Get active tab info
    const { tabs, activeTabId } = useTabsStore.getState();
    if (!activeTabId) return;

    const activeTab = tabs?.find((t) => t.id === activeTabId);
    const folderPath =
      typeof activeTab?.path === 'string' ? activeTab.path : '';
    const safeQuery = typeof searchQuery === 'string' ? searchQuery : '';
    const safeLimit = Number.isFinite(limit) ? limit : 100;

    const nextOffset = offset + safeLimit;
    set({ isLoading: true });
    try {
      const res = await GetImages(safeQuery, folderPath, nextOffset, safeLimit);
      if (res) {
        set({
          images: [...images, ...((res.images as ImageRecord[]) || [])],
          offset: nextOffset,
          hasMore:
            images.length + (res.images?.length || 0) < (res.totalCount || 0),
          isLoading: false
        });
      } else {
        set({ isLoading: false });
      }
    } catch (e) {
      console.error('Failed to fetch next page:', e);
      set({ isLoading: false });
    }
  }
}));
