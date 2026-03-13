import { useEffect } from 'react';
import { Events } from '@wailsio/runtime';
import { useIndexingStore, ScanStatus } from '@/stores/indexing-store';
import { useGalleryStore } from '@/stores/gallery-store';

export function EventsProvider({ children }: { children: React.ReactNode }) {
  const { upsertScan, startScan, removeScan } = useIndexingStore();
  const { fetchImages } = useGalleryStore();

  useEffect(() => {
    // Listen for indexing events
    const unsubStart = Events.On('indexing:start', (e) => {
      startScan(e.data[0]);
    });
    
    const unsubProgress = Events.On('indexing:progress', (e) => {
      const status = e.data[0] as ScanStatus;
      upsertScan(status);
    });

    const unsubEnd = Events.On('indexing:end', (e) => {
      const folderPath = e.data[0];
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
