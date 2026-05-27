import { Window, Events } from '@wailsio/runtime';
import { Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export function Titlebar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // Check initial state
    Window.IsMaximised().then(setIsMaximized);

    // Listen to maximize/unmaximize events
    const unsubscribeMaximise = Events.On('common:WindowMaximise', () => {
      setIsMaximized(true);
    });

    const unsubscribeUnmaximise = Events.On('common:WindowUnMaximise', () => {
      setIsMaximized(false);
    });

    const unsubscribeRestore = Events.On('common:WindowRestore', () => {
      Window.IsMaximised().then(setIsMaximized);
    });

    return () => {
      unsubscribeMaximise();
      unsubscribeUnmaximise();
      unsubscribeRestore();
    };
  }, []);

  const handleMinimize = () => {
    Window.Minimise();
  };

  const handleMaximize = () => {
    Window.ToggleMaximise();
  };

  const handleClose = () => {
    Window.Close();
  };

  return (
    <div
      onDoubleClick={handleMaximize}
      className="titlebar-panel relative z-10000 flex h-10 w-full shrink-0 items-center justify-between border-b border-white/10 bg-background text-foreground shadow-sm select-none"
      style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center px-4 font-semibold text-sm">Pixora</div>
      <div
        className="flex h-full"
        style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={handleMinimize}
          className="flex h-full w-12 items-center justify-center hover:bg-muted transition-colors"
        >
          <Minus size={16} />
        </button>
        <button
          onClick={handleMaximize}
          className="flex h-full w-12 items-center justify-center hover:bg-muted transition-colors"
        >
          <Square size={14} />
        </button>
        <button
          onClick={handleClose}
          className="flex h-full w-12 items-center justify-center hover:bg-destructive hover:text-destructive-foreground transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {!isMaximized && (
        <>
          <div
            aria-hidden="true"
            className="absolute top-0 right-0 h-full w-px"
            style={{ '--wails-resize': 'right' } as React.CSSProperties}
          />
          <div
            aria-hidden="true"
            className="absolute top-0 right-0 h-px w-full"
            style={{ '--wails-resize': 'top' } as React.CSSProperties}
          />
        </>
      )}
    </div>
  );
}

