import { create } from 'zustand';

export interface ScanStatus {
  folderPath: string;
  processedFiles: number;
  totalFiles: number;
  isRunning: boolean;
}

interface IndexingState {
  activeScans: Record<string, ScanStatus>;
  upsertScan: (status: ScanStatus) => void;
  startScan: (folderPath: string) => void;
  removeScan: (folderPath: string) => void;
  getTotalProcessed: () => number;
}

export const useIndexingStore = create<IndexingState>((set, get) => ({
  activeScans: {},
  upsertScan: (status) => {
    if (!status?.folderPath) return;

    if (!status.isRunning) {
      set((state) => {
        const { [status.folderPath]: _, ...rest } = state.activeScans;
        return { activeScans: rest };
      });
      return;
    }

    set((state) => ({
      activeScans: { ...state.activeScans, [status.folderPath]: status }
    }));
  },
  startScan: (folderPath) =>
    set((state) => ({
      activeScans: {
        ...state.activeScans,
        [folderPath]: {
          folderPath,
          processedFiles: 0,
          totalFiles: 0,
          isRunning: true
        }
      }
    })),
  removeScan: (folderPath) =>
    set((state) => {
      const { [folderPath]: _, ...rest } = state.activeScans;
      return { activeScans: rest };
    }),
  getTotalProcessed: () =>
    Object.values(get().activeScans).reduce(
      (acc, s) => acc + s.processedFiles,
      0
    )
}));
