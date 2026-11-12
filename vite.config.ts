import { realpathSync } from 'node:fs';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// node_modules darf ein Symlink sein (Worktrees paralleler Agenten) – dann auch dessen echten Pfad ausliefern
const modules = (() => {
  try {
    return [realpathSync('node_modules')];
  } catch {
    return [];
  }
})();

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare({ remoteBindings: false })],
  server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...modules] } },
});
