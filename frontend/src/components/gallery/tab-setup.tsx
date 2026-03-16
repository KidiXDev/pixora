import { useConfirmation } from '@/components/providers/confirmation-provider';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useConfigStore } from '@/stores/config-store';
import { useTabsStore } from '@/stores/tabs-store';
import { Dialogs } from '@wailsio/runtime';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import {
  FolderConfig,
  ScanMode
} from '../../../bindings/pixora/internal/config/models';

function SectionHeader({
  title,
  description
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="space-y-1 mb-10">
      <h2 className="text-xl font-bold text-foreground/90">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground font-medium tracking-wider">
          {description}
        </p>
      )}
    </div>
  );
}

function FolderItem({
  folder,
  onSelect,
  active
}: {
  folder: FolderConfig;
  onSelect: (isWalk: boolean) => void;
  active?: boolean;
}) {
  const { removeFolder, updateFolderAlias } = useConfigStore();
  const confirm = useConfirmation();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(folder.alias || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleAlias = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditValue(folder.alias || folder.path.split(/[/\\]/).pop() || '');
  };

  const handleSave = async () => {
    if (editValue !== folder.alias) {
      await updateFolderAlias(folder.path, editValue);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirm.confirm({
      title: 'Stop Watching Folder',
      description:
        'Are you sure? This will remove images from this folder from your gallery index.',
      variant: 'destructive',
      confirmText: 'Remove',
      cancelText: 'Cancel'
    });
    if (ok) await removeFolder(folder.path);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'group flex items-center justify-between py-3.5 px-4 rounded-xl transition-all duration-200 mb-2 border',
        active
          ? 'bg-primary/10 border-primary/20 shadow-sm'
          : 'bg-accent/20 border-white/5 hover:bg-accent/40 hover:border-white/10'
      )}
    >
      {isEditing ? (
        <div
          className="flex-1 min-w-0 px-1"
          onClick={(e) => e.stopPropagation()}
        >
          <Input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className="h-9 text-base bg-background/50 border-primary/30 focus-visible:ring-primary/20"
          />
        </div>
      ) : (
        <button
          onClick={() => onSelect(folder.scanMode === ScanMode.ScanModeWalk)}
          className="flex flex-col flex-1 text-left min-w-0"
        >
          <span
            className={cn(
              'truncate text-base transition-colors',
              active
                ? 'text-primary font-bold'
                : 'text-foreground/80 group-hover:text-foreground'
            )}
          >
            {folder.alias || folder.path.split(/[/\\]/).pop()}
          </span>
          {active ? (
            <span className="text-[10px] text-primary/70 font-bold tracking-[0.15em] mt-1">
              Active Selection
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground/40 font-medium truncate mt-1">
              {folder.path}
            </span>
          )}
        </button>
      )}

      <div className="flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-all duration-200 ml-4 shrink-0">
        {!isEditing && (
          <button
            onClick={handleAlias}
            className="text-[11px] font-bold tracking-widest text-muted-foreground hover:text-primary transition-colors"
          >
            Alias
          </button>
        )}
        <button
          onClick={handleRemove}
          className="text-[11px] font-bold tracking-widest text-destructive/50 hover:text-destructive transition-colors"
        >
          Remove
        </button>
      </div>
    </motion.div>
  );
}

