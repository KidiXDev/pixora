import { Window } from "@wailsio/runtime";
import { X, Minus, Square } from "lucide-react";

export function Titlebar() {
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
      className="flex h-10 w-full shrink-0 items-center justify-between border-b border-white/10 bg-background text-foreground shadow-sm"
      style={{ "--wails-draggable": "drag" } as React.CSSProperties}
    >
      <div className="flex items-center px-4 font-semibold text-sm">
        Pixora
      </div>
      <div className="flex h-full" style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}>
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
    </div>
  );
}
