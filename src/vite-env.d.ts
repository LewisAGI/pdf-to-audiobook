/// <reference types="vite/client" />

declare module 'virtual:pwa-register' {
  export function registerSW(options?: { immediate?: boolean }): void;
}

declare module '@ffmpeg/ffmpeg/worker?url' {
  const url: string;
  export default url;
}
