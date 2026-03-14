import { SETTINGS_TAB_PATH, isPageTabPath } from '@/lib/tab-pages';
import { cn } from '@/lib/utils';
import { useGalleryStore } from '@/stores/gallery-store';
import { useIndexingStore } from '@/stores/indexing-store';
import { useTabsStore } from '@/stores/tabs-store';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Copy,
  Folder,
  LayoutGrid,
  LayoutList,
  LayoutPanelLeft,
  Loader2,
  Pencil,
  Plus,
  Search,
  Settings,
  X
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useDebounce } from 'use-debounce';
import { TabConfig } from '../../../bindings/pixora/internal/config/models';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '../ui/context-menu';
import { Input } from '../ui/input';
import { Separator } from '../ui/separator';

// ── Sortable Tab Item ────────────────────────────────────────────────────────

interface SortableTabProps {
  tab: TabConfig;
  isActive: boolean;
  onTabChange: (id: string) => void;
  onRename: (id: string, nextLabel: string) => Promise<void>;
  onDuplicate: (id: string) => Promise<void>;
  onCloseOthers: (id: string) => Promise<void>;
  onRemove: (id: string) => void;
  canCloseOthers: boolean;
}

const SortableTab = memo(function SortableTab({
  tab,
  isActive,
  onTabChange,
  onRename,
  onDuplicate,
  onCloseOthers,
  canCloseOthers,
  onRemove
}: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging
  } = useSortable({ id: tab.id });
  const [isRenaming, setIsRenaming] = useState(false);
  const [labelDraft, setLabelDraft] = useState(tab.label);

  useEffect(() => {
    setLabelDraft(tab.label);
  }, [tab.label]);

  const commitRename = async () => {
    const nextLabel = labelDraft.trim();
    setIsRenaming(false);
    if (!nextLabel || nextLabel === tab.label) return;
    await onRename(tab.id, nextLabel);
  };

  const style = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition
    }),
    [transform, transition]
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          className={cn(
            'group relative overflow-y-hidden flex h-8 min-w-45 max-w-50 items-center gap-2 rounded-md px-3 transition-all cursor-pointer active:cursor-grabbing select-none animate-in fade-in zoom-in-95 duration-300 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary',
            isActive
              ? 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/20'
              : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
            isSortableDragging && 'opacity-40 ring-1 ring-dashed ring-border',
            isRenaming && 'cursor-default active:cursor-default'
          )}
          onClick={() => {
            if (isRenaming) return;
            onTabChange(tab.id);
          }}
          onKeyDown={(e) => {
            if (isRenaming) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onTabChange(tab.id);
            }
          }}
          tabIndex={0}
          role="tab"
          aria-selected={isActive}
        >
          {tab.path ? (
            <Folder
              size={14}
              className={cn('shrink-0 transition-transform duration-300')}
            />
          ) : (
            <LayoutGrid
              size={14}
              className={cn('shrink-0 transition-transform duration-300')}
            />
          )}

          {isRenaming ? (
            <Input
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              className="h-6 text-xs px-1.5"
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitRename();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setLabelDraft(tab.label);
                  setIsRenaming(false);
                }
              }}
              onBlur={() => {
                commitRename();
              }}
            />
          ) : (
            <span className="truncate text-xs font-semibold tracking-tight">
              {tab.label}
            </span>
          )}

          {!isRenaming && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(tab.id);
              }}
              className={cn(
                'ml-auto rounded-full p-0.5 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100',
                isActive && 'opacity-40'
              )}
            >
              <X size={12} />
            </button>
          )}

          {isActive && (
            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-0.75 bg-primary rounded-full shadow-[0_0_8px_rgba(var(--primary),0.5)] transition-all duration-300" />
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48" sideOffset={6}>
        <ContextMenuItem disabled className="text-xs font-medium opacity-80">
          {tab.label}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => {
            setIsRenaming(true);
          }}
        >
          <Pencil size={14} />
          Rename Tab
        </ContextMenuItem>
        <ContextMenuItem
          onClick={async () => {
            await onDuplicate(tab.id);
          }}
        >
          <Copy size={14} />
          Duplicate Tab
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canCloseOthers}
          onClick={async () => {
            if (!canCloseOthers) return;
            await onCloseOthers(tab.id);
          }}
        >
          <X size={14} />
          Close Other Tabs
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() => {
            onRemove(tab.id);
          }}
        >
          <X size={14} />
          Close Tab
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

