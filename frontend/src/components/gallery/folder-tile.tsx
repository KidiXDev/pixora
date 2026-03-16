import { getBaseName } from '@/lib/utils';
import { Folder } from 'lucide-react';
import { memo } from 'react';

interface FolderTileProps {
  folderPath: string;
  folderName: string;
  layoutMode: 'compact' | 'comfortable' | 'spacious';
  onOpen: (path: string) => void;
}

export const FolderTile = memo(function FolderTile({
  folderPath,
  folderName,
  layoutMode,
  onOpen
}: FolderTileProps) {
  const title = folderName.trim() || getBaseName(folderPath) || folderPath;

  const heightClass =
    layoutMode === 'compact'
      ? 'h-40'
      : layoutMode === 'comfortable'
        ? 'h-64'
        : 'h-80';

  return (
    <button
      type="button"
      onClick={() => onOpen(folderPath)}
      className={`group flex w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-md border border-border/60 bg-muted/20 px-4 text-center transition-all hover:border-primary/30 hover:bg-muted/35 ${heightClass}`}
      title={folderPath}
    >
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:text-primary">
        <Folder size={30} strokeWidth={1.9} />
      </div>

      <p className="max-w-full truncate text-sm font-medium text-foreground">
        {title}
      </p>
    </button>
  );
});
