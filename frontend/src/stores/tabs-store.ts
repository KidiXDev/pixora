import { isPageTabPath, isSingleInstancePageTabPath } from '@/lib/tab-pages';
import { create } from 'zustand';
import {
  ScanMode,
  TabConfig
} from '../../bindings/pixora/internal/config/models';
import {
  AddFolder,
  GetConfig,
  SetTabs
} from '../../bindings/pixora/internal/services/galleryservice';

const LAST_ACTIVE_TAB_STORAGE_KEY = 'pixora:last-active-tab-id';

function readLastActiveTabId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(LAST_ACTIVE_TAB_STORAGE_KEY);
    return rawValue && rawValue.trim().length > 0 ? rawValue : null;
  } catch {
    return null;
  }
}

function persistLastActiveTabId(tabId: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (tabId && tabId.trim().length > 0) {
      window.localStorage.setItem(LAST_ACTIVE_TAB_STORAGE_KEY, tabId);
      return;
    }

    window.localStorage.removeItem(LAST_ACTIVE_TAB_STORAGE_KEY);
  } catch {}
}

interface TabsState {
  tabs: TabConfig[];
  activeTabId: string | null;
  isLoading: boolean;

  fetchTabs: () => Promise<void>;
  setActiveTabId: (id: string | null) => void;
  addTab: (tab: Omit<TabConfig, 'id'>) => Promise<void>;
  removeTab: (id: string) => Promise<void>;
  updateTab: (tab: TabConfig) => Promise<void>;
  saveTabs: (tabs: TabConfig[]) => Promise<void>;
  reorderTabs: (tabs: TabConfig[]) => Promise<void>;
  clearFolderFromTabs: (path: string) => Promise<string[]>;
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: readLastActiveTabId(),
  isLoading: false,

  fetchTabs: async () => {
    set({ isLoading: true });
    try {
      const config = await GetConfig();
      if (config && config.tabs && config.tabs.length > 0) {
        const seenSingleInstancePagePaths = new Set<string>();
        const normalizedTabs = config.tabs.filter((t) => {
          if (!isSingleInstancePageTabPath(t.path)) {
            return true;
          }

          if (!t.path) {
            return false;
          }

          if (seenSingleInstancePagePaths.has(t.path)) {
            return false;
          }

          seenSingleInstancePagePaths.add(t.path);
          return true;
        });

        if (normalizedTabs.length !== config.tabs.length) {
          await SetTabs(normalizedTabs);
        }

        const currentActiveTabId = get().activeTabId;
        const savedTabId = readLastActiveTabId();
        const resolvedActiveTabId =
          normalizedTabs.find((tab) => tab.id === currentActiveTabId)?.id ??
          normalizedTabs.find((tab) => tab.id === savedTabId)?.id ??
          normalizedTabs[0].id;

        set({
          tabs: normalizedTabs,
          activeTabId: resolvedActiveTabId,
          isLoading: false
        });
        persistLastActiveTabId(resolvedActiveTabId);
      } else {
        // Create an initial empty tab if none exist
        const initialTab = new TabConfig({
          id: Math.random().toString(36).substring(2, 11),
          label: 'New Tab',
          path: '',
          isWalk: true
        });
        set({
          tabs: [initialTab],
          activeTabId: initialTab.id,
          isLoading: false
        });
        persistLastActiveTabId(initialTab.id);
        await SetTabs([initialTab]);
      }
    } catch (e) {
      console.error('Failed to fetch tabs:', e);
      set({ isLoading: false });
    }
  },

  setActiveTabId: (activeTabId) => {
    persistLastActiveTabId(activeTabId);
    set({ activeTabId });
  },

  saveTabs: async (tabs: TabConfig[]) => {
    try {
      await SetTabs(tabs);
      set({ tabs });
    } catch (e) {
      console.error('Failed to save tabs:', e);
    }
  },

  addTab: async (tab) => {
    if (isSingleInstancePageTabPath(tab.path)) {
      const existingPageTab = get().tabs.find((t) => t.path === tab.path);
      if (existingPageTab) {
        persistLastActiveTabId(existingPageTab.id);
        set({ activeTabId: existingPageTab.id });
        return;
      }
    }

    // Automatically add to watched folders
    if (tab.path && !isPageTabPath(tab.path)) {
      try {
        await AddFolder(
          tab.path,
          tab.isWalk ? ScanMode.ScanModeWalk : ScanMode.ScanModeNormal
        );
      } catch (e) {
        console.error('Failed to add folder when adding tab:', e);
      }
    }

    const newTab = new TabConfig({
      ...tab,
      id: Math.random().toString(36).substring(2, 11)
    });
    const newTabs = [...get().tabs, newTab];
    await get().saveTabs(newTabs);

    // Set as active
    persistLastActiveTabId(newTab.id);
    set({ activeTabId: newTab.id });
  },

  removeTab: async (id) => {
    const currentTabs = get().tabs;
    if (currentTabs.length <= 1) {
      // Don't delete the last tab, just reset it to setup state
      const tabToReset = currentTabs.find((t) => t.id === id);
      if (tabToReset) {
        await get().updateTab({
          ...tabToReset,
          label: 'New Tab',
          path: ''
        });
      }
      return;
    }

    const newTabs = currentTabs.filter((t) => t.id !== id);
    let newActiveTabId = get().activeTabId;
    if (newActiveTabId === id) {
      const deletedIndex = currentTabs.findIndex((t) => t.id === id);
      newActiveTabId =
        newTabs.length > 0
          ? newTabs[Math.min(deletedIndex, newTabs.length - 1)].id
          : null;
    }
    set({ activeTabId: newActiveTabId });
    persistLastActiveTabId(newActiveTabId);
    await get().saveTabs(newTabs);
  },

  updateTab: async (tab) => {
    const oldTab = get().tabs.find((t) => t.id === tab.id);

    if (tab.path && !isPageTabPath(tab.path) && (!oldTab || !oldTab.path)) {
      try {
        await AddFolder(
          tab.path,
          tab.isWalk ? ScanMode.ScanModeWalk : ScanMode.ScanModeNormal
        );
      } catch (e) {
        console.error('Failed to add folder when updating tab:', e);
      }
    }

    const newTabs = get().tabs.map((t) => (t.id === tab.id ? tab : t));
    await get().saveTabs(newTabs);
  },

  reorderTabs: async (tabs: TabConfig[]) => {
    set({ tabs });
    await get().saveTabs(tabs);
  },

  clearFolderFromTabs: async (path: string) => {
    const target = (path || '').trim();
    if (!target) return [];

    const currentTabs = get().tabs;
    const affected = currentTabs.filter((t) => t.path === target);
    if (affected.length === 0) return [];

    const updatedTabs = currentTabs.map((t) =>
      t.path === target
        ? {
            ...t,
            path: '',
            label: t.label?.trim() || 'New Tab'
          }
        : t
    );

    await get().saveTabs(updatedTabs);
    return affected.map((t) => t.id);
  }
}));
