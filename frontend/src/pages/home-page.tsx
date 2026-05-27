import { CompareImageViewer } from '@/components/gallery/compare-image-viewer';
import { CompareInspector } from '@/components/gallery/compare-inspector';
import { FullImageViewer } from '@/components/gallery/full-image-viewer';
import { GalleryGrid } from '@/components/gallery/gallery-grid';
import { MetadataInspector } from '@/components/gallery/metadata-inspector';
import { useKeyboardNavigation } from '@/hooks/use-keyboard-navigation';
import { useGalleryStore } from '@/stores/gallery-store';

export default function HomePage() {
  const selectedImageId = useGalleryStore((state) => state.selectedImageId);
  const compareImageIds = useGalleryStore((state) => state.compareImageIds);
  const isTabSwitching = useGalleryStore((state) => state.isTabSwitching);
  const isCompareMode = Boolean(compareImageIds);
  const hasActiveViewer = Boolean(selectedImageId) || isCompareMode;

  useKeyboardNavigation();

  return (
    <div className="flex h-full w-full bg-background relative overflow-hidden select-none">
      <div className="h-full w-full relative">
        <div
          className={`absolute inset-0 ${isTabSwitching ? 'transition-none' : 'transition-opacity duration-300'} ${hasActiveViewer ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}
        >
          <GalleryGrid />
        </div>

        <div
          className={`absolute inset-0 ${
            isTabSwitching ? 'transition-none' : 'transition-all duration-300'
          } ${
            selectedImageId && !isCompareMode
              ? 'opacity-100 pointer-events-auto bg-black/70 backdrop-blur-md'
              : 'opacity-0 pointer-events-none bg-black/0 backdrop-blur-none'
          }`}
        >
          <FullImageViewer />
        </div>

        <div
          className={`absolute inset-0 ${isTabSwitching ? 'transition-none' : 'transition-opacity duration-300'} ${isCompareMode ? 'opacity-100 pointer-events-auto pr-[33.333%]' : 'opacity-0 pointer-events-none pr-0'}`}
        >
          <CompareImageViewer />
        </div>
      </div>

      <div
        className={`absolute right-0 top-0 h-full w-1/3 bg-card/80 backdrop-blur-xl border-l border-white/10 shadow-2xl ${
          isTabSwitching ? 'transition-none' : 'transition-transform duration-300 ease-in-out'
        } z-10 ${
          hasActiveViewer ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {isCompareMode ? <CompareInspector /> : <MetadataInspector />}
      </div>
    </div>
  );
}
