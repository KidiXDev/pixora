import { Titlebar } from "../common/windows/titlebar";

export function BaseLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <Titlebar />
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}
