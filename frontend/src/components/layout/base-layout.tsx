import { Titlebar } from '../common/windows/titlebar';
import { TabNavigation } from './tab-navigation';

export function BaseLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <Titlebar />
      <TabNavigation />
      <div className="flex-1 overflow-hidden relative">{children}</div>
    </div>
  );
}
