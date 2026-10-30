import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pure Local / Offline Vite Configuration
// Binds strictly to 127.0.0.1 and proxies /api to the local Node.js service
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Resolves lucide-react directly to the self-contained local SVG module,
      // preventing Vite v7 "Failed to resolve entry for package lucide-react" on Windows
      'lucide-react': path.resolve(__dirname, 'src/lucide-react.tsx'),
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'clsx', 'tailwind-merge'],
    exclude: ['lucide-react'],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3847',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