export function TabSetup() {
  const { config, loadConfig } = useConfigStore();
  const { tabs, activeTabId, updateTab } = useTabsStore();

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handlePickFolder = async (mode: ScanMode) => {
    if (!activeTab) return;
    try {
      const selection = await Dialogs.OpenFile({
        Title: 'Select Folder',
        CanChooseDirectories: true,
        AllowsMultipleSelection: false
      });

      if (selection) {
        const path = typeof selection === 'string' ? selection : selection[0];
        const existing = config?.folders?.find((f) => f.path === path);
        await updateTab({
          ...activeTab,
          label: existing?.alias || path.split(/[/\\]/).pop() || 'New Tab',
          path: path,
          isWalk: mode === ScanMode.ScanModeWalk
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (!activeTab) return null;

  const walkFolders =
    config?.folders?.filter((f) => f.scanMode === ScanMode.ScanModeWalk) || [];
  const normalFolders =
    config?.folders?.filter((f) => f.scanMode !== ScanMode.ScanModeWalk) || [];

  return (
    <ScrollArea className="h-full w-full bg-background/30">
      <div className="mx-auto p-12 lg:px-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Column 1: Walk */}
          <section className="lg:col-span-4 space-y-8">
            <SectionHeader
              title="Recursive Scan"
              description="Deep folder discovery"
            />
            <div className="space-y-6">
              <button
                onClick={() => handlePickFolder(ScanMode.ScanModeWalk)}
                className="group w-full flex items-center justify-between py-4 px-5 rounded-xl bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-all"
              >
                <span className="text-base font-bold text-primary">
                  Add New Library
                </span>
                <span className="text-xl text-primary/50 group-hover:text-primary transition-colors">
                  +
                </span>
              </button>

              <div className="flex flex-col">
                <AnimatePresence mode="popLayout">
                  {walkFolders.map((f) => (
                    <FolderItem
                      key={f.path}
                      folder={f}
                      active={activeTab.path === f.path && activeTab.isWalk}
                      onSelect={(isWalk) => {
                        updateTab({
                          ...activeTab,
                          path: f.path,
                          isWalk,
                          label: f.alias || f.path.split(/[/\\]/).pop() || 'Tab'
                        });
                      }}
                    />
                  ))}
                </AnimatePresence>
                {walkFolders.length === 0 && (
                  <div className="py-12 px-4 text-center border border-dashed border-white/5 rounded-2xl bg-white/2">
                    <p className="text-[11px] text-muted-foreground/30 font-bold tracking-widest leading-relaxed">
                      No walk folder added
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Column 2: Normal */}
          <section className="lg:col-span-4 space-y-8">
            <SectionHeader
              title="Standard View"
              description="Single level browsing"
            />
            <div className="space-y-6">
              <button
                onClick={() => handlePickFolder(ScanMode.ScanModeNormal)}
                className="group w-full flex items-center justify-between py-4 px-5 rounded-xl bg-accent/30 border border-white/5 hover:bg-accent/50 transition-all font-medium text-foreground/70"
              >
                <span className="text-base font-bold">View Local Folder</span>
                <span className="text-xl text-foreground/20 group-hover:text-foreground/50 transition-colors">
                  +
                </span>
              </button>

              <div className="flex flex-col">
                <AnimatePresence mode="popLayout">
                  {normalFolders.map((f) => (
                    <FolderItem
                      key={f.path}
                      folder={f}
                      active={activeTab.path === f.path && !activeTab.isWalk}
                      onSelect={(isWalk) => {
                        updateTab({
                          ...activeTab,
                          path: f.path,
                          isWalk,
                          label: f.alias || f.path.split(/[/\\]/).pop() || 'Tab'
                        });
                      }}
                    />
                  ))}
                </AnimatePresence>
                {normalFolders.length === 0 && (
                  <div className="py-12 px-4 text-center border border-dashed border-white/5 rounded-2xl bg-white/2">
                    <p className="text-[11px] text-muted-foreground/30 font-bold tracking-widest leading-relaxed">
                      No normal folder added
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Column 3: Recent */}
          <section className="lg:col-span-4 space-y-8">
            <SectionHeader
              title="Quick History"
              description="Recently added sources"
            />
            <div className="flex flex-col space-y-1.5">
              {config?.folders
                ?.slice()
                .reverse()
                .slice(0, 10)
                .map((f) => {
                  const isActive =
                    activeTab.path === f.path &&
                    ((activeTab.isWalk &&
                      f.scanMode === ScanMode.ScanModeWalk) ||
                      (!activeTab.isWalk &&
                        f.scanMode !== ScanMode.ScanModeWalk));
                  return (
                    <button
                      key={`${f.path}-${f.scanMode}`}
                      onClick={() => {
                        updateTab({
                          ...activeTab,
                          path: f.path,
                          isWalk: f.scanMode === ScanMode.ScanModeWalk,
                          label: f.alias || f.path.split(/[/\\]/).pop() || 'Tab'
                        });
                      }}
                      className={cn(
                        'group flex flex-col items-start py-3.5 px-5 rounded-xl transition-all text-left border',
                        isActive
                          ? 'bg-primary/5 border-primary/20'
                          : 'bg-white/1 border-white/5 hover:bg-accent/40 hover:border-white/10'
                      )}
                    >
                      <span
                        className={cn(
                          'text-[15px] truncate w-full transition-colors',
                          isActive
                            ? 'text-primary font-bold'
                            : 'text-foreground/80 group-hover:text-foreground'
                        )}
                      >
                        {f.alias || f.path.split(/[/\\]/).pop()}
                      </span>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] text-muted-foreground font-bold tracking-[0.05em]">
                          {f.scanMode === ScanMode.ScanModeWalk
                            ? 'Deep Scan'
                            : 'Standard'}
                        </span>
                        {isActive && (
                          <span className="text-[10px] text-primary/60 font-black tracking-[0.05em]">
                            • Active
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              {(!config?.folders || config.folders.length === 0) && (
                <div className="py-20 text-center border border-dashed border-white/5 rounded-2xl bg-white/1">
                  <p className="text-[11px] text-muted-foreground/20 font-bold tracking-widest">
                    No history recorded
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </ScrollArea>
  );
}
