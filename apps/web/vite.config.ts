import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff,png,svg,glb}'],
        // The full font is a rare fallback; it is fetched (and HTTP-cached) only when a name needs it.
        globIgnores: ['fonts/Pretendard-Bold.woff'],
        // The 3D chunk is ~1 MB uncompressed; it must be cached for offline use.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      manifest: {
        name: '저승 커피 채권관리공사',
        short_name: '업보 커피',
        description: '지각하면 벌칙 커피가 3D 업보 탑으로 쌓이는 팀 장부',
        lang: 'ko',
        start_url: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#141226',
        theme_color: '#141226',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'] },
});
