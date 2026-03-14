import { CompareImageViewer } from '@/components/gallery/compare-image-viewer';
import { CompareInspector } from '@/components/gallery/compare-inspector';
import { FullImageViewer } from '@/components/gallery/full-image-viewer';
import { GalleryGrid } from '@/components/gallery/gallery-grid';
import { MetadataInspector } from '@/components/gallery/metadata-inspector';
import { useKeyboardNavigation } from '@/hooks/use-keyboard-navigation';
import { useGalleryStore } from '@/stores/gallery-store';

export default function HomePage() {
  const { selectedImageId, compareImageIds } = useGalleryStore();
  const isCompareMode = Boolean(compareImageIds);
  const hasActiveViewer = Boolean(selectedImageId) || isCompareMode;

  useKeyboardNavigation();

  return (
    <div className="flex h-full w-full bg-background relative overflow-hidden">
      {/* Main Content Area (Grid / Full Image) */}
      <div className="h-full w-full relative">
        {/* We keep grid in DOM always to preserve scroll state */}
        <div
          className={`absolute inset-0 transition-opacity duration-300 ${hasActiveViewer ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        >
          <GalleryGrid />
        </div>

        {/* Full Image Viewer overlay */}
        <div
          className={`absolute inset-0 transition-opacity duration-300 ${selectedImageId && !isCompareMode ? 'opacity-100 pointer-events-auto pr-[33.333%]' : 'opacity-0 pointer-events-none pr-0'}`}
        >
          <FullImageViewer />
        </div>

        {/* Compare Viewer overlay */}
        <div
          className={`absolute inset-0 transition-opacity duration-300 ${isCompareMode ? 'opacity-100 pointer-events-auto pr-[33.333%]' : 'opacity-0 pointer-events-none pr-0'}`}
        >
          <CompareImageViewer />
        </div>
      </div>

      {/* Metadata Slide-in Panel */}
      <div
        className={`absolute right-0 top-0 h-full w-1/3 bg-card/80 backdrop-blur-xl border-l border-white/10 shadow-2xl transition-transform duration-300 ease-in-out z-10 ${
          hasActiveViewer ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {isCompareMode ? <CompareInspector /> : <MetadataInspector />}
      </div>
    </div>
  );
}
