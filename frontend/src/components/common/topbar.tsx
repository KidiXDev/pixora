import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search, Settings, LayoutGrid, LayoutList, LayoutPanelLeft, Loader2 } from 'lucide-react';
import { useGalleryStore } from '../../stores/gallery-store';
import { useIndexingStore } from '@/stores/indexing-store';
import { useTabsStore } from '@/stores/tabs-store';
import { Input } from '../ui/input';
import { useDebounce } from 'use-debounce';

export function TopBar() {
  const { searchQuery, setSearchQuery, layoutMode, setLayoutMode } = useGalleryStore();
  const { activeScans, getTotalProcessed } = useIndexingStore();
  const { tabs, activeTabId } = useTabsStore();
  const location = useLocation();
  
  const activeTab = tabs.find(t => t.id === activeTabId);
  const showControls = location.pathname === '/' && activeTab && activeTab.path;

  const [localQuery, setLocalQuery] = useState(searchQuery);
  const [debouncedQuery] = useDebounce(localQuery, 300);

  const isIndexing = Object.values(activeScans).length > 0;
  const totalProcessed = getTotalProcessed();

  useEffect(() => {
    setSearchQuery(debouncedQuery);
  }, [debouncedQuery, setSearchQuery]);

  return (
    <div className="flex h-12 w-full shrink-0 items-center justify-between border-b border-border bg-card/50 backdrop-blur-md px-4 text-card-foreground transition-all">
      <div className="flex flex-1 items-center gap-4">
        {showControls && (
          <div className="relative w-full max-w-[256px] group transition-all duration-300 focus-within:max-w-[400px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <Input
              placeholder="Search prompts, models..."
              value={localQuery}
              onChange={(e) => setLocalQuery(e.target.value)}
              className="pl-9 bg-muted/30 border-transparent focus-visible:ring-1 focus-visible:ring-primary/50 h-9 transition-all hover:bg-muted/50 rounded-lg text-sm"
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {isIndexing && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-primary/20 text-primary border border-primary/30 mr-2 text-xs font-medium animate-in fade-in zoom-in duration-300">
            <Loader2 size={14} className="animate-spin" />
            {totalProcessed > 0 ? `Indexing ${totalProcessed} files...` : 'Indexing...'}
          </div>
        )}
        {showControls && (
          <div className="flex items-center gap-1 rounded-md bg-input/50 p-1 border border-white/5 mr-4">
            <button
              onClick={() => setLayoutMode('compact')}
              className={`p-1.5 rounded-sm transition-colors ${layoutMode === 'compact' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
              title="Compact Grid"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setLayoutMode('comfortable')}
              className={`p-1.5 rounded-sm transition-colors ${layoutMode === 'comfortable' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
              title="Comfortable Grid"
            >
              <LayoutList size={16} />
            </button>
            <button
              onClick={() => setLayoutMode('spacious')}
              className={`p-1.5 rounded-sm transition-colors ${layoutMode === 'spacious' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
              title="Spacious Grid"
            >
              <LayoutPanelLeft size={16} />
            </button>
          </div>
        )}

        {location.pathname !== '/settings' ? (
          <Link
            to="/settings"
            className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <Settings size={18} />
          </Link>
        ) : (
          <Link
            to="/"
            className="flex h-9 items-center justify-center rounded-md px-4 hover:bg-muted transition-colors font-medium text-sm text-muted-foreground hover:text-foreground border border-transparent hover:border-border"
          >
            Back to Gallery
          </Link>
        )}
      </div>
    </div>
  );
}
