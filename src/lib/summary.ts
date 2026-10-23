const STOP = new Set(
  `a an the of and or to in on for with from by at as is are was were be been being it this that these those
  i you we they he she them his her their our your not but if so than then into over under about
  its also can may will just than very more most other such only own same`.split(/\s+/),
);

export function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const parts = clean.split(/(?<=[.!?])\s+(?=[A-Z“"'])/);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function tokens(sentence: string): string[] {
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const right = new Map<string, number>();
  for (const word of b) right.set(word, (right.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of a) {
    const count = right.get(word) ?? 0;
    if (count > 0) {
      shared += 1;
      right.set(word, count - 1);
    }
  }
  return shared / (Math.log(a.length + 1) + Math.log(b.length + 1));
}

export function summarizeExtractive(text: string, ratio = 0.28): string {
  const sentences = splitSentences(text);
  if (sentences.length <= 2) return text.trim();
  const words = sentences.map(tokens);
  const scores = sentences.map((_, index) => 1 + (index === 0 ? 0.35 : 0));
  for (let pass = 0; pass < 8; pass += 1) {
    const next = scores.map(() => 0.15);
    for (let i = 0; i < sentences.length; i += 1) {
      for (let j = 0; j < sentences.length; j += 1) {
        if (i === j) continue;
        next[i] = (next[i] ?? 0) + (scores[j] ?? 0) * overlap(words[i] ?? [], words[j] ?? []);
      }
      if (i === 0) next[i] = (next[i] ?? 0) + 0.2;
    }
    const norm = Math.max(...next, 0.001);
    for (let i = 0; i < next.length; i += 1) scores[i] = (next[i] ?? 0) / norm;
  }
  const target = Math.min(8, Math.max(2, Math.round(sentences.length * ratio)));
  const ranked = scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score)
    .slice(0, target)
    .sort((a, b) => a.index - b.index);
  return ranked.map((item) => sentences[item.index] ?? '').join(' ');
}
