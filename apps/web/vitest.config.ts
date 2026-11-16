import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const workspaceRoot = path.resolve(__dirname, '..', '..');

// Esbuild lives in the pnpm store (not hoisted to workspace). Resolve it from
// the pnpm store so vitest can transform JSX in test files.
// Vitest overwrites vite's esbuild config (keeps only target), so JSX from
// tsconfig (jsx: "preserve" for Next.js/SWC) never gets transformed, causing
// "React is not defined" in every .tsx test.
const pnpmStore = path.join(workspaceRoot, 'node_modules', '.pnpm');
const esbuildPkg = fs.readdirSync(pnpmStore).find((d) => d.startsWith('esbuild@'));
if (!esbuildPkg) throw new Error('esbuild not found in pnpm store');
const esbuildPath = path.join(
  pnpmStore,
  esbuildPkg,
  'node_modules',
  'esbuild',
  'lib',
  'main.js',
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const esbuild = require(esbuildPath);

const jsxPlugin = () => {
  return {
    name: 'vitest-jsx-automatic',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!/\.[jt]sx?$/.test(id) || /node_modules/.test(id)) return null;
      const loader = id.endsWith('x') ? 'tsx' : 'ts';
      const result = esbuild.transformSync(code, {
        loader,
        jsx: 'automatic',
        jsxImportSource: 'react',
        target: 'node18',
        sourcemap: true,
      });
      return { code: result.code, map: result.map };
    },
  };
};

export default defineConfig({
  plugins: [react(), jsxPlugin()],
  test: {
    environment: 'jsdom',
    include: ['app/**/*.test.{ts,tsx}', 'components/**/*.test.{ts,tsx}', 'lib/**/*.test.{ts,tsx}'],
  },
});
