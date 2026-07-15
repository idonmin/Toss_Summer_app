import { formatKoreanDate, weatherLabel } from "../constants/diary";
import type { WeatherValue } from "../constants/diary";
import type { DiaryAnalysis } from "../services/diaryAnalysis";
import { buildHighlightSegments } from "./highlight";
import type { HighlightSegment } from "./highlight";
import { ImageProcessError, loadImageFromDataUrl } from "./image";

// ---------------------------------------------------------------------------
// Stage 4 (그림일기 합성) renderer.
//
// The saved image is drawn coordinate-by-coordinate on a canvas instead of
// screenshotting the preview DOM (html2canvas 등): DOM-capture libraries can't
// reproduce the hand-drawn marks (wavy text-decoration, box-decoration-break)
// and behave unpredictably inside WebViews, while direct drawing is fully
// deterministic — which is also what the planning doc prescribes for 첨삭
// ("좌표 기반으로 직접 그리는 것이 안정적").
//
// Layout mirrors the preview card: header (date/weather) → drawing → title →
// ruled diary text with 첨삭 marks → teacher comment + tags → small footer.
// ---------------------------------------------------------------------------

export interface DiaryImageInput {
  /** The picture to place in the card — sketch if available, else the photo. */
  imageDataUrl: string;
  title: string;
  content: string;
  /** YYYY-MM-DD */
  date: string;
  weather: WeatherValue;
  /** null → the comment/tags block is omitted entirely. */
  analysis: DiaryAnalysis | null;
}

// 1080px wide: crisp on phone screens and standard for photo albums / SNS.
const WIDTH = 1080;
const BORDER_INSET = 14;
const BORDER_WIDTH = 4;
const BORDER_RADIUS = 28;
const TEXT_X = 64;
const TEXT_WIDTH = WIDTH - TEXT_X * 2;

// System-font stack matching the app; canvas has no webfont loading step, so
// sticking to system fonts guarantees the export never renders tofu boxes.
const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const HEADER_FONT = `500 30px ${FONT_STACK}`;
const TITLE_FONT = `700 44px ${FONT_STACK}`;
const CONTENT_FONT = `400 32px ${FONT_STACK}`;
const COMMENT_FONT = `500 30px ${FONT_STACK}`;
const TAG_FONT = `400 24px ${FONT_STACK}`;
const FOOTER_FONT = `400 22px ${FONT_STACK}`;

const TITLE_LINE_HEIGHT = 58;
const CONTENT_LINE_HEIGHT = 60;
const COMMENT_LINE_HEIGHT = 46;
const TAG_HEIGHT = 44;
const TAG_GAP = 12;

// Same paper palette as the preview card in App.css.
const PAPER = "#fffdf5";
const BORDER_COLOR = "#d8c9a3";
const SEPARATOR = "#e7dcbd";
const RULE = "#eee3c4";
const TITLE_COLOR = "#40371f";
const TEXT_COLOR = "#4c432a";
const MUTED = "#6b5e3f";
const FAINT = "#b0a988";
const MARK_COLOR = "rgba(224, 82, 60, 0.7)";
const COMMENT_BG = "#fbf7e8";
const TAG_BG = "#f3ecd2";

interface Run {
  text: string;
  x: number;
  width: number;
  mark: "circle" | "underline" | null;
}
type Line = Run[];

// CanvasRenderingContext2D.roundRect is only ~2023+ (Safari 16.4). If a target
// WebView lacks it, calling it would throw and abort the whole save, so fall
// back to a plain rectangle path — a square corner is a far better outcome
// than a failed export.
function roundRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  if (typeof context.roundRect === "function") {
    context.roundRect(x, y, width, height, radius);
  } else {
    context.rect(x, y, width, height);
  }
}

/**
 * Wraps marked segments into positioned runs, character by character.
 * Per-character breaking matches how Korean wraps (and the preview's
 * word-break: break-word); kerning/joined-emoji nuances are ignored — for
 * diary text the visual difference is negligible. A marked word that wraps
 * produces one run per line, so each fragment gets its own mark — the same
 * behavior as box-decoration-break: clone in the preview.
 */
