import { create } from 'zustand';
import {
  AppConfig,
  ScanMode
} from '../../bindings/pixora/internal/config/models';
import {
  AddFolder,
  ClearIndexAndReindex,
  ClearParserPluginLogs,
  GetConfig,
  InstallParserPlugin,
  ListParserPluginLogs,
  ListParserPlugins,
  RemoveFolder,
  RemoveParserPlugin,
  SetDevMode,
  SetParserPluginEnabled,
  TrustParserPlugin,
  UpdateFolderAlias
} from '../../bindings/pixora/internal/services/galleryservice';
import { useGalleryStore } from './gallery-store';
import { useTabsStore } from './tabs-store';

export interface ParserPluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  main: string;
  folderPath: string;
  status: 'enabled' | 'disabled' | 'error' | 'untrusted' | string;
  trusted: boolean;
  enabled: boolean;
  error: string;
}

export interface ParserPluginLogEntry {
  timestamp: string;
  pluginID: string;
  level: string;
  message: string;
}

interface ConfigState {
  config: AppConfig | null;
  isLoading: boolean;
  plugins: ParserPluginInfo[];
  pluginsLoading: boolean;
  pluginLogs: ParserPluginLogEntry[];
  pluginLogsLoading: boolean;

  loadConfig: () => Promise<void>;
  loadPlugins: () => Promise<void>;
  addFolder: (path: string, mode: ScanMode) => Promise<void>;
  removeFolder: (path: string) => Promise<void>;
  updateFolderAlias: (path: string, alias: string) => Promise<void>;
  setDevMode: (enabled: boolean) => Promise<void>;
  clearIndexAndReindex: () => Promise<void>;
  loadPluginLogs: (pluginID?: string, limit?: number) => Promise<void>;
  clearPluginLogs: () => Promise<void>;
  setPluginEnabled: (pluginID: string, enabled: boolean) => Promise<void>;
  trustPlugin: (pluginID: string) => Promise<void>;
  installPlugin: (zipPath: string) => Promise<void>;
  removePlugin: (pluginID: string) => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set) => ({
  config: null,
  isLoading: true,
  plugins: [],
  pluginsLoading: false,
  pluginLogs: [],
  pluginLogsLoading: false,

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

  loadPlugins: async () => {
    set({ pluginsLoading: true });
    try {
      const plugins = await ListParserPlugins();
      set({ plugins: plugins as ParserPluginInfo[], pluginsLoading: false });
    } catch (e) {
      console.error('Failed to load parser plugins', e);
      set({ pluginsLoading: false });
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
      const tabsStore = useTabsStore.getState();
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

      // Use useTabsStore to trigger an immediate tab rename
      const tabsStore = useTabsStore.getState();
      const newTabs = tabsStore.tabs.map((t) => {
        if (t.path === path) {
          const fallbackLabel = path.split(/[/\\]/).pop() || 'Tab';
          return { ...t, label: alias || fallbackLabel };
        }
        return t;
      });
      tabsStore.saveTabs(newTabs);
    } catch (e) {
      console.error('Failed to update folder alias', e);
    }
  },
  setDevMode: async (enabled) => {
    try {
      await SetDevMode(enabled);
      // reload
      const config = await GetConfig();
      set({ config });
    } catch (e) {
      console.error('Failed to set dev mode', e);
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
  },

  loadPluginLogs: async (pluginID = '', limit = 300) => {
    set({ pluginLogsLoading: true });
    try {
      const logs = await ListParserPluginLogs(pluginID, limit);
      set({
        pluginLogs: logs as ParserPluginLogEntry[],
        pluginLogsLoading: false
      });
    } catch (e) {
      console.error('Failed to load plugin logs', e);
      set({ pluginLogsLoading: false });
    }
  },

  clearPluginLogs: async () => {
    try {
      await ClearParserPluginLogs();
      set({ pluginLogs: [] });
    } catch (e) {
      console.error('Failed to clear plugin logs', e);
      throw e;
    }
  },

  setPluginEnabled: async (pluginID, enabled) => {
    try {
      await SetParserPluginEnabled(pluginID, enabled);
      const plugins = await ListParserPlugins();
      set({ plugins: plugins as ParserPluginInfo[] });
    } catch (e) {
      console.error('Failed to toggle parser plugin', e);
      throw e;
    }
  },

  trustPlugin: async (pluginID) => {
    try {
      await TrustParserPlugin(pluginID);
      const plugins = await ListParserPlugins();
      set({ plugins: plugins as ParserPluginInfo[] });
    } catch (e) {
      console.error('Failed to trust parser plugin', e);
      throw e;
    }
  },


  installPlugin: async (zipPath) => {
    try {
      await InstallParserPlugin(zipPath);
      const plugins = await ListParserPlugins();
      set({ plugins: plugins as ParserPluginInfo[] });
    } catch (e) {
      console.error('Failed to install parser plugin', e);
      throw e;
    }
  },

  removePlugin: async (pluginID) => {
    try {
      await RemoveParserPlugin(pluginID);
      const plugins = await ListParserPlugins();
      set({ plugins: plugins as ParserPluginInfo[] });
    } catch (e) {
      console.error('Failed to remove parser plugin', e);
      throw e;
    }
  }
}));
