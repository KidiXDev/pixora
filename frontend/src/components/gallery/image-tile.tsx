import { ImageRecord } from '../../../bindings/pixora/internal/db/models';
import { motion } from 'framer-motion';
import { Browser } from '@wailsio/runtime';

interface ImageTileProps {
  image: ImageRecord;
  isSelected: boolean;
  onClick: () => void;
  layoutMode: 'compact' | 'comfortable' | 'spacious';
}

export function ImageTile({ image, isSelected, onClick, layoutMode }: ImageTileProps) {
  // Use a placeholder or generated thumbnail.
  // Assuming Wails custom protocol or asset server will serve /thumb/<hash> eventually.
  // For now, testing with an error fallback.
  // In a real implementation we'd probably have an endpoint or custom wails protocol for local images.

  const heightClass = layoutMode === 'compact' ? 'h-32' : layoutMode === 'comfortable' ? 'h-48' : 'h-64';

  const handleDoubleClick = () => {
    // Open the original image in the system's default viewer
    Browser.OpenURL('file://' + image.Path).catch(console.error);
  };

  return (
    <motion.div
      layoutId={`image-${image.ID}`}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      onClick={onClick}
      onDoubleClick={handleDoubleClick}
      className={`relative cursor-pointer overflow-hidden rounded-md bg-muted/50 w-full ${heightClass} ${
        isSelected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:ring-1 hover:ring-border hover:ring-offset-1 hover:ring-offset-background'
      }`}
    >
      <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
        <img
          src={`/thumbs/${image.Hash}.jpg`}
          alt={image.Path.split('\\').pop()?.split('/').pop() || 'Image'}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={(e) => {
            // Fallback if thumb fails to load
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            target.nextElementSibling?.classList.remove('hidden');
          }}
        />
        <span className="hidden opacity-50 break-all px-2 text-center text-xs truncate">
          {image.Path.split('\\').pop()?.split('/').pop()}
        </span>
      </div>
      
      {/* Decorative gradient to simulate an image load */}
      <div className="absolute inset-0 bg-linear-to-tr from-transparent to-black/10 mix-blend-overlay pointer-events-none"></div>

      {/* Tags / Metadata icons overlay */}
      <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {image.Model && (
          <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white backdrop-blur-md">
            {image.Model}
          </span>
        )}
      </div>
    </motion.div>
  );
}
