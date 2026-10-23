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

function ffmpegWorkerAssets(): Plugin {
  return {
    name: 'ffmpeg-worker-assets',
    generateBundle() {
      for (const name of ['const.js', 'errors.js']) {
        this.emitFile({
          type: 'asset',
          fileName: `assets/${name}`,
          source: readFileSync(new URL(`./node_modules/@ffmpeg/ffmpeg/dist/esm/${name}`, import.meta.url)),
        });
      }
    },
  };
}

function headerRules(source: string): { path: string; headers: Record<string, string> }[] {
  const rules: { path: string; headers: Record<string, string> }[] = [];
  let current: { path: string; headers: Record<string, string> } | null = null;
  for (const line of source.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      current = { path: line.trim(), headers: {} };
      rules.push(current);
      continue;
    }
    const match = line.match(/^\s+([^:]+):\s*(.*)$/);
    if (current && match?.[1] && match[2]) current.headers[match[1]] = match[2].trim();
  }
  return rules;
}

function securityHeaders(): Plugin {
  const rules = headerRules(readFileSync(new URL('./public/_headers', import.meta.url), 'utf8'));
  return {
    name: 'security-headers',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '/').split('?')[0] || '/';
        for (const rule of rules) {
          if (rule.path !== '/*' && rule.path !== url) continue;
          for (const [key, value] of Object.entries(rule.headers)) res.setHeader(key, value);
        }
        next();
      });
    },
  };
}

function dropBundledOrtWasm(): Plugin {
  return {
    name: 'drop-bundled-ort-wasm',
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) {
        if (/ort-wasm.*\.wasm$/.test(name)) delete bundle[name];
      }
    },
  };
}

export default defineConfig({
  plugins: [
    bundleLamejs(),
    ffmpegWorkerAssets(),
    dropBundledOrtWasm(),
    sameOriginStyles(),
    securityHeaders(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'THIRD_PARTY_NOTICES.txt'],
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
        globPatterns: ['**/*.{js,css,html,svg,png,mjs,traineddata,wasm,ttf,bcmap,pfb}'],
        globIgnores: ['**/onnx/**/*.wasm', '**/ort-wasm*.wasm'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/pdfjs\//, /^\/tesseract\//, /^\/tessdata\//, /^\/onnx\//, /^\/THIRD_PARTY_NOTICES\.txt$/],
        runtimeCaching: [
          {
            urlPattern: /\/onnx\/.+\.(?:wasm|mjs)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'onnx-runtime', expiration: { maxEntries: 8 } },
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
