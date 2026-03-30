import { ConfirmationProvider } from '@/components/providers/confirmation-provider';
import { Events } from '@wailsio/runtime';
import { useEffect, useRef, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { GetSetupStatus } from '../bindings/pixora/internal/services/comfyuimanager';
import { ToggleDevTools } from '../bindings/pixora/internal/services/galleryservice';
import { router } from './routes';
import { useConfigStore } from './stores/config-store';

function App() {
  const [globalPermissionMessage, setGlobalPermissionMessage] = useState('');

  useEffect(() => {
    useConfigStore.getState().loadConfig();
  }, []);

  useEffect(() => {
    let active = true;

    const applySetupPayload = (payload: {
      permissionProblem?: boolean;
      permissionMessage?: string;
      statusMessage?: string;
      lastError?: string;
    }) => {
      if (!active) {
        return;
      }

      if (payload.permissionProblem) {
        setGlobalPermissionMessage(
          payload.permissionMessage?.trim() ||
            payload.statusMessage?.trim() ||
            payload.lastError?.trim() ||
            'Pixora cannot write to this folder. Move the app to a normal writable folder.'
        );
        return;
      }

      setGlobalPermissionMessage('');
    };

    void GetSetupStatus()
      .then(applySetupPayload)
      .catch(() => {
        // Ignore setup status read failures here.
      });

    const unsubscribe = Events.On('comfyui:setup', (event) => {
      const payload = Array.isArray(event.data) ? event.data[0] : event.data;
      if (!payload || typeof payload !== 'object') {
        return;
      }

      applySetupPayload(
        payload as {
          permissionProblem?: boolean;
          permissionMessage?: string;
          statusMessage?: string;
          lastError?: string;
        }
      );
    });

    return () => {
      active = false;
      unsubscribe();
    };
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
      {globalPermissionMessage !== '' && (
        <div className="fixed left-4 right-4 top-16 z-9998 rounded-lg border border-destructive/60 bg-destructive/15 px-4 py-3 text-sm text-foreground shadow-lg backdrop-blur-sm">
          <p className="font-medium text-destructive">
            Pixora cannot run correctly in this folder
          </p>
          <p className="mt-1">{globalPermissionMessage}</p>
        </div>
      )}
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
