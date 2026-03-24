import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ImageGenerationMode } from '@/types/image-generation';
import {
  History,
  Image as ImageIcon,
  ImagesIcon,
  LayoutGrid,
  Settings2
} from 'lucide-react';

interface GenerationSideNavProps {
  mode: ImageGenerationMode;
  onModeChange: (mode: ImageGenerationMode) => void;
  onOpenSettings: () => void;
  className?: string;
}

export function GenerationSideNav({
  mode,
  onModeChange,
  onOpenSettings,
  className
}: GenerationSideNavProps) {
  const navItems = [
    {
      id: 'txt2img',
      label: 'Text to Image',
      icon: ImageIcon,
      active: mode === 'txt2img',
      onClick: () => onModeChange('txt2img')
    },
    {
      id: 'img2img',
      label: 'Image to Image',
      icon: ImagesIcon,
      active: mode === 'img2img',
      onClick: () => onModeChange('img2img')
    }
  ];

  const bottomItems = [
    {
      id: 'gallery',
      label: 'Gallery',
      icon: LayoutGrid
    },
    {
      id: 'history',
      label: 'History',
      icon: History
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings2,
      onClick: onOpenSettings
    }
  ];

  return (
    <aside
      className={cn(
        'flex flex-col items-center py-6 px-3 border-r border-border/40 bg-card/30 backdrop-blur-xl h-full w-[72px]',
        className
      )}
    >
      <div className="flex flex-col gap-4 flex-1">
        {navItems.map((item) => (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size="icon"
                className={cn(
                  'size-11 rounded-xl transition-all duration-300',
                  item.active
                    ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                    : 'text-muted-foreground hover:text-foreground bg-transparent'
                )}
                onClick={item.onClick}
              >
                <item.icon className="size-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" align="center" className="font-medium">
              {item.label}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div className="flex flex-col gap-4 mt-auto">
        {bottomItems.map((item) => (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={item.onClick}
                className="size-11 rounded-xl text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-all duration-300"
              >
                <item.icon className="size-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" align="center" className="font-medium">
              {item.label}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </aside>
  );
}
