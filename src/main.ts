import './lib/polyfills';
import './styles.css';
import { App } from './app';

const root = document.querySelector('#app');
const audio = document.querySelector('#audio');
if (root instanceof HTMLElement && audio instanceof HTMLAudioElement) {
  const app = new App(root, audio);
  void app.start();
}

function allowServiceWorker(): boolean {
  if (!import.meta.env.PROD) return false;
  try {
    if (localStorage.getItem('pta-sw') === '1') return true;
  } catch {
    /* storage unavailable */
  }
  return !navigator.webdriver;
}

if (allowServiceWorker()) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}
