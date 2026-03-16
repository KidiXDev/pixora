import { useGalleryStore } from '@/stores/gallery-store';
import { ScanStatus, useIndexingStore } from '@/stores/indexing-store';
import { Events } from '@wailsio/runtime';
import { useEffect } from 'react';

interface ThumbnailReadyEvent {
  hash: string;
  path: string;
  folderPath: string;
}

interface LibraryChangeEvent {
  operation: string;
  path: string;
  oldPath: string;
  folderPath: string;
  oldFolderPath: string;
  isDir: boolean;
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
    let refreshPending = false;

    const runRefresh = async () => {
      refreshInFlight = true;
      try {
        await fetchImages();
      } finally {
        refreshInFlight = false;
        if (refreshPending) {
          refreshPending = false;
          queueRefresh();
        }
      }
    };

    const queueRefresh = () => {
      if (refreshTimer || refreshInFlight) {
        refreshPending = true;
        return;
      }

      refreshTimer = setTimeout(async () => {
        refreshTimer = null;
        await runRefresh();
      }, 120);
    };

    const isInActiveScope = (path: string): boolean => {
      const { rootFolderPath, currentFolderPath } = useGalleryStore.getState();
      const activeRoot = rootFolderPath.trim();
      const activeCurrent = currentFolderPath.trim();
      if (!activeRoot || !activeCurrent || !path) {
        return false;
      }

      if (path === activeCurrent) {
        return true;
      }

      const withSep =
        activeCurrent.endsWith('\\') || activeCurrent.endsWith('/')
          ? activeCurrent
          : `${activeCurrent}${activeCurrent.includes('\\') ? '\\' : '/'}`;

      return path.startsWith(withSep);
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
      queueRefresh();
    });

    const unsubThumbReady = Events.On('thumbnail:ready', (e) => {
      const payload = getPayload<ThumbnailReadyEvent>(e.data);
      if (!payload?.path) return;
      if (!isInActiveScope(payload.path)) return;
      queueRefresh();
    });

    const unsubLibraryChanged = Events.On('library:changed', (e) => {
      const payload = getPayload<LibraryChangeEvent>(e.data);
      if (!payload) {
        return;
      }

      if (payload.path && isInActiveScope(payload.path)) {
        queueRefresh();
        return;
      }

      if (payload.oldPath && isInActiveScope(payload.oldPath)) {
        queueRefresh();
      }
    });

    return () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      refreshPending = false;
      unsubStart();
      unsubProgress();
      unsubEnd();
      unsubThumbReady();
      unsubLibraryChanged();
    };
  }, [upsertScan, startScan, removeScan, fetchImages]);

  return <>{children}</>;
}
