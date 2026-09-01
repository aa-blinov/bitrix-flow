const HASHTAG_PATTERN = /(?:^|[\s([{])#([\p{L}\p{N}_-]+)/gu;

/** Extract the #tags people put in Bitrix task titles and descriptions. */
export function extractTaskTags(
  title: string | undefined,
  description: string | undefined,
): string[] {
  const tags = new Map<string, string>();
  for (const text of [title, description]) {
    if (!text) continue;
    for (const match of text.matchAll(HASHTAG_PATTERN)) {
      const tag = `#${match[1]}`;
      const key = tag.toLocaleLowerCase('ru');
      if (!tags.has(key)) tags.set(key, tag);
    }
  }
  return [...tags.values()];
}
