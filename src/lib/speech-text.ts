function breakLong(value: string, limit: number): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.length <= limit) return [trimmed];
  const parts: string[] = [];
  let rest = trimmed;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(' ', limit);
    if (cut < Math.min(40, Math.floor(limit / 2))) {
      const chars = [...rest];
      const piece = chars.slice(0, limit).join('');
      parts.push(piece);
      rest = chars.slice(limit).join('').trim();
      continue;
    }
    const piece = rest.slice(0, cut).trim();
    if (!piece) break;
    parts.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export function speechChunks(text: string, limit = 280): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const source = sentences.length ? sentences : [text.trim()].filter(Boolean);
  const parts: string[] = [];
  for (const sentence of source) {
    const bits = sentence.split(/,\s+/);
    let current = '';
    const push = (value: string) => {
      for (const piece of breakLong(value, limit)) parts.push(piece);
    };
    for (const bit of bits) {
      const next = current ? `${current}, ${bit}` : bit;
      if (next.length > limit && current) {
        push(current);
        current = bit;
      } else current = next;
    }
    if (current) push(current);
  }
  return parts;
}
