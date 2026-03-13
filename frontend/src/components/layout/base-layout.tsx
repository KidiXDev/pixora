import { Titlebar } from "../common/windows/titlebar";
import { TopBar } from "../common/topbar";
import { TabNavigation } from "./tab-navigation";

export function BaseLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <Titlebar />
      <TabNavigation />
      <TopBar />
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}
