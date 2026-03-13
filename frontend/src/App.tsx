import { RouterProvider } from 'react-router-dom';
import { router } from './routes';
import { ConfirmationProvider } from '@/components/providers/confirmation-provider';
import { useEffect } from 'react';

function App() {
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Allow context menu only on titlebar (it usually has --wails-draggable)
      const target = e.target as HTMLElement;
      // We can check if the element has data-wails-drag or a specific class
      if (!target.closest('[style*="--wails-draggable:drag"]')) {
        e.preventDefault();
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  return (
    <ConfirmationProvider>
      <RouterProvider router={router} />
    </ConfirmationProvider>
  );
}

export default App;
