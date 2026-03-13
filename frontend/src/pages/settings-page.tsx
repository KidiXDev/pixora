import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { useConfigStore } from '@/stores/config-store';
import { Dialogs } from '@wailsio/runtime';
import { FolderPlus, Info, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  FolderConfig,
  ScanMode
} from '../../bindings/pixora/internal/config/models';

export default function SettingsPage() {
  const { config, loadConfig, addFolder, removeFolder, isLoading } =
    useConfigStore();
  const [newMode, setNewMode] = useState<ScanMode>(ScanMode.ScanModeNormal);

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
        // selection is a single string here because AllowsMultipleSelection is false/undefined or default
        await addFolder(
          typeof selection === 'string' ? selection : selection[0],
          newMode
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="container mx-auto max-w-4xl p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage your watched folders and application preferences.
        </p>
      </div>

      <div className="space-y-6">
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="p-6 border-b border-border bg-card/50 flex justify-between items-center">
            <div>
              <h2 className="text-lg font-medium">Watched Folders</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Directories scanned for AI generated images.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Select
                value={newMode}
                onValueChange={(v) => setNewMode(v as ScanMode)}
              >
                <SelectTrigger className="w-[120px] h-9">
                  <SelectValue placeholder="Mode" />
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

          <div className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">
                Loading config...
              </div>
            ) : config?.folders?.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center text-muted-foreground border-t border-border/50">
                <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                  <FolderPlus size={24} className="text-muted-foreground/50" />
                </div>
                <p>No watched folders configured.</p>
                <p className="text-sm mt-1">
                  Add a folder to start indexing your images.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {config?.folders?.map((folder: FolderConfig, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex flex-col gap-1 overflow-hidden pr-4">
                      <div className="font-medium truncate">{folder.path}</div>
                      <div className="flex items-center text-xs text-muted-foreground gap-1.5">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${folder.scanMode === 'walk' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}
                        >
                          {folder.scanMode.toUpperCase()}
                        </span>
                        <span>
                          {folder.scanMode === 'walk'
                            ? 'Recursive subfolders'
                            : 'Single directory only'}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFolder(folder.path)}
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                    >
                      <Trash2 size={18} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card shadow-sm p-6 flex flex-col gap-2">
          <div className="flex items-center gap-2 mb-2">
            <Info size={18} className="text-primary" />
            <h2 className="text-lg font-medium">Indexing Information</h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Pixora uses a high-performance background indexer. When you add a
            new folder, it will be scanned in the background and thumbnails will
            be generated. Images are indexed into a local SQLite database for
            lightning-fast search.
          </p>
        </div>
      </div>
    </div>
  );
}
