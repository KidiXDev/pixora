import { create } from 'zustand';
import { AppConfig, ScanMode } from '../../bindings/pixora/internal/config/models';
import { AddFolder, GetConfig, RemoveFolder } from '../../bindings/pixora/internal/services/galleryservice';

interface ConfigState {
  config: AppConfig | null;
  isLoading: boolean;
  
  loadConfig: () => Promise<void>;
  addFolder: (path: string, mode: ScanMode) => Promise<void>;
  removeFolder: (path: string) => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set) => ({
  config: null,
  isLoading: true,

  loadConfig: async () => {
    set({ isLoading: true });
    try {
      const config = await GetConfig();
      set({ config, isLoading: false });
    } catch (e) {
      console.error('Failed to load config', e);
      set({ isLoading: false });
    }
  },

  addFolder: async (path, mode) => {
    try {
      await AddFolder(path, mode);
      // reload
      const config = await GetConfig();
      set({ config });
    } catch (e) {
      console.error('Failed to add folder', e);
    }
  },

  removeFolder: async (path) => {
    try {
      await RemoveFolder(path);
      // reload
      const config = await GetConfig();
      set({ config });
    } catch (e) {
      console.error('Failed to remove folder', e);
    }
  }
}));
