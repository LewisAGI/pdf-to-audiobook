import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function bundleLamejs(): Plugin {
  const virtualId = '\0lamejs';
  return {
    name: 'bundle-lamejs',
    enforce: 'pre',
    resolveId(source) {
      if (source === 'lamejs') return virtualId;
    },
    load(id) {
      if (id !== virtualId) return null;
      const code = readFileSync(new URL('./node_modules/lamejs/lame.all.js', import.meta.url), 'utf8');
      return `${code}\nexport const Mp3Encoder = lamejs.Mp3Encoder;\n`;
    },
  };
}

function sameOriginStyles(): Plugin {
  return {
    name: 'same-origin-styles',
    transformIndexHtml(html) {
      return html.replaceAll('<link rel="stylesheet" crossorigin ', '<link rel="stylesheet" ');
    },
  };
}

function securityHeaders(): Plugin {
  const headers: Record<string, string> = {};
  for (const line of readFileSync(new URL('./public/_headers', import.meta.url), 'utf8').split('\n')) {
    const match = line.match(/^\s{2}([^:]+):\s*(.*)$/);
    if (match?.[1] && match[2]) headers[match[1]] = match[2].trim();
  }
  return {
    name: 'security-headers',
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    bundleLamejs(),
    sameOriginStyles(),
    securityHeaders(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'pdf-to-audiobook',
        short_name: 'Audiobook',
        description: 'Turn a PDF or pasted article into an audiobook on your device.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f3efe7',
        theme_color: '#f3efe7',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,mjs,traineddata}'],
        globIgnores: ['**/onnx/**', '**/pdfjs/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/pdfjs\//, /^\/tesseract\//, /^\/tessdata\//, /^\/onnx\//],
        runtimeCaching: [
          {
            urlPattern: /\/onnx\/.+\.wasm$/,
            handler: 'CacheFirst',
            options: { cacheName: 'onnx-wasm', expiration: { maxEntries: 4 } },
          },
          {
            urlPattern: /^https:\/\/huggingface\.co\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'kokoro-model', expiration: { maxEntries: 32 } },
          },
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/@ffmpeg\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'ffmpeg-core', expiration: { maxEntries: 4 } },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 120_000,
  },
});
