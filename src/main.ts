import './lib/polyfills';
import './styles.css';
import { App } from './app';

const root = document.querySelector('#app');
const audio = document.querySelector('#audio');
if (root instanceof HTMLElement && audio instanceof HTMLAudioElement) {
  const app = new App(root, audio);
  void app.start();
}

if (import.meta.env.PROD && !navigator.webdriver) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}
