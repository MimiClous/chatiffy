import type { ChatMessage } from '../shared/contracts.js';
export function parseTags(raw: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const pair of raw.split(';')) {
    const separator = pair.indexOf('=');
    const key = separator === -1 ? pair : pair.slice(0, separator);
    const value = separator === -1 ? '' : pair.slice(separator + 1);
    tags[key] = value.replace(/\\([snr:\\])/g, (_: string, escaped: string) => ({ s: ' ', n: '\n', r: '\r', ':': ';', '\\': '\\' } as Record<string, string>)[escaped]);
  }
  return tags;
}

export function parseIrc(line: string): ChatMessage | null {
  const match = line.match(/^@([^ ]+) :([^ ]+) PRIVMSG #[^ ]+ :(.*)$/);
  if (!match) return null;
  const tags = parseTags(match[1]);
  return { tags, user: match[2].split('!')[0], text: match[3] };
}

export function twitchEmoteRanges(tag: string | undefined) {
  const ranges: { start: number; end: number; url: string }[] = [];
  if (!tag) return ranges;
  for (const group of tag.split('/')) {
    const [id, positions] = group.split(':');
    for (const position of (positions || '').split(',')) {
      const [start, end] = position.split('-').map(Number);
      if (Number.isFinite(start) && Number.isFinite(end)) ranges.push({ start, end, url: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0` });
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

