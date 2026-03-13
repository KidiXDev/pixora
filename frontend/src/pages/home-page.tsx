import { GalleryGrid } from '@/components/gallery/gallery-grid';
import { MetadataInspector } from '@/components/gallery/metadata-inspector';
import { FullImageViewer } from '@/components/gallery/full-image-viewer';
import { useGalleryStore } from '@/stores/gallery-store';
import { useKeyboardNavigation } from '@/hooks/use-keyboard-navigation';

export default function HomePage() {
  const { selectedImageId } = useGalleryStore();
  useKeyboardNavigation();
  
  return (
    <div className="flex h-full w-full bg-background relative overflow-hidden">
      {/* Main Content Area (Grid / Full Image) */}
      <div className={`transition-all duration-300 ease-in-out h-full relative ${selectedImageId ? 'w-2/3 border-r border-border/50' : 'w-full'}`}>
        {/* We keep grid in DOM always to preserve scroll state */}
        <div className={`absolute inset-0 transition-opacity duration-300 ${selectedImageId ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <GalleryGrid />
        </div>
        
        {/* Full Image Viewer overlay */}
        <div className={`absolute inset-0 transition-opacity duration-300 ${selectedImageId ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <FullImageViewer />
        </div>
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
