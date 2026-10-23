import { pinKokoroVoiceUrl } from './kokoro-model';

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function pinRequest(input: RequestInfo | URL): RequestInfo | URL {
  const pinned = pinKokoroVoiceUrl(requestUrl(input));
  return pinned === requestUrl(input) ? input : pinned;
}

export function installKokoroVoicePin(target: { fetch: typeof fetch; caches: CacheStorage }): void {
  const originalFetch = target.fetch.bind(target);
  target.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const pinned = pinRequest(input);
    return originalFetch(pinned, init);
  }) as typeof fetch;
  const originalOpen = target.caches.open.bind(target.caches);
  target.caches.open = async (name: string) => {
    const cache = await originalOpen(name);
    if (name !== 'kokoro-voices') return cache;
    return new Proxy(cache, {
      get(cacheTarget, prop, receiver) {
        if (prop === 'match') {
          return (request: RequestInfo | URL, options?: CacheQueryOptions) => cacheTarget.match(pinRequest(request), options);
        }
        if (prop === 'put') {
          return (request: RequestInfo | URL, response: Response) => cacheTarget.put(pinRequest(request), response);
        }
        const value = Reflect.get(cacheTarget, prop, receiver);
        return typeof value === 'function' ? value.bind(cacheTarget) : value;
      },
    });
  };
}
