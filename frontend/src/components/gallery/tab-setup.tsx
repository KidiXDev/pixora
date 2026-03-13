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
import { Check, Edit2, FileStack, Folder, FolderPlus, Layers, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FolderConfig, ScanMode } from '../../../bindings/pixora/internal/config/models';

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
        
        // Check if this folder already has an alias in our config
        const existingFolder = config?.folders?.find(f => f.path === path);
        const label = existingFolder?.alias || path.split(/[/\\]/).pop() || 'New Tab';

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

  const handleSelectExisting = async (folderPath: string, isWalk: boolean, alias?: string) => {
    if (!activeTab) return;
    const label = alias || folderPath.split(/[/\\]/).pop() || 'Tab';
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
      <div className="flex flex-col items-center px-6 py-10 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="max-w-xl w-full space-y-8 pb-20">
          <div className="flex items-end justify-between px-1 border-b border-border/40 pb-6">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
                <FolderPlus size={24} className="text-primary" />
                Setup Tab
              </h1>
              <p className="text-xs text-muted-foreground font-medium">
                Select an indexed folder or browse your PC for a new one.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Select
                value={scanMode.charAt(0).toUpperCase() + scanMode.slice(1)}
                onValueChange={(v) => setScanMode(v as ScanMode)}
              >
                <SelectTrigger className="h-8 text-base w-[150px] bg-muted/30 border-transparent shadow-none hover:bg-muted/50 transition-colors">
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
                size="icon"
                className="h-8 w-8 rounded-full shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
                title="Browse Directory"
              >
                <Plus size={16} />
              </Button>
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-3 px-1">
              <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Tab Name (Alias)
              </h3>
              <Input
                value={activeTab.label}
                onChange={(e) => updateTab({ ...activeTab, label: e.target.value })}
                placeholder="Enter tab name..."
                className="h-11 bg-muted/20 border-border/50 focus:border-primary/50 transition-all rounded-xl"
              />
            </div>

            <div className="space-y-4">
              {config?.folders && config.folders.length > 0 ? (
                <div className="grid gap-3">
                  <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">
                    Indexed Folders
                  </h3>
                  <div className="grid gap-2">
                    {config.folders.map((folder) => (
                      <FolderItem
                        key={folder.path}
                        folder={folder}
                        onSelect={(isWalk) =>
                          handleSelectExisting(folder.path, isWalk, folder.alias)
                        }
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 rounded-3xl border-2 border-dashed border-border/60 bg-muted/5">
                  <div className="h-16 w-16 rounded-2xl bg-muted/10 flex items-center justify-center text-muted-foreground/30">
                    <Folder size={32} />
                  </div>
                  <div className="space-y-1.5 px-6">
                    <p className="text-base font-semibold text-foreground">
                      No indexed folders yet
                    </p>
                    <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                      Start by clicking the plus button above to browse and add a
                      directory from your computer.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <p className="text-center text-[11px] text-muted-foreground/60 leading-relaxed pt-4">
            Selected folders will be indexed and available across all tabs.
          </p>
        </div>
      </div>
    </ScrollArea>
  );
}
