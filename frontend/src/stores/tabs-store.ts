import { create } from 'zustand';
import { TabConfig, ScanMode } from '../../bindings/pixora/internal/config/models';
import { GetConfig, SetTabs, AddFolder } from '../../bindings/pixora/internal/services/galleryservice';

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
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  isLoading: false,

  fetchTabs: async () => {
    set({ isLoading: true });
    try {
      const config = await GetConfig();
      if (config && config.tabs && config.tabs.length > 0) {
        set({ tabs: config.tabs, isLoading: false });
        if (!get().activeTabId) {
          set({ activeTabId: config.tabs[0].id });
        }
      } else {
        // Create an initial empty tab if none exist
        const initialTab = new TabConfig({
          id: Math.random().toString(36).substring(2, 11),
          label: 'New Tab',
          path: '',
          isWalk: true
        });
        set({ tabs: [initialTab], activeTabId: initialTab.id, isLoading: false });
        await SetTabs([initialTab]);
      }
    } catch (e) {
      console.error("Failed to fetch tabs:", e);
      set({ isLoading: false });
    }
  },

  setActiveTabId: (activeTabId) => set({ activeTabId }),

  saveTabs: async (tabs: TabConfig[]) => {
    try {
      await SetTabs(tabs);
      set({ tabs });
    } catch (e) {
      console.error("Failed to save tabs:", e);
    }
  },

  addTab: async (tab) => {
    // Automatically add to watched folders
    if (tab.path) {
      try {
        await AddFolder(tab.path, tab.isWalk ? ScanMode.ScanModeWalk : ScanMode.ScanModeNormal);
      } catch (e) {
        console.error("Failed to add folder when adding tab:", e);
      }
    }

    const newTab = new TabConfig({
      ...tab,
      id: Math.random().toString(36).substring(2, 11),
    });
    const newTabs = [...get().tabs, newTab];
    await get().saveTabs(newTabs);
    
    // Set as active
    set({ activeTabId: newTab.id });
  },

  removeTab: async (id) => {
    const currentTabs = get().tabs;
    if (currentTabs.length <= 1) {
      // Don't delete the last tab, just reset it to setup state
      const tabToReset = currentTabs.find(t => t.id === id);
      if (tabToReset) {
        await get().updateTab({
          ...tabToReset,
          label: 'New Tab',
          path: '',
        });
      }
      return;
    }

    const newTabs = currentTabs.filter(t => t.id !== id);
    let newActiveTabId = get().activeTabId;
    if (newActiveTabId === id) {
      const deletedIndex = currentTabs.findIndex(t => t.id === id);
      newActiveTabId = newTabs.length > 0 
        ? newTabs[Math.min(deletedIndex, newTabs.length - 1)].id 
        : null;
    }
    set({ activeTabId: newActiveTabId });
    await get().saveTabs(newTabs);
  },

  updateTab: async (tab) => {
    const oldTab = get().tabs.find(t => t.id === tab.id);
    
    // If the path was empty and now it's set, start watching it
    if (tab.path && (!oldTab || !oldTab.path)) {
      try {
        await AddFolder(tab.path, tab.isWalk ? ScanMode.ScanModeWalk : ScanMode.ScanModeNormal);
      } catch (e) {
        console.error("Failed to add folder when updating tab:", e);
      }
    }

    const newTabs = get().tabs.map(t => t.id === tab.id ? tab : t);
    await get().saveTabs(newTabs);
  },

  reorderTabs: async (tabs: TabConfig[]) => {
    // Update local state first for immediate UI feedback
    set({ tabs });
    // Persist to backend
    await get().saveTabs(tabs);
  },
}));
