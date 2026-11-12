import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// node_modules darf ein Symlink sein (Worktrees paralleler Agenten) – dann auch dessen echten Pfad ausliefern
const modules = (() => {
  try {
    // auch einzeln verlinkte Pakete (eigenes node_modules/.vite je Worktree)
    return [realpathSync('node_modules'), dirname(realpathSync('node_modules/react'))];
  } catch {
    return [];
  }
})();

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare({ remoteBindings: false })],
  server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...modules] } },
});
