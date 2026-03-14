import { ConfirmationProvider } from '@/components/providers/confirmation-provider';
import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes';
import { useConfigStore } from './stores/config-store';
import { ToggleDevTools } from '../bindings/pixora/internal/services/galleryservice';

function App() {
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Allow context menu only on titlebar (it usually has --wails-draggable)
      const target = e.target as HTMLElement;
      // We can check if the element has data-wails-drag or a specific class
      if (!target.closest('[style*="--wails-draggable:drag"]')) {
        // e.preventDefault();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F12') {
        const config = useConfigStore.getState().config;
        if (config?.devMode) {
          e.preventDefault();
          ToggleDevTools();
        }
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <ConfirmationProvider>
      <RouterProvider router={router} />
    </ConfirmationProvider>
  );
}

export default App;
