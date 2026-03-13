import { GalleryGrid } from '@/components/gallery/gallery-grid';
import { MetadataInspector } from '@/components/gallery/metadata-inspector';
import { useGalleryStore } from '@/stores/gallery-store';
import { useKeyboardNavigation } from '@/hooks/use-keyboard-navigation';

export default function HomePage() {
  const { selectedImageId } = useGalleryStore();
  useKeyboardNavigation();
  
  return (
    <div className="flex h-full w-full bg-background relative overflow-hidden">
      {/* Main Virtualized Grid */}
      <div className={`transition-all duration-300 ease-in-out h-full ${selectedImageId ? 'w-2/3 border-r border-border/50' : 'w-full'}`}>
        <GalleryGrid />
      </div>

      {/* Metadata Slide-in Panel */}
      <div 
        className={`absolute right-0 top-0 h-full w-1/3 bg-card/80 backdrop-blur-xl border-l border-white/10 shadow-2xl transition-transform duration-300 ease-in-out z-10 ${
          selectedImageId ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <MetadataInspector />
      </div>
    </div>
  );
}
