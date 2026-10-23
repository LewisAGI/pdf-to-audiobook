export const LLM_KEY = 'pta-llm-key';

export type LlmSettings = {
  endpoint: string;
  model: string;
  apiKey: string;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readLlmKey(storage: StorageLike): string {
  return storage.getItem(LLM_KEY) ?? '';
}

export function writeLlmKey(storage: StorageLike, key: string): void {
  const trimmed = key.trim();
  if (!trimmed) storage.removeItem(LLM_KEY);
  else storage.setItem(LLM_KEY, trimmed);
}

export function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

export async function summarizeWithLlm(text: string, settings: LlmSettings, signal?: AbortSignal): Promise<string> {
  const endpoint = normalizeEndpoint(settings.endpoint);
  if (!endpoint || !settings.apiKey.trim()) throw new Error('Missing API key');
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
        { role: 'user', content: text.slice(0, 14000) },
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
