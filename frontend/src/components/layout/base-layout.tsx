import { Titlebar } from "../common/windows/titlebar";
import { TopBar } from "../common/topbar";

export function BaseLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <Titlebar />
      <TopBar />
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}
