import { create } from 'zustand';
import { ImageRecord } from '../../bindings/pixora/internal/db/models';

type LayoutMode = 'compact' | 'comfortable' | 'spacious';

interface GalleryState {
  images: ImageRecord[];
  totalImages: number;
  searchQuery: string;
  selectedImageId: number | null;
  layoutMode: LayoutMode;

  setImages: (images: ImageRecord[], total: number) => void;
  setSearchQuery: (query: string) => void;
  setSelectedImageId: (id: number | null) => void;
  setLayoutMode: (mode: LayoutMode) => void;
}

export const useGalleryStore = create<GalleryState>((set) => ({
  images: [],
  totalImages: 0,
  searchQuery: '',
  selectedImageId: null,
  layoutMode: 'comfortable',

  setImages: (images, total) => set({ images, totalImages: total }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSelectedImageId: (selectedImageId) => set({ selectedImageId }),
  setLayoutMode: (layoutMode) => set({ layoutMode }),
}));
