export interface HighlightSegment {
  text: string;
  mark: "circle" | "underline" | null;
}

interface Range {
  start: number;
  end: number;
  mark: "circle" | "underline";
}

/**
 * Splits the diary content into plain / marked segments so the preview can
 * render 첨삭 marks without dangerouslySetInnerHTML (user text stays text —
 * no HTML injection surface).
 *
 * The sentence is claimed first, then words; anything overlapping an already
 * claimed range is dropped. Nested marks (a circled word inside the
 * underlined sentence) would need a tree instead of a flat list — not worth
 * it for the MVP's 2-4 marks.
 */
export function buildHighlightSegments(
  content: string,
  words: string[],
  sentence: string | null,
): HighlightSegment[] {
  const ranges: Range[] = [];
  const overlaps = (start: number, end: number) =>
    ranges.some((range) => start < range.end && end > range.start);

  if (sentence !== null && sentence !== "") {
    const index = content.indexOf(sentence);
    if (index >= 0) {
      ranges.push({
        start: index,
        end: index + sentence.length,
        mark: "underline",
      });
    }
  }

  for (const word of words) {
    if (word === "") {
      continue;
    }
    // One mark per word (the spec wants a light touch — 핵심 단어 2~4개),
    // but if the first occurrence is already claimed (e.g. it sits inside
    // the underlined sentence), fall through to the next free one instead
    // of dropping the word entirely.
    let index = content.indexOf(word);
    while (index >= 0 && overlaps(index, index + word.length)) {
      index = content.indexOf(word, index + 1);
    }
    if (index < 0) {
      continue;
    }
    ranges.push({ start: index, end: index + word.length, mark: "circle" });
  }

  ranges.sort((a, b) => a.start - b.start);

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({ text: content.slice(cursor, range.start), mark: null });
    }
    segments.push({
      text: content.slice(range.start, range.end),
      mark: range.mark,
    });
    cursor = range.end;
  }
  if (cursor < content.length) {
    segments.push({ text: content.slice(cursor), mark: null });
  }
  return segments;
}
