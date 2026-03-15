import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useConfigStore } from '@/stores/config-store';
import { useTabsStore } from '@/stores/tabs-store';
import { Dialogs } from '@wailsio/runtime';
import {
  Check,
  Edit2,
  FileStack,
  Folder,
  FolderPlus,
  Layers,
  Plus,
  X
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  FolderConfig,
  ScanMode
} from '../../../bindings/pixora/internal/config/models';

function FolderItem({
  folder,
  onSelect
}: {
  folder: FolderConfig;
  onSelect: (isWalk: boolean) => void;
}) {
  const { updateFolderAlias } = useConfigStore();
  const [isEditing, setIsEditing] = useState(false);
  const [alias, setAlias] = useState(folder.alias || '');

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await updateFolderAlias(folder.path, alias);
    setIsEditing(false);
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setAlias(folder.alias || '');
    setIsEditing(false);
  };

  return (
    <div className="group relative">
      <button
        onClick={() => onSelect(folder.scanMode === 'walk')}
        className="flex items-center justify-between w-full p-4 rounded-2xl border border-border bg-card/50 hover:bg-muted/30 hover:border-primary/30 transition-all text-left shadow-sm overflow-hidden"
      >
        <div className="flex flex-col gap-1.5 overflow-hidden pr-12">
          <div className="font-bold truncate text-sm group-hover:text-primary transition-colors">
            {isEditing ? (
              <div
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-2"
              >
                <Input
                  size={1}
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  placeholder="Enter alias name..."
                  className="h-7 text-xs bg-muted/50 border-primary/20"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      updateFolderAlias(folder.path, alias);
                      setIsEditing(false);
                    }
                  }}
                />
                <button
                  onClick={handleSave}
                  className="p-1 hover:text-primary transition-colors"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={handleCancel}
                  className="p-1 hover:text-destructive transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              folder.alias || folder.path.split(/[/\\]/).pop()
            )}
          </div>
          <div className="flex items-center text-[10px] text-muted-foreground gap-3">
            <span
              className={cn(
                'px-1.5 py-0.5 rounded-md uppercase font-bold border tabular-nums',
                folder.scanMode === ScanMode.ScanModeWalk
                  ? 'bg-primary/10 text-primary border-primary/20'
                  : 'bg-muted text-muted-foreground border-border'
              )}
            >
              {folder.scanMode}
            </span>
            <span className="truncate opacity-50 font-medium">
              {folder.path}
            </span>
          </div>
        </div>
        <div className="h-8 w-8 rounded-lg bg-muted/20 flex items-center justify-center shrink-0 group-hover:bg-primary/10 group-hover:text-primary transition-all">
          <Folder
            size={16}
            className="opacity-40 group-hover:opacity-100 transition-opacity"
          />
        </div>
      </button>

      {!isEditing && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(true);
          }}
          className="absolute right-14 top-1/2 -translate-y-1/2 p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-primary/10 hover:text-primary transition-all pointer-events-auto"
          title="Edit Alias"
        >
          <Edit2 size={14} />
        </button>
      )}
    </div>
  );
}

export function TabSetup() {
  const { config, loadConfig } = useConfigStore();
  const { tabs, activeTabId, updateTab } = useTabsStore();
  const [scanMode, setScanMode] = useState<ScanMode>(ScanMode.ScanModeNormal);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handlePickFolder = async () => {
    if (!activeTab) return;

    try {
      const selection = await Dialogs.OpenFile({
        Title: 'Select Folder for this Tab',
        CanChooseDirectories: true,
        CanChooseFiles: false,
        AllowsMultipleSelection: false
      });

      if (selection) {
        const path = typeof selection === 'string' ? selection : selection[0];

        const existingFolder = config?.folders?.find((f) => f.path === path);
        const label =
          existingFolder?.alias || path.split(/[/\\]/).pop() || 'New Tab';

        await updateTab({
          ...activeTab,
          label: label,
          path: path,
          isWalk: scanMode === ScanMode.ScanModeWalk
        });
      }
    } catch (e) {
      console.error('Failed to pick folder:', e);
    }
  };

  const handleSelectExisting = async (folderPath: string, isWalk: boolean) => {
    if (!activeTab) return;
    const existingFolder = config?.folders?.find((f) => f.path === folderPath);
    const label =
      existingFolder?.alias || folderPath.split(/[/\\]/).pop() || 'New Tab';
    await updateTab({
      ...activeTab,
      label: label,
      path: folderPath,
      isWalk: isWalk
    });
  };

  if (!activeTab) return null;

  return (
    <ScrollArea className="h-full w-full bg-background">
      <div className="flex flex-col items-center px-4 py-6 sm:px-6 sm:py-8">
        <div className="max-w-4xl w-full space-y-6 pb-14">
          <div className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  <FolderPlus size={12} className="text-primary" />
                  Folder Source
                </div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                  Choose where this tab reads images from
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl">
                  Pick one of your indexed folders or browse your computer to
                  assign a new location for the current tab.
                </p>
              </div>

              <div className="flex items-center gap-2 sm:self-start">
                <Select
                  value={scanMode}
                  onValueChange={(v) => {
                    if (v == null) return;
                    setScanMode(v as ScanMode);
                  }}
                >
                  <SelectTrigger className="h-9 w-36 bg-muted/30 border-border/70 shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ScanMode.ScanModeNormal}>
                      <div className="flex items-center gap-2">
                        <Layers size={12} />
                        <span>Normal</span>
                      </div>
                    </SelectItem>
                    <SelectItem value={ScanMode.ScanModeWalk}>
                      <div className="flex items-center gap-2">
                        <FileStack size={12} />
                        <span>Walk</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  onClick={handlePickFolder}
                  className="h-9 rounded-lg px-3"
                  title="Browse Directory"
                >
                  <Plus size={15} />
                  <span>Browse</span>
                </Button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-background/50 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Indexed Folders
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {config?.folders?.length ?? 0}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/50 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Active Scan Mode
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {scanMode === ScanMode.ScanModeWalk ? 'Walk' : 'Normal'}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card/40 p-4 sm:p-5">
            <div className="space-y-4">
              {config?.folders && config.folders.length > 0 ? (
                <div className="grid gap-3">
                  <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">
                    Available Indexed Folders
                  </h3>
                  <div className="grid gap-2">
                    {config.folders.map((folder) => (
                      <FolderItem
                        key={folder.path}
                        folder={folder}
                        onSelect={(isWalk) =>
                          handleSelectExisting(folder.path, isWalk)
                        }
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center space-y-4 rounded-2xl border-2 border-dashed border-border/60 bg-muted/5">
                  <div className="h-14 w-14 rounded-xl bg-muted/10 flex items-center justify-center text-muted-foreground/40">
                    <Folder size={28} />
                  </div>
                  <div className="space-y-1.5 px-6">
                    <p className="text-base font-semibold text-foreground">
                      No indexed folders yet
                    </p>
                    <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
                      Use Browse to choose a folder from your computer. It will
                      be assigned to this tab and available next time.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <p className="text-center text-[11px] text-muted-foreground/70 leading-relaxed px-2">
            Tip: use aliases to keep folder names readable, especially when
            paths are long.
          </p>
        </div>
      </div>
    </ScrollArea>
  );
}
