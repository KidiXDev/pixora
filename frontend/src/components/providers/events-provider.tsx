import { useGalleryStore } from '@/stores/gallery-store';
import { ScanStatus, useIndexingStore } from '@/stores/indexing-store';
import { useTabsStore } from '@/stores/tabs-store';
import { Events } from '@wailsio/runtime';
import { useEffect } from 'react';

interface ThumbnailReadyEvent {
  hash: string;
  path: string;
  folderPath: string;
}

export function EventsProvider({ children }: { children: React.ReactNode }) {
  const { upsertScan, startScan, removeScan } = useIndexingStore();
  const fetchImages = useGalleryStore((state) => state.fetchImages);

  const getPayload = <T,>(data: unknown): T | undefined => {
    if (Array.isArray(data)) return data[0] as T | undefined;
    return data as T | undefined;
  };

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshInFlight = false;

    const queueRefresh = () => {
      if (refreshTimer || refreshInFlight) return;
      refreshTimer = setTimeout(async () => {
        refreshTimer = null;
        refreshInFlight = true;
        try {
          await fetchImages();
        } finally {
          refreshInFlight = false;
        }
      }, 120);
    };

    const isInActiveFolderScope = (imagePath: string): boolean => {
      const { tabs, activeTabId } = useTabsStore.getState();
      const activeTab = tabs.find((t) => t.id === activeTabId);
      const activePath = (activeTab?.path || '').trim();
      if (!activePath) return false;
      return imagePath.startsWith(activePath);
    };

    // Listen for indexing events
    const unsubStart = Events.On('indexing:start', (e) => {
      const folderPath = getPayload<string>(e.data);
      if (!folderPath) return;
      startScan(folderPath);
    });

    const unsubProgress = Events.On('indexing:progress', (e) => {
      const status = getPayload<ScanStatus>(e.data);
      if (!status) return;
      upsertScan(status);
    });

    const unsubEnd = Events.On('indexing:end', (e) => {
      const folderPath = getPayload<string>(e.data);
      if (!folderPath) return;
      removeScan(folderPath);
      // Refresh gallery when indexing finishes to show new images
      fetchImages();
    });

    const unsubThumbReady = Events.On('thumbnail:ready', (e) => {
      const payload = getPayload<ThumbnailReadyEvent>(e.data);
      if (!payload?.path) return;
      if (!isInActiveFolderScope(payload.path)) return;
      queueRefresh();
    });

    return () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      unsubStart();
      unsubProgress();
      unsubEnd();
      unsubThumbReady();
    };
  }, [upsertScan, startScan, removeScan, fetchImages]);

  return <>{children}</>;
}
