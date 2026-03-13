import { useGalleryStore } from '@/stores/gallery-store';
import { ScanStatus, useIndexingStore } from '@/stores/indexing-store';
import { Events } from '@wailsio/runtime';
import { useEffect } from 'react';

export function EventsProvider({ children }: { children: React.ReactNode }) {
  const { upsertScan, startScan, removeScan } = useIndexingStore();
  const { fetchImages } = useGalleryStore();

  const getPayload = <T,>(data: unknown): T | undefined => {
    if (Array.isArray(data)) return data[0] as T | undefined;
    return data as T | undefined;
  };

  useEffect(() => {
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

    return () => {
      unsubStart();
      unsubProgress();
      unsubEnd();
    };
  }, [upsertScan, startScan, removeScan, fetchImages]);

  return <>{children}</>;
}
