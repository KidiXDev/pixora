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
    <div className="space-y-2.5 mb-8 pb-6 border-b border-white/5">
      <h2 className="text-lg font-bold text-foreground tracking-tight">
        {title}
      </h2>
      {description && (
        <p className="text-xs text-muted-foreground/70 font-medium tracking-wider leading-relaxed uppercase">
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
      onClick={() =>
        !isEditing && onSelect(folder.scanMode === ScanMode.ScanModeWalk)
      }
      onKeyDown={(e) => {
        if (!isEditing && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(folder.scanMode === ScanMode.ScanModeWalk);
        }
      }}
      tabIndex={0}
      role="button"
      className={cn(
        'group flex items-center justify-between py-3 px-4 rounded-lg transition-all duration-200 mb-2.5 border cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        active
          ? 'bg-primary/15 border-primary/40 shadow-md hover:shadow-lg'
          : 'bg-white/3 border-white/8 hover:bg-white/5 hover:border-white/12'
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
        <div className="flex flex-col flex-1 text-left min-w-0">
          <span
            className={cn(
              'truncate text-sm font-semibold transition-colors',
              active
                ? 'text-primary'
                : 'text-foreground/75 group-hover:text-foreground'
            )}
          >
            {folder.alias || folder.path.split(/[/\\]/).pop()}
          </span>
          {active ? (
            <span className="text-[9px] text-primary/60 font-bold tracking-[0.12em] mt-1.5 uppercase">
              Active Selection
            </span>
          ) : (
            <span className="text-[9px] text-muted-foreground/50 font-medium truncate mt-1.5">
              {folder.path}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-all duration-200 ml-4 shrink-0">
        {!isEditing && (
          <button
            onClick={handleAlias}
            className="text-[10px] font-bold tracking-wider text-muted-foreground/60 hover:text-primary transition-colors uppercase"
          >
            Rename
          </button>
        )}
        <button
          onClick={handleRemove}
          className="text-[10px] font-bold tracking-wider text-destructive/40 hover:text-destructive transition-colors uppercase"
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
            <SectionHeader title="Recursive Scan" />
            <div className="space-y-6">
              <button
                onClick={() => handlePickFolder(ScanMode.ScanModeWalk)}
                className="group w-full flex items-center justify-between py-3.5 px-5 rounded-lg bg-primary/10 border border-primary/30 hover:bg-primary/15 hover:border-primary/40 transition-all shadow-sm hover:shadow-md"
              >
                <span className="text-sm font-bold text-primary tracking-tight">
                  Add New Folder
                </span>
                <span className="text-lg text-primary/60 group-hover:text-primary transition-colors font-light">
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
                  <div className="py-14 px-4 text-center border border-dashed border-white/10 rounded-lg bg-white/3">
                    <p className="text-xs text-muted-foreground/40 font-semibold tracking-wide leading-relaxed uppercase">
                      No folders yet
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Column 2: Normal */}
          <section className="lg:col-span-4 space-y-8">
            <SectionHeader title="Standard View" />
            <div className="space-y-6">
              <button
                onClick={() => handlePickFolder(ScanMode.ScanModeNormal)}
                className="group w-full flex items-center justify-between py-3.5 px-5 rounded-lg bg-accent/20 border border-white/10 hover:bg-accent/30 hover:border-white/15 transition-all shadow-sm hover:shadow-md"
              >
                <span className="text-sm font-bold text-foreground/80 tracking-tight">
                  Add New Folder
                </span>
                <span className="text-lg text-foreground/30 group-hover:text-foreground/50 transition-colors font-light">
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
                  <div className="py-14 px-4 text-center border border-dashed border-white/10 rounded-lg bg-white/3">
                    <p className="text-xs text-muted-foreground/40 font-semibold tracking-wide leading-relaxed uppercase">
                      No folders yet
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Column 3: Recent */}
          <section className="lg:col-span-4 space-y-8">
            <SectionHeader title="Quick History" />
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
                        'group flex flex-col items-start py-3 px-4 rounded-lg transition-all text-left border',
                        isActive
                          ? 'bg-primary/12 border-primary/35 shadow-sm hover:shadow-md'
                          : 'bg-white/2 border-white/8 hover:bg-white/4 hover:border-white/12'
                      )}
                    >
                      <span
                        className={cn(
                          'text-sm font-semibold truncate w-full transition-colors',
                          isActive
                            ? 'text-primary'
                            : 'text-foreground/75 group-hover:text-foreground'
                        )}
                      >
                        {f.alias || f.path.split(/[/\\]/).pop()}
                      </span>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[9px] text-muted-foreground/60 font-semibold tracking-wide uppercase">
                          {f.scanMode === ScanMode.ScanModeWalk
                            ? 'Deep Scan'
                            : 'Standard'}
                        </span>
                        {isActive && (
                          <span className="text-[9px] text-primary/50 font-bold tracking-wide">
                            • Active
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              {(!config?.folders || config.folders.length === 0) && (
                <div className="py-20 text-center border border-dashed border-white/10 rounded-lg bg-white/2">
                  <p className="text-xs text-muted-foreground/35 font-semibold tracking-wide uppercase">
                    No history yet
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
