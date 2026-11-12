import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// node_modules darf ein Symlink sein (Worktrees paralleler Agenten) – dann auch dessen echten Pfad ausliefern
// Auch einzeln verlinkte Pakete (eigener node_modules-Ordner mit Links je Paket, eigener .vite-Cache) abdecken.
const modules = (() => {
  try {
    return [...new Set([realpathSync('node_modules'), dirname(dirname(realpathSync('node_modules/vite/package.json')))])];
  } catch {
    return [];
  }
})();

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare({ remoteBindings: false })],
  server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...modules] } },
});