function layoutSegments(
  context: CanvasRenderingContext2D,
  segments: HighlightSegment[],
  maxWidth: number,
): Line[] {
  const lines: Line[] = [];
  let current: Line = [];
  let cursorX = 0;

  const breakLine = () => {
    lines.push(current);
    current = [];
    cursorX = 0;
  };

  for (const segment of segments) {
    // Explicit newlines are honored (the preview uses white-space: pre-wrap).
    const parts = segment.text.split("\n");
    parts.forEach((part, partIndex) => {
      if (partIndex > 0) {
        breakLine();
      }
      let runText = "";
      let runStartX = cursorX;
      const flushRun = () => {
        if (runText !== "") {
          current.push({
            text: runText,
            x: runStartX,
            width: cursorX - runStartX,
            mark: segment.mark,
          });
          runText = "";
        }
      };
      // for..of iterates code points, so surrogate-pair emoji stay intact.
      for (const char of part) {
        const charWidth = context.measureText(char).width;
        if (cursorX + charWidth > maxWidth && cursorX > 0) {
          flushRun();
          breakLine();
        }
        if (runText === "") {
          runStartX = cursorX;
        }
        runText += char;
        cursorX += charWidth;
      }
      flushRun();
    });
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

// Hand-drawn circle: a slightly rotated ellipse reads as pencil, not as a UI
// chip — mirrors .highlight-circle's irregular border-radius in the preview.
function drawCircleMark(
  context: CanvasRenderingContext2D,
  x: number,
  baselineY: number,
  width: number,
  fontSize: number,
) {
  context.save();
  context.strokeStyle = MARK_COLOR;
  context.lineWidth = 3.5;
  const centerX = x + width / 2;
  const centerY = baselineY - fontSize * 0.34;
  context.translate(centerX, centerY);
  context.rotate(-0.03);
  context.beginPath();
  context.ellipse(0, 0, width / 2 + 12, fontSize * 0.74, 0, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawWavyUnderline(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
) {
  context.save();
  context.strokeStyle = MARK_COLOR;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(x, y);
  const half = 8;
  let cursor = x;
  let sign = 1;
  while (cursor < x + width) {
    const next = Math.min(cursor + half, x + width);
    context.quadraticCurveTo(
      cursor + (next - cursor) / 2,
      y + sign * 7,
      next,
      y,
    );
    sign = -sign;
    cursor = next;
  }
  context.stroke();
  context.restore();
}

/** Emotions first, deduped — must match the preview's tag logic. */
export function buildDiaryTags(analysis: DiaryAnalysis): string[] {
  return [
    ...new Set([
      ...analysis.emotions,
      ...analysis.photoKeywords,
      ...analysis.diaryKeywords,
    ]),
  ].slice(0, 6);
}

interface TagBox {
  text: string;
  x: number;
  y: number;
  width: number;
}

// Pills wrap like flex-wrap in the preview; returns boxes plus rows used.
function layoutTags(
  context: CanvasRenderingContext2D,
  tags: string[],
  maxWidth: number,
): { boxes: TagBox[]; rows: number } {
  context.font = TAG_FONT;
  const boxes: TagBox[] = [];
  let x = 0;
  let row = 0;
  for (const tag of tags) {
    const width = context.measureText(`#${tag}`).width + 36;
    if (x + width > maxWidth && x > 0) {
      row += 1;
      x = 0;
    }
    boxes.push({ text: `#${tag}`, x, y: row, width });
    x += width + TAG_GAP;
  }
  return { boxes, rows: tags.length > 0 ? row + 1 : 0 };
}

/**
 * Composes the finished diary into one JPEG data URL (개발 단계 4단계).
 * Runs in two passes: measure everything to derive the canvas height, then
 * draw — canvas height can't grow after the fact, so it must be known first.
 */
export async function composeDiaryImage(
  input: DiaryImageInput,
): Promise<string> {
  const image = await loadImageFromDataUrl(input.imageDataUrl);

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new ImageProcessError("load-failed");
  }

  // --- Measure pass (measureText works before the canvas is sized) ---------

  context.font = TITLE_FONT;
  const titleLines = layoutSegments(
    context,
    [{ text: input.title, mark: null }],
    TEXT_WIDTH,
  );

  context.font = CONTENT_FONT;
  const segments: HighlightSegment[] =
    input.analysis !== null
      ? buildHighlightSegments(
          input.content,
          input.analysis.highlightWords,
          input.analysis.highlightSentence,
        )
      : [{ text: input.content, mark: null }];
  const contentLines = layoutSegments(context, segments, TEXT_WIDTH);

  context.font = COMMENT_FONT;
  const commentLines =
    input.analysis !== null
      ? layoutSegments(
          context,
          [{ text: `✏️ ${input.analysis.comment}`, mark: null }],
          TEXT_WIDTH,
        )
      : [];
  const tags = input.analysis !== null ? buildDiaryTags(input.analysis) : [];
  const tagLayout = layoutTags(context, tags, TEXT_WIDTH);

  // Image spans the full inner width; height follows the aspect ratio but is
  // capped so an extreme portrait crop can't dwarf the diary text below it.
  const imageAreaWidth = WIDTH - (BORDER_INSET + BORDER_WIDTH / 2) * 2;
  const maxImageHeight = Math.round(imageAreaWidth * 1.3);
  const imageScale = Math.min(
    imageAreaWidth / image.naturalWidth,
    maxImageHeight / image.naturalHeight,
  );
  const imageDrawWidth = Math.round(image.naturalWidth * imageScale);
  const imageDrawHeight = Math.round(image.naturalHeight * imageScale);

  const headerHeight = 92;
  const titleBlockHeight = 28 + titleLines.length * TITLE_LINE_HEIGHT + 6;
  const contentBlockHeight = 10 + contentLines.length * CONTENT_LINE_HEIGHT + 30;
  const commentBlockHeight =
    input.analysis !== null
      ? 30 +
        commentLines.length * COMMENT_LINE_HEIGHT +
        (tagLayout.rows > 0 ? 14 + tagLayout.rows * (TAG_HEIGHT + TAG_GAP) : 0) +
        18
      : 0;
  const footerHeight = 58;

  canvas.width = WIDTH;
  canvas.height =
    BORDER_INSET * 2 +
    headerHeight +
    imageDrawHeight +
    titleBlockHeight +
    contentBlockHeight +
    commentBlockHeight +
    footerHeight;

  // --- Draw pass (sizing the canvas reset all context state) ---------------

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.textBaseline = "alphabetic";

  context.fillStyle = PAPER;
  context.fillRect(0, 0, canvas.width, canvas.height);

  let y = BORDER_INSET;

  // Header: date left, weather right.
  context.font = HEADER_FONT;
  context.fillStyle = MUTED;
  const headerBaseline = y + 58;
  context.fillText(formatKoreanDate(input.date), TEXT_X, headerBaseline);
  const weatherText = weatherLabel(input.weather);
  const weatherWidth = context.measureText(weatherText).width;
  context.fillText(weatherText, WIDTH - TEXT_X - weatherWidth, headerBaseline);
  y += headerHeight;

  context.strokeStyle = SEPARATOR;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(BORDER_INSET, y);
  context.lineTo(WIDTH - BORDER_INSET, y);
  context.stroke();

  // Picture, horizontally centered (paper shows through on letterbox sides).
  const imageX = Math.round((WIDTH - imageDrawWidth) / 2);
  context.drawImage(image, imageX, y, imageDrawWidth, imageDrawHeight);
  // Keyline around the picture so a letterboxed portrait reads as a framed
  // photo instead of a strip floating on bare paper.
  context.strokeStyle = BORDER_COLOR;
  context.lineWidth = 2;
  context.strokeRect(imageX + 1, y + 1, imageDrawWidth - 2, imageDrawHeight - 2);
  y += imageDrawHeight;

  context.beginPath();
  context.moveTo(BORDER_INSET, y);
  context.lineTo(WIDTH - BORDER_INSET, y);
  context.stroke();

  // Title.
  y += 28;
  context.font = TITLE_FONT;
  context.fillStyle = TITLE_COLOR;
  titleLines.forEach((line, index) => {
    const baseline = y + index * TITLE_LINE_HEIGHT + TITLE_LINE_HEIGHT * 0.78;
    for (const run of line) {
      context.fillText(run.text, TEXT_X + run.x, baseline);
    }
  });
  y += titleLines.length * TITLE_LINE_HEIGHT + 6;

  // Diary text on ruled lines, with 첨삭 marks per run.
  y += 10;
  contentLines.forEach((line, index) => {
    const lineTop = y + index * CONTENT_LINE_HEIGHT;
    const baseline = lineTop + CONTENT_LINE_HEIGHT * 0.7;

    // Ruled notebook line under every row, including empty ones.
    context.strokeStyle = RULE;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(TEXT_X, lineTop + CONTENT_LINE_HEIGHT - 6);
    context.lineTo(TEXT_X + TEXT_WIDTH, lineTop + CONTENT_LINE_HEIGHT - 6);
    context.stroke();

    context.font = CONTENT_FONT;
    context.fillStyle = TEXT_COLOR;
    for (const run of line) {
      context.fillText(run.text, TEXT_X + run.x, baseline);
    }
    // Marks are drawn after the text of the line so strokes sit on top.
    for (const run of line) {
      if (run.mark === "circle") {
        drawCircleMark(context, TEXT_X + run.x, baseline, run.width, 32);
      } else if (run.mark === "underline") {
        // baseline + 6 sits between the glyphs and the ruled line (which is at
        // baseline + 12); at +12 the wave wove through the beige rule.
        drawWavyUnderline(context, TEXT_X + run.x, baseline + 6, run.width);
      }
    }
  });
  y += contentLines.length * CONTENT_LINE_HEIGHT + 30;

  // Teacher comment + tags on the tinted strip, like the preview card.
  if (input.analysis !== null) {
    context.fillStyle = COMMENT_BG;
    context.fillRect(
      BORDER_INSET,
      y,
      WIDTH - BORDER_INSET * 2,
      commentBlockHeight,
    );

    context.save();
    context.strokeStyle = SEPARATOR;
    context.lineWidth = 2;
    context.setLineDash([10, 8]);
    context.beginPath();
    context.moveTo(BORDER_INSET, y);
    context.lineTo(WIDTH - BORDER_INSET, y);
    context.stroke();
    context.restore();

    let commentY = y + 30;
    context.font = COMMENT_FONT;
    context.fillStyle = MUTED;
    commentLines.forEach((line, index) => {
      const baseline =
        commentY + index * COMMENT_LINE_HEIGHT + COMMENT_LINE_HEIGHT * 0.72;
      for (const run of line) {
        context.fillText(run.text, TEXT_X + run.x, baseline);
      }
    });
    commentY += commentLines.length * COMMENT_LINE_HEIGHT;

    if (tagLayout.rows > 0) {
      commentY += 14;
      context.font = TAG_FONT;
      for (const box of tagLayout.boxes) {
        const boxY = commentY + box.y * (TAG_HEIGHT + TAG_GAP);
        context.fillStyle = TAG_BG;
        roundRectPath(context, TEXT_X + box.x, boxY, box.width, TAG_HEIGHT, 18);
        context.fill();
        context.fillStyle = MUTED;
        context.fillText(box.text, TEXT_X + box.x + 18, boxY + 31);
      }
    }
    y += commentBlockHeight;
  }

  // Footer watermark.
  context.font = FOOTER_FONT;
  context.fillStyle = FAINT;
  const footerText = "나의 여름방학일기 ✏️";
  const footerWidth = context.measureText(footerText).width;
  context.fillText(
    footerText,
    WIDTH - TEXT_X - footerWidth,
    y + footerHeight - 22,
  );

  // Outer border last, so it sits cleanly on top of full-bleed blocks.
  context.strokeStyle = BORDER_COLOR;
  context.lineWidth = BORDER_WIDTH;
  roundRectPath(
    context,
    BORDER_INSET,
    BORDER_INSET,
    WIDTH - BORDER_INSET * 2,
    canvas.height - BORDER_INSET * 2,
    BORDER_RADIUS,
  );
  context.stroke();

  // 0.92: text and thin marks need higher quality than photos to avoid
  // visible JPEG ringing around glyph edges.
  return canvas.toDataURL("image/jpeg", 0.92);
}
