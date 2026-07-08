import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: resolve(__dir, '../vendor'),
    emptyOutDir: false,
    lib: {
      entry: resolve(__dir, 'src/index.js'),
      name: 'LegionWallet',
      formats: ['iife'],
      fileName: () => 'legion-wallet.iife.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    minify: 'esbuild',
    target: 'es2020',
    sourcemap: false,
  },
});
