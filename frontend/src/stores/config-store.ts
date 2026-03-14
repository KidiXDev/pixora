import { create } from 'zustand';
import {
  AppConfig,
  ScanMode
} from '../../bindings/pixora/internal/config/models';
import {
  AddFolder,
  ClearIndexAndReindex,
  GetConfig,
  RemoveFolder,
  UpdateFolderAlias
} from '../../bindings/pixora/internal/services/galleryservice';
import { useGalleryStore } from './gallery-store';

interface ConfigState {
  config: AppConfig | null;
  isLoading: boolean;

  loadConfig: () => Promise<void>;
  addFolder: (path: string, mode: ScanMode) => Promise<void>;
  removeFolder: (path: string) => Promise<void>;
  updateFolderAlias: (path: string, alias: string) => Promise<void>;
  clearIndexAndReindex: () => Promise<void>;
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
      const normalizedPath = (path || '').trim();
      await RemoveFolder(path);
      // reload
      const config = await GetConfig();
      set({ config });

      // Keep open tabs, but detach them from the removed folder path.
      const tabsModule = await import('./tabs-store');
      const tabsStore = tabsModule.useTabsStore.getState();
      const affectedTabIds =
        await tabsStore.clearFolderFromTabs(normalizedPath);

      // If the currently active tab pointed to the removed folder, clear gallery immediately.
      const activeTabId = tabsStore.activeTabId;
      if (activeTabId && affectedTabIds.includes(activeTabId)) {
        const gallery = useGalleryStore.getState();
        gallery.setImages([], 0);
        gallery.setSelectedImageId(null);
      }

      await useGalleryStore.getState().fetchImages(true);
    } catch (e) {
      console.error('Failed to remove folder', e);
    }
  },

  updateFolderAlias: async (path, alias) => {
    try {
      await UpdateFolderAlias(path, alias);
      // reload
      const config = await GetConfig();
      set({ config });

      // Dynamically load useTabsStore to avoid circular imports and trigger an immediate tab rename
      import('./tabs-store').then((module) => {
        const tabsStore = module.useTabsStore.getState();
        const newTabs = tabsStore.tabs.map((t) => {
          if (t.path === path) {
            const fallbackLabel = path.split(/[/\\]/).pop() || 'Tab';
            return { ...t, label: alias || fallbackLabel };
          }
          return t;
        });
        tabsStore.saveTabs(newTabs);
      });
    } catch (e) {
      console.error('Failed to update folder alias', e);
    }
  },

  clearIndexAndReindex: async () => {
    try {
      const gallery = useGalleryStore.getState();
      gallery.setImages([], 0);
      gallery.setSelectedImageId(null);
      await ClearIndexAndReindex();
    } catch (e) {
      console.error('Failed to clear indexing data and re-index', e);
      throw e;
    }
  }
}));
