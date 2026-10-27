import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** The API the dev server proxies to. Defaults to the local dev server; point it at a running studio
 *  container (e.g. VITE_PROXY_TARGET=http://127.0.0.1:3001) to hot-reload the UI against real models. */
function proxyTo(target: string) {
  return Object.fromEntries(
    ['/api', '/media', '/mcp', '/dl'].map((path) => [path, { target, changeOrigin: false }]),
  );
}

export default defineConfig({
  root: r('./web'),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@shared': r('./shared'), '@web': r('./web/src') } },
  build: { outDir: r('./dist/web'), emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: proxyTo(process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:3000'),
  },
});
