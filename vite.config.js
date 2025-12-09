import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import swBootstrapPlugin from './vite-plugin-sw.js';

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(),swBootstrapPlugin()],
})
