import { defineConfig } from 'vite';
import uniModule from '@dcloudio/vite-plugin-uni';
import vue from '@vitejs/plugin-vue';

const uni = typeof uniModule === 'function' ? uniModule : uniModule.default;

export default defineConfig({
  plugins: process.env.VITEST ? [vue({ template: { compilerOptions: { isCustomElement: (tag) => ['view', 'text'].includes(tag) } } })] : [uni()],
  server: {
    proxy: {
      '/api': {
        target: 'http://192.168.0.171:18080',
        changeOrigin: true
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts']
  }
});
