import { cn } from '@/lib/utils';
import { useGalleryStore } from '@/stores/gallery-store';
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
import { Folder, LayoutGrid, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TabConfig } from '../../../bindings/pixora/internal/config/models';

// ── Sortable Tab Item ────────────────────────────────────────────────────────

interface SortableTabProps {
  tab: TabConfig;
  isActive: boolean;
  onTabChange: (id: string) => void;
  onRemove: (id: string) => void;
}

function SortableTab({
  tab,
  isActive,
  onTabChange,
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'group relative flex h-8 min-w-45 max-w-50 items-center gap-2 rounded-md px-3 transition-all cursor-grab active:cursor-grabbing select-none animate-in fade-in zoom-in-95 duration-300 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary',
        isActive
          ? 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/20'
          : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
        isSortableDragging && 'opacity-40 ring-1 ring-dashed ring-border'
      )}
      onClick={() => onTabChange(tab.id)}
      onKeyDown={(e) => {
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
      <span className="truncate text-xs font-semibold tracking-tight">
        {tab.label}
      </span>

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

      {isActive && (
        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-0.75 bg-primary rounded-full shadow-[0_0_8px_rgba(var(--primary),0.5)] transition-all duration-300" />
      )}
    </div>
  );
}

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
    addTab,
    reorderTabs
  } = useTabsStore();
  const { fetchImages } = useGalleryStore();
  const [activeId, setActiveId] = useState<string | null>(null);

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

  const handleTabChange = (id: string) => {
    setActiveTabId(id);
    fetchImages(true);
  };

  const handleAddTab = async () => {
    await addTab({ label: 'New Tab', path: '', isWalk: true });
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (over && active.id !== over.id) {
      const oldIndex = tabs.findIndex((t) => t.id === active.id);
      const newIndex = tabs.findIndex((t) => t.id === over.id);
      const reordered = arrayMove(tabs, oldIndex, newIndex);
      reorderTabs(reordered);
    }
  };

  const draggingTab = activeId ? tabs.find((t) => t.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-11 w-full items-center gap-1 bg-background/80 backdrop-blur-xl px-2 border-b border-border/40 overflow-x-auto overflow-y-hidden no-scrollbar scroll-smooth">
        <SortableContext
          items={tabs.map((t) => t.id)}
          strategy={horizontalListSortingStrategy}
        >
          {tabs.map((tab) => (
            <SortableTab
              key={tab.id}
              tab={tab}
              isActive={activeTabId === tab.id}
              onTabChange={handleTabChange}
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
