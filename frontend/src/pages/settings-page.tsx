import { useConfirmation } from '@/components/providers/confirmation-provider';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useConfigStore } from '@/stores/config-store';
import { useGalleryStore } from '@/stores/gallery-store';
import { Dialogs } from '@wailsio/runtime';
import { Folder, FolderPlus, Info, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ScanMode } from '../../bindings/pixora/internal/config/models';

export default function SettingsPage() {
  const {
    config,
    loadConfig,
    addFolder,
    removeFolder,
    clearIndexAndReindex,
    isLoading: configLoading
  } = useConfigStore();
  const { fetchImages } = useGalleryStore();
  const [newMode, setNewMode] = useState<ScanMode>(ScanMode.ScanModeNormal);
  const [isClearingIndex, setIsClearingIndex] = useState(false);
  const confirm = useConfirmation();

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleAddFolderClick = async () => {
    try {
      const selection = await Dialogs.OpenFile({
        Title: 'Select Folder to Watch',
        CanChooseDirectories: true,
        CanChooseFiles: false,
        AllowsMultipleSelection: false
      });

      if (selection) {
        await addFolder(
          typeof selection === 'string' ? selection : selection[0],
          newMode
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleClearIndexingClick = async () => {
    const ok = await confirm.confirm({
      title: 'Clear Indexing Data?',
      description:
        'This will delete all indexed image records and thumbnail cache, then start indexing again from watched folders. This action cannot be undone.',
      confirmText: 'Clear & Re-index',
      cancelText: 'Cancel',
      variant: 'destructive'
    });

    if (!ok) return;

    setIsClearingIndex(true);
    try {
      await clearIndexAndReindex();
      await fetchImages(true);
    } catch (e) {
      console.error('Failed to reset indexing', e);
    } finally {
      setIsClearingIndex(false);
    }
  };

  return (
    <div className="container mx-auto p-4 md:p-8 max-w-4xl animate-in fade-in duration-500">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your image indexing and application preferences.
        </p>
      </div>

      <div className="space-y-8">
        {/* Watched Folders Section */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h2 className="text-xl font-semibold">Watched Folders</h2>
              <p className="text-sm text-muted-foreground">
                Directories currently being scanned for images.
              </p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Select
                value={newMode}
                onValueChange={(v) => setNewMode(v as ScanMode)}
              >
                <SelectTrigger className="w-30">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ScanMode.ScanModeNormal}>
                    Normal
                  </SelectItem>
                  <SelectItem value={ScanMode.ScanModeWalk}>
                    Walk Array
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={handleAddFolderClick}
                size="sm"
                className="gap-2"
              >
                <FolderPlus size={16} />
                Add Folder
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            {configLoading ? (
              <div className="p-12 text-center text-muted-foreground">
                Loading configurations...
              </div>
            ) : config?.folders?.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center text-muted-foreground bg-muted/5">
                <Folder size={40} className="mb-4 opacity-10" />
                <p>No watched folders configured.</p>
                <p className="text-xs mt-1">
                  Folders added here or via Tabs will appear in this list.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {config?.folders?.map((folder) => (
                  <div
                    key={folder.path}
                    className="flex items-center justify-between p-4 hover:bg-muted/10 transition-colors"
                  >
                    <div className="flex flex-col gap-1 overflow-hidden pr-4">
                      <div className="font-medium truncate text-sm">
                        {folder.path}
                      </div>
                      <div className="flex items-center text-xs text-muted-foreground gap-2">
                        <span
                          className={cn(
                            'px-1.5 py-0.5 rounded text-[10px] uppercase font-bold',
                            folder.scanMode === 'walk'
                              ? 'bg-primary/10 text-primary border border-primary/20'
                              : 'bg-muted text-muted-foreground border border-border'
                          )}
                        >
                          {folder.scanMode}
                        </span>
                        <span>
                          {folder.scanMode === 'walk'
                            ? 'Recursive indexing'
                            : 'Flat directory'}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        confirm
                          .confirm({
                            title: 'Stop Watching Folder',
                            description:
                              'Are you sure? This will remove images from this folder from your gallery index.',
                            variant: 'destructive'
                          })
                          .then((ok) => {
                            if (ok) removeFolder(folder.path);
                          })
                      }
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Indexing Reset Section */}
        <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-destructive">
                Clear Indexing Data
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Removes indexing cache and indexed image metadata, then starts a
                full re-index for all watched folders.
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={handleClearIndexingClick}
              disabled={isClearingIndex}
              className="gap-2"
            >
              <Trash2 size={16} />
              {isClearingIndex ? 'Clearing...' : 'Clear & Re-index'}
            </Button>
          </div>
        </section>

        {/* Info Section */}
        <section className="rounded-xl border border-border bg-card p-6 border-dashed">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Info className="text-primary" size={20} />
            </div>
            <div>
              <h3 className="font-semibold mb-1">About Tabs & Folders</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Pixora allows you to organize your images using **Tabs**. When
                you add a new tab, you select a folder which is then
                automatically "watched" and indexed. Removing a tab will stop
                watching that specific folder if no other tabs are referencing
                it.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
