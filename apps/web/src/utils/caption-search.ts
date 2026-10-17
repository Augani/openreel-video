export interface CaptionSearchOptions { matchCase?: boolean; wholeWords?: boolean }

/** Literal search: punctuation and replacement dollar signs are never regex syntax. */
export function createCaptionSearch(query: string, options: CaptionSearchOptions = {}) {
  const expression = query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), options.matchCase ? "gu" : "giu") : null;
  const accepted = (text: string, offset: number, length: number) => !options.wholeWords ||
    (!/[\p{L}\p{N}\p{M}_]$/u.test(text.slice(Math.max(0, offset - 2), offset)) &&
      !/^[\p{L}\p{N}\p{M}_]/u.test(text.slice(offset + length, offset + length + 2)));
  return {
    count(text: string) {
      if (!expression) return 0;
      let count = 0;
      for (const match of text.matchAll(expression)) if (accepted(text, match.index!, match[0].length)) count++;
      return count;
    },
    replace(text: string, replacement: string) {
      if (!expression) return text;
      return text.replace(expression, (match, offset: number) => accepted(text, offset, match.length) ? replacement : match);
    },
  };
}
