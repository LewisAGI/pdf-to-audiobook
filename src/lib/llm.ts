export const LLM_KEY_PREFIX = 'pta-llm-key:';

export type LlmSettings = {
  endpoint: string;
  model: string;
  apiKey: string;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

export function endpointOrigin(endpoint: string): string {
  try {
    return new URL(normalizeEndpoint(endpoint)).origin;
  } catch {
    return '';
  }
}

export function llmKeyName(endpoint: string): string {
  const origin = endpointOrigin(endpoint);
  return `${LLM_KEY_PREFIX}${origin || 'invalid'}`;
}

export function readLlmKey(storage: StorageLike, endpoint: string): string {
  return storage.getItem(llmKeyName(endpoint)) ?? '';
}

export function writeLlmKey(storage: StorageLike, endpoint: string, key: string): void {
  const name = llmKeyName(endpoint);
  const trimmed = key.trim();
  if (!trimmed) storage.removeItem(name);
  else storage.setItem(name, trimmed);
  storage.removeItem('pta-llm-key');
}

export function llmChunks(text: string, limit = 12000): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= limit + 2000) return [clean];
  const parts: string[] = [];
  let rest = clean;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('. ', limit);
    if (cut < 4000) cut = rest.lastIndexOf(' ', limit);
    if (cut < 4000) cut = limit;
    const piece = rest.slice(0, cut + (rest[cut] === '.' ? 1 : 0)).trim();
    if (!piece) break;
    parts.push(piece);
    rest = rest.slice(piece.length).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

async function complete(text: string, settings: LlmSettings, endpoint: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: settings.model.trim() || 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'Summarize the passage for listening. Stay faithful to the text, keep names and claims, and do not add a preamble.',
        },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Summary request failed (${response.status})`);
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const summary = payload.choices?.[0]?.message?.content?.trim() ?? '';
  if (!summary) throw new Error('Empty summary');
  return summary;
}

export async function summarizeWithLlm(text: string, settings: LlmSettings, signal?: AbortSignal): Promise<string> {
  const endpoint = normalizeEndpoint(settings.endpoint);
  if (!endpoint || !settings.apiKey.trim()) throw new Error('Missing API key');
  const pieces = llmChunks(text);
  if (!pieces.length) throw new Error('Empty summary');
  const partials: string[] = [];
  for (const piece of pieces) partials.push(await complete(piece, settings, endpoint, signal));
  if (partials.length === 1) return partials[0]!;
  const combined = partials.map((part, index) => `Section ${index + 1}: ${part}`).join('\n\n');
  if (combined.length > 14000) return combined;
  return complete(`Combine these section summaries into one listening summary:\n\n${combined}`, settings, endpoint, signal);
}
