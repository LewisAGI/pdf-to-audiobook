import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLlmKey, summarizeWithLlm, writeLlmKey } from '../../src/lib/llm';
import { summarizeExtractive } from '../../src/lib/summary';

describe('summaries', () => {
  it('keeps an extractive summary shorter and in original order', () => {
    const text = [
      'The council reconvened at dawn beside the river.',
      'Baskets of figs were counted twice before the gates opened.',
      'A clerk copied the old minutes into a dry ledger.',
      'Lanterns were hung along the lane for the departure.',
      'Children raced the carts until the dust settled.',
      'The maps stayed wrapped in oilcloth.',
      'By dusk the road was empty and the river kept its name.',
    ].join(' ');
    const summary = summarizeExtractive(text, 0.3);
    expect(summary.length).toBeLessThan(text.length);
    expect(summary).toContain('council');
    const positions = summary
      .split(/(?<=\.)\s+/)
      .map((sentence) => text.indexOf(sentence.trim()))
      .filter((index) => index >= 0);
    const ordered = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(ordered);
  });

  it('sends the API key only to the chosen endpoint', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe('https://example.test/v1/chat/completions');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer sk-test-only');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('local-model');
      expect(JSON.stringify(body)).not.toContain('sk-test-only');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'A short retelling.' } }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const summary = await summarizeWithLlm('The river kept its name.', {
      endpoint: 'https://example.test/v1/',
      model: 'local-model',
      apiKey: 'sk-test-only',
    });
    expect(summary).toBe('A short retelling.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stores the API key for the endpoint origin and ignores a legacy global key', () => {
    const bag = new Map<string, string>();
    const storage = {
      getItem: (key: string) => bag.get(key) ?? null,
      setItem: (key: string, value: string) => bag.set(key, value),
      removeItem: (key: string) => bag.delete(key),
    };
    bag.set('pta-llm-key', 'sk-legacy');
    writeLlmKey(storage, 'https://one.example/v1', 'sk-one');
    writeLlmKey(storage, 'https://two.example/v1/', 'sk-two');
    expect(readLlmKey(storage, 'https://one.example/v1')).toBe('sk-one');
    expect(readLlmKey(storage, 'https://two.example/v1')).toBe('sk-two');
    expect(readLlmKey(storage, 'https://three.example/v1')).toBe('');
    expect(readLlmKey(storage, 'https://api.openai.com/v1')).toBe('');
    expect([...bag.keys()].sort()).toEqual(['pta-llm-key:https://one.example', 'pta-llm-key:https://two.example']);
    writeLlmKey(storage, 'https://two.example/v1', '   ');
    expect(readLlmKey(storage, 'https://two.example/v1')).toBe('');
    expect(readLlmKey(storage, 'https://one.example/v1')).toBe('sk-one');
  });

  it('chunks a long passage instead of dropping the tail', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      const content = body.messages.at(-1)?.content ?? '';
      return new Response(JSON.stringify({ choices: [{ message: { content: content.slice(0, 40) } }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const text = `${'The river kept its name. '.repeat(700)}TAIL_MARKER_END`;
    await summarizeWithLlm(text, { endpoint: 'https://example.test/v1', model: 'local-model', apiKey: 'sk-test-only' });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    const bodies = fetchMock.mock.calls.map((call) => {
      const init = call[1] as RequestInit;
      const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
      return body.messages.at(-1)?.content ?? '';
    });
    expect(bodies.some((body) => body.includes('TAIL_MARKER_END'))).toBe(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});
