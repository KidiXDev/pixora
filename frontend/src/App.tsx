import { ConfirmationProvider } from '@/components/providers/confirmation-provider';
import { useEffect, useRef, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { ToggleDevTools } from '../bindings/pixora/internal/services/galleryservice';
import { router } from './routes';
import { useConfigStore } from './stores/config-store';

function App() {
  useEffect(() => {
    useConfigStore.getState().loadConfig();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F12') {
        const config = useConfigStore.getState().config;
        if (config?.devMode) {
          e.preventDefault();
          ToggleDevTools();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <ConfirmationProvider>
      <RouterProvider router={router} />
      <FpsOverlay />
    </ConfirmationProvider>
  );
}

function FpsOverlay() {
  const [fps, setFps] = useState(0);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    let frameCount = 0;
    let lastSampleTime = performance.now();

    const tick = (now: number) => {
      frameCount += 1;
      const elapsed = now - lastSampleTime;

      if (elapsed >= 250) {
        const measuredFps = Math.round((frameCount * 1000) / elapsed);
        setFps(measuredFps);
        frameCount = 0;
        lastSampleTime = now;
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  const fpsColorClass =
    fps < 30
      ? 'text-red-400'
      : fps < 60
        ? 'text-yellow-400'
        : 'text-emerald-400';

  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-9999 rounded-md border border-white/20 bg-black/70 px-2 py-1 font-mono text-xs text-white shadow-lg backdrop-blur-sm">
      FPS: <span className={fpsColorClass}>{fps}</span>
    </div>
  );
}

export default App;
