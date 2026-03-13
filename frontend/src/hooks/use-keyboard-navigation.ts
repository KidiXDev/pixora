import { useEffect } from 'react';
import { useGalleryStore } from '../stores/gallery-store';

export function useKeyboardNavigation() {
  const { images, selectedImageId, setSelectedImageId } = useGalleryStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      if (!selectedImageId) {
        // If nothing is selected, selecting the first one on arrow right
        if (e.key === 'ArrowRight' && images.length > 0) {
          setSelectedImageId(images[0].ID);
        }
        return;
      }

      const currentIndex = images.findIndex((img) => img.ID === selectedImageId);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex;

      switch (e.key) {
        case 'ArrowRight':
          nextIndex = Math.min(currentIndex + 1, images.length - 1);
          break;
        case 'ArrowLeft':
          nextIndex = Math.max(currentIndex - 1, 0);
          break;
        case 'Escape':
          setSelectedImageId(null);
          break;
        case 'f':
        case 'F':
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
          } else {
            document.exitFullscreen().catch(() => {});
          }
          break;
      }

      if (nextIndex !== currentIndex) {
        setSelectedImageId(images[nextIndex].ID);
        // Note: For a comprehensive grid, we'd also implement Up/Down accounting for columns
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [images, selectedImageId, setSelectedImageId]);
}
