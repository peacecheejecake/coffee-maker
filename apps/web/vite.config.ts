import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'] },
  build: {
    rollupOptions: {
      output: {
        // three + R3F/drei change rarely; keep them in their own long-cached chunk.
        manualChunks: (id) => (/node_modules\/.*(three|@react-three)/.test(id) ? 'three' : undefined),
      },
    },
  },
});
