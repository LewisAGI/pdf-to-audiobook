/** Pinned Hugging Face revision for onnx-community/Kokoro-82M-v1.0-ONNX (main on 2025-02-08). */
export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const KOKORO_REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';

export function kokoroVoiceUrl(voice: string): string {
  const name = voice.replace(/\.bin$/i, '');
  return `https://huggingface.co/${KOKORO_MODEL}/resolve/${KOKORO_REVISION}/voices/${name}.bin`;
}

export function pinKokoroVoiceUrl(url: string): string {
  if (!url.includes('/resolve/main/voices/')) return url;
  const match = url.match(/\/voices\/([^/?#]+)\.bin/i);
  if (!match?.[1]) return url;
  return kokoroVoiceUrl(match[1]);
}
