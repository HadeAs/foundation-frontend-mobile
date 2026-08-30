import { defineConfig } from 'vite';
import uniModule from '@dcloudio/vite-plugin-uni';

const uni = typeof uniModule === 'function' ? uniModule : uniModule.default;

export default defineConfig({
  plugins: process.env.VITEST ? [] : [uni()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts']
  }
});
