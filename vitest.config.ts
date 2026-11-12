import { configDefaults, defineConfig } from 'vitest/config';

// Unit-Tests für die geteilte Fachlogik; Worktrees paralleler Agenten und Browser-Tests ausnehmen
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, '.claude/**', 'e2e/**', 'dist/**'] },
});
