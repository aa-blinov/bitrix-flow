const HASHTAG_PATTERN = /(?:^|[\s([{])#([\p{L}\p{N}_-]+)/gu;

// Тот же разбор, но для агрегаций MongoDB: PCRE2 не знает \p{L}, поэтому
// юникодные буквы включаются префиксом (*UCP), а начало строки заменяется
// ведущим пробелом, который добавляет сам пайплайн.
export const MONGO_HASHTAG_REGEX = '(*UCP)[\\s([{]#([\\w-]+)';

/** Регэксп, которым Mongo проверяет, что в тексте есть именно этот тег. */
export function mongoHashtagMatch(tag: string): string {
  const escaped = tag.replace(/^#/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `(*UCP)[\\s([{]#${escaped}(?![\\w-])`;
}

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
