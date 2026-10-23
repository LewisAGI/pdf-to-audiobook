type TryFn = (callback: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown>;

const promiseWithTry = Promise as unknown as { try?: TryFn };
if (typeof promiseWithTry.try !== 'function') {
  promiseWithTry.try = (callback, ...args) =>
    new Promise((resolve, reject) => {
      try {
        resolve(callback(...args));
      } catch (error) {
        reject(error);
      }
    });
}

const bytes = Uint8Array.prototype as Uint8Array & { toHex?: () => string; toBase64?: () => string };
if (typeof bytes.toHex !== 'function') {
  bytes.toHex = function toHex(this: Uint8Array) {
    let hex = '';
    for (let index = 0; index < this.length; index += 1) hex += (this[index] ?? 0).toString(16).padStart(2, '0');
    return hex;
  };
}
if (typeof bytes.toBase64 !== 'function') {
  bytes.toBase64 = function toBase64(this: Uint8Array) {
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < this.length; index += chunk) {
      binary += String.fromCharCode(...this.subarray(index, index + chunk));
    }
    return btoa(binary);
  };
}
const mapProto = Map.prototype as Map<unknown, unknown> & {
  getOrInsertComputed?: (key: unknown, callback: (key: unknown) => unknown) => unknown;
};
if (typeof mapProto.getOrInsertComputed !== 'function') {
  mapProto.getOrInsertComputed = function getOrInsertComputed(this: Map<unknown, unknown>, key, callback) {
    if (this.has(key)) return this.get(key);
    const value = callback(key);
    this.set(key, value);
    return value;
  };
}

const bytesCtor = Uint8Array as unknown as { fromBase64?: (value: string) => Uint8Array };
if (typeof bytesCtor.fromBase64 !== 'function') {
  bytesCtor.fromBase64 = (value: string) => {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
    return out;
  };
}
