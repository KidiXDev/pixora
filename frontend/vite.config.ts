import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import wails from '@wailsio/runtime/plugins/vite';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), wails('./bindings')]
});