// ── Drag Overlay (ghost tab while dragging) ──────────────────────────────────

function TabDragOverlay({
  tab,
  isActive
}: {
  tab: TabConfig;
  isActive: boolean;
}) {
  return (
    <div
      className={cn(
        'flex h-8 min-w-25 max-w-50 items-center gap-2 rounded-md px-3 shadow-xl ring-1 cursor-grabbing select-none rotate-1 scale-105 opacity-95',
        isActive
          ? 'bg-primary/15 text-primary ring-primary/30'
          : 'bg-muted text-foreground ring-border'
      )}
    >
      {tab.path ? (
        <Folder size={14} className="shrink-0" />
      ) : (
        <LayoutGrid size={14} className="shrink-0" />
      )}
      <span className="truncate text-xs font-semibold tracking-tight">
        {tab.label}
      </span>
      <X size={12} className="ml-auto opacity-40" />
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function TabNavigation() {
  const {
    tabs,
    activeTabId,
    setActiveTabId,
    fetchTabs,
    removeTab,
    updateTab,
    addTab,
    reorderTabs
  } = useTabsStore();
  const {
    fetchImages,
    searchQuery,
    setSearchQuery,
    layoutMode,
    setLayoutMode
  } = useGalleryStore();
  const { activeScans, getTotalProcessed } = useIndexingStore();
  const location = useLocation();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [localQuery, setLocalQuery] = useState(searchQuery);
  const [debouncedQuery] = useDebounce(localQuery, 300);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId),
    [tabs, activeTabId]
  );
  const showControls =
    location.pathname === '/' &&
    activeTab &&
    activeTab.path &&
    !isPageTabPath(activeTab.path);

  const isIndexing = Object.values(activeScans).length > 0;
  const totalProcessed = getTotalProcessed();

  useEffect(() => {
    setSearchQuery(debouncedQuery);
  }, [debouncedQuery, setSearchQuery]);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 10 }
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  useEffect(() => {
    fetchTabs();
  }, [fetchTabs]);

  // Handle Ctrl+W to close active tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
        if (activeTabId) {
          e.preventDefault();
          removeTab(activeTabId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId, removeTab]);

  const handleTabChange = useCallback(
    (id: string) => {
      setActiveTabId(id);
      fetchImages(true);
    },
    [setActiveTabId, fetchImages]
  );

  const handleAddTab = useCallback(async () => {
    await addTab({ label: 'New Tab', path: '', isWalk: true });
  }, [addTab]);

  const handleRenameTab = useCallback(
    async (id: string, nextLabel: string) => {
      const targetTab = tabs.find((t) => t.id === id);
      if (!targetTab) return;
      await updateTab({
        ...targetTab,
        label: nextLabel
      });
    },
    [tabs, updateTab]
  );

  const handleDuplicateTab = useCallback(
    async (id: string) => {
      const targetTab = tabs.find((t) => t.id === id);
      if (!targetTab) return;

      const baseLabel = (targetTab.label || 'New Tab').trim();
      await addTab({
        label: `${baseLabel} Copy`,
        path: targetTab.path,
        isWalk: targetTab.isWalk
      });
    },
    [tabs, addTab]
  );

  const handleCloseOtherTabs = useCallback(
    async (id: string) => {
      const tabsToClose = tabs.filter((t) => t.id !== id);
      for (const tab of tabsToClose) {
        await removeTab(tab.id);
      }
      setActiveTabId(id);
    },
    [tabs, removeTab, setActiveTabId]
  );

  const handleOpenSettingsTab = useCallback(async () => {
    const existingSettingsTab = tabs.find(
      (tab) => tab.path === SETTINGS_TAB_PATH
    );
    if (existingSettingsTab) {
      setActiveTabId(existingSettingsTab.id);
      return;
    }

    await addTab({ label: 'Settings', path: SETTINGS_TAB_PATH, isWalk: false });
  }, [tabs, setActiveTabId, addTab]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (over && active.id !== over.id) {
        const oldIndex = tabs.findIndex((t) => t.id === active.id);
        const newIndex = tabs.findIndex((t) => t.id === over.id);
        const reordered = arrayMove(tabs, oldIndex, newIndex);
        reorderTabs(reordered);
      }
    },
    [tabs, reorderTabs]
  );

  const draggingTab = useMemo(
    () => (activeId ? tabs.find((t) => t.id === activeId) : null),
    [activeId, tabs]
  );
  const tabIds = useMemo(() => tabs.map((t) => t.id), [tabs]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-12 w-full items-center justify-between bg-background/80 backdrop-blur-xl border-b border-border/40 px-2 overflow-hidden">
        {/* Scrollable Tabs Area */}
        <div className="flex flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden no-scrollbar contain-[layout_style_paint]">
          <SortableContext
            items={tabIds}
            strategy={horizontalListSortingStrategy}
          >
            {tabs.map((tab) => (
              <SortableTab
                key={tab.id}
                tab={tab}
                isActive={activeTabId === tab.id}
                onTabChange={handleTabChange}
                onRename={handleRenameTab}
                onDuplicate={handleDuplicateTab}
                onCloseOthers={handleCloseOtherTabs}
                canCloseOthers={tabs.length > 1}
                onRemove={removeTab}
              />
            ))}
          </SortableContext>

          <button
            onClick={handleAddTab}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors ml-1 shrink-0"
            title="Add Folder Tab"
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Separator */}
        <Separator
          orientation="vertical"
          className="h-full mx-2 bg-border/80"
        />

        {/* Fixed Right Controls */}
        <div className="flex items-center gap-2 px-2 shrink-0 ml-1 animate-in fade-in slide-in-from-right-4 duration-500">
          {isIndexing && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 mr-1 text-[10px] font-semibold tracking-tight uppercase animate-in fade-in zoom-in duration-300">
              <Loader2 size={12} className="animate-spin" />
              Indexing {totalProcessed > 0 && `${totalProcessed}`} Files
            </div>
          )}

          {showControls && (
            <>
              <div className="relative group transition-all duration-300 w-40 focus-within:w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                  placeholder="Search gallery..."
                  value={localQuery}
                  onChange={(e) => setLocalQuery(e.target.value)}
                  className="pl-8 h-8 bg-muted/30 border-transparent focus-visible:ring-1 focus-visible:ring-primary/40 text-xs rounded-lg"
                />
              </div>

              <div className="flex items-center gap-0.5 rounded-lg bg-muted/40 p-0.5 border border-border/10">
                <button
                  onClick={() => setLayoutMode('compact')}
                  className={cn(
                    'p-1 px-1.5 rounded-md transition-all',
                    layoutMode === 'compact'
                      ? 'bg-background text-primary shadow-xs ring-1 ring-border/20'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  title="Compact"
                >
                  <LayoutGrid size={13} />
                </button>
                <button
                  onClick={() => setLayoutMode('comfortable')}
                  className={cn(
                    'p-1 px-1.5 rounded-md transition-all',
                    layoutMode === 'comfortable'
                      ? 'bg-background text-primary shadow-xs ring-1 ring-border/20'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  title="Comfortable"
                >
                  <LayoutList size={13} />
                </button>
                <button
                  onClick={() => setLayoutMode('spacious')}
                  className={cn(
                    'p-1 px-1.5 rounded-md transition-all',
                    layoutMode === 'spacious'
                      ? 'bg-background text-primary shadow-xs ring-1 ring-border/20'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  title="Spacious"
                >
                  <LayoutPanelLeft size={13} />
                </button>
              </div>
            </>
          )}

          <button
            onClick={handleOpenSettingsTab}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Settings"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
        {draggingTab && (
          <TabDragOverlay
            tab={draggingTab}
            isActive={activeTabId === draggingTab.id}
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}
