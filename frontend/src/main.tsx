import { QueryProvider } from '@/components/providers/query-provider';
import { EventsProvider } from '@/components/providers/events-provider';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './global.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryProvider>
      <EventsProvider>
        <TooltipProvider>
          <App />
          <Toaster />
        </TooltipProvider>
      </EventsProvider>
    </QueryProvider>
  </React.StrictMode>
);
