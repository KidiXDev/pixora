import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search, Settings, LayoutGrid, LayoutList, LayoutPanelLeft } from 'lucide-react';
import { useGalleryStore } from '../../stores/gallery-store';
import { Input } from '../ui/input';
import { useDebounce } from 'use-debounce';

export function TopBar() {
  const { searchQuery, setSearchQuery, layoutMode, setLayoutMode } = useGalleryStore();
  const location = useLocation();
  
  const [localQuery, setLocalQuery] = useState(searchQuery);
  const [debouncedQuery] = useDebounce(localQuery, 300);

  useEffect(() => {
    setSearchQuery(debouncedQuery);
  }, [debouncedQuery, setSearchQuery]);

  return (
    <div className="flex h-12 w-full shrink-0 items-center justify-between border-b border-border bg-card/50 backdrop-blur-md px-4 text-card-foreground transition-all">
      <div className="flex flex-1 items-center gap-4">
        {location.pathname === '/' && (
          <div className="relative w-64 group">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <Input
              placeholder="Search prompts, models..."
              value={localQuery}
              onChange={(e) => setLocalQuery(e.target.value)}
              className="pl-9 bg-input/50 border-white/5 focus-visible:ring-1 focus-visible:ring-primary h-9 transition-all hover:bg-input/70"
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {location.pathname === '/' && (
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
