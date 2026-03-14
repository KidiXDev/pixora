import { cn } from '@/lib/utils';
import React, { forwardRef } from 'react';

interface ScrollablePageProps {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
  id?: string;
}

export const ScrollablePage = forwardRef<HTMLDivElement, ScrollablePageProps>(
  ({ children, className, containerClassName, id }, ref) => {
    return (
      <div className={cn('h-full w-full pr-1', containerClassName)}>
        <div
          ref={ref}
          id={id}
          className={cn(
            'h-full w-full overflow-y-auto custom-scrollbar',
            className
          )}
        >
          {children}
        </div>
      </div>
    );
  }
);

ScrollablePage.displayName = 'ScrollablePage';
