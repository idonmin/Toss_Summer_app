import { weatherLabel } from "../constants/diary";
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
const WIDTH = 1058;
const TEXT_X = 64;
const TEXT_WIDTH = WIDTH - TEXT_X * 2;

// System-font stack matching the app; canvas has no webfont loading step, so
// sticking to system fonts guarantees the export never renders tofu boxes.
const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const TITLE_FONT = `700 36px ${FONT_STACK}`;
const CONTENT_FONT = `400 32px ${FONT_STACK}`;
const COMMENT_FONT = `500 24px ${FONT_STACK}`;
const TAG_FONT = `400 18px ${FONT_STACK}`;

const COMMENT_LINE_HEIGHT = 32;
const TAG_HEIGHT = 30;
const TAG_GAP = 6;

// Same paper palette as the preview card in App.css.
const TEXT_COLOR = "#4c432a";
const MUTED = "#6b5e3f";
const MARK_COLOR = "rgba(224, 82, 60, 0.7)";
const TAG_BG = "#f3ecd2";
const FRAME_HEIGHT = 1487;

function loadFrameImage(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const frame = new Image();
    frame.onload = () => resolve(frame);
    frame.onerror = () => reject(new ImageProcessError("load-failed"));
    frame.src = "/picture-diary-frame.png";
  });
}

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
  const tags = [
    ...new Set([
      ...analysis.emotions,
      ...analysis.photoKeywords,
      ...analysis.diaryKeywords,
    ]),
  ].slice(0, 6);
  return tags.length > 0 ? tags : ["그림일기", "여름방학"];
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
    const width = context.measureText(`#${tag}`).width + 24;
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
  const [image, frame] = await Promise.all([
    loadImageFromDataUrl(input.imageDataUrl),
    loadFrameImage(),
  ]);

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new ImageProcessError("load-failed");
  }

  // --- Measure pass (measureText works before the canvas is sized) ---------

  const segments: HighlightSegment[] =
    input.analysis !== null
      ? buildHighlightSegments(
          input.content,
          input.analysis.highlightWords,
          input.analysis.highlightSentence,
        )
      : [{ text: input.content, mark: null }];
  const columnCount = 11;
  const rowCount = 5;
  const cells: Array<{
    text: string;
    mark: "circle" | "underline" | null;
  }> = [];
  for (const segment of segments) {
    for (const character of Array.from(segment.text)) {
      if (character === "\n") {
        while (cells.length % columnCount !== 0) {
          cells.push({ text: "", mark: null });
        }
      } else {
        cells.push({ text: character, mark: segment.mark });
      }
    }
  }
  const visibleCellCount = Math.max(
    columnCount * rowCount,
    Math.ceil(cells.length / columnCount) * columnCount,
  );
  while (cells.length < visibleCellCount) {
    cells.push({ text: "", mark: null });
  }

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

  const contentInset = 40;
  const commentBlockHeight =
    input.analysis !== null
      ? 18 +
        commentLines.length * COMMENT_LINE_HEIGHT +
        (tagLayout.rows > 0 ? 8 + tagLayout.rows * (TAG_HEIGHT + TAG_GAP) : 0) +
        10
      : 0;
  canvas.width = WIDTH;
  canvas.height = FRAME_HEIGHT;

  // --- Draw pass (sizing the canvas reset all context state) ---------------

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.textBaseline = "alphabetic";

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(frame, 0, 0, WIDTH, FRAME_HEIGHT);

  // Values are placed into the blanks already printed on the supplied frame.
  const [year = "", month = "", day = ""] = input.date.split("-");
  const date = new Date(`${input.date}T00:00:00`);
  const weekday = Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(date);
  context.font = `600 24px ${FONT_STACK}`;
  context.fillStyle = "#333333";
  context.textAlign = "center";
  context.fillText(year, 109, 218);
  context.fillText(String(Number(month)), 210, 218);
  context.fillText(String(Number(day)), 310, 218);
  context.fillText(weekday, 410, 218);
  context.fillText(weatherLabel(input.weather), 865, 218);

  context.font = TITLE_FONT;
  context.textAlign = "left";
  context.fillText(input.title, 129, 292, 820);

  // Fill the complete printed photo box. The centered crop mirrors
  // object-fit: cover in the on-screen preview, so preview and export match.
  const imageX = 50;
  const imageY = 317;
  const imageWidth = 956;
  const imageHeight = 543;
  const scale = Math.max(
    imageWidth / image.naturalWidth,
    imageHeight / image.naturalHeight,
  );
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.save();
  context.beginPath();
  context.rect(imageX, imageY, imageWidth, imageHeight);
  context.clip();
  context.drawImage(
    image,
    imageX + (imageWidth - drawWidth) / 2,
    imageY + (imageHeight - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  context.restore();

  // The supplied manuscript area is a fixed 11-column, five-row grid.
  const gridX = 50;
  const gridY = 880;
  const cellWidth = 956 / columnCount;
  const cellHeight = 344 / rowCount;
  context.font = CONTENT_FONT;
  context.textAlign = "center";
  context.textBaseline = "middle";
  cells.slice(0, columnCount * rowCount).forEach((cell, index) => {
    const column = index % columnCount;
    const row = Math.floor(index / columnCount);
    const cellX = gridX + column * cellWidth;
    const cellY = gridY + row * cellHeight;
    context.fillStyle = TEXT_COLOR;
    context.fillText(cell.text, cellX + cellWidth / 2, cellY + cellHeight / 2 + 2);
  });

  // Correction strokes live on a separate coordinate layer. Consecutive
  // marked characters on the same row become one loose teacher-pencil mark,
  // so the stroke can cross cell borders without changing the grid layout.
  const correctionRuns: Array<{
    mark: "circle" | "underline";
    row: number;
    startColumn: number;
    length: number;
  }> = [];
  cells.slice(0, columnCount * rowCount).forEach((cell, index) => {
    if (cell.mark === null) {
      return;
    }
    const row = Math.floor(index / columnCount);
    const column = index % columnCount;
    const previous = correctionRuns.at(-1);
    if (
      previous !== undefined &&
      previous.mark === cell.mark &&
      previous.row === row &&
      previous.startColumn + previous.length === column
    ) {
      previous.length += 1;
    } else {
      correctionRuns.push({
        mark: cell.mark,
        row,
        startColumn: column,
        length: 1,
      });
    }
  });
  correctionRuns.forEach((run) => {
    const x = gridX + run.startColumn * cellWidth;
    const rowY = gridY + run.row * cellHeight;
    const width = run.length * cellWidth;
    if (run.mark === "circle") {
      context.save();
      context.strokeStyle = MARK_COLOR;
      context.lineWidth = 4;
      context.translate(x + width / 2, rowY + cellHeight / 2);
      context.rotate(-0.025);
      context.beginPath();
      context.ellipse(
        0,
        0,
        width / 2 + 9,
        cellHeight * 0.4,
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
      context.restore();
    } else {
      drawWavyUnderline(
        context,
        x - 5,
        rowY + cellHeight * 0.78,
        width + 10,
      );
    }
  });
  let y = 1247;
  context.textBaseline = "alphabetic";
  context.textAlign = "left";

  // Teacher comment + tags on the tinted strip, like the preview card.
  if (input.analysis !== null) {
    context.font = `700 22px ${FONT_STACK}`;
    context.fillStyle = MUTED;
    context.fillText("선생님 한줄평", contentInset + 14, y + 30);
    let commentY = y + 38;
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
      commentY += 8;
      context.font = TAG_FONT;
      for (const box of tagLayout.boxes) {
        const boxY = commentY + box.y * (TAG_HEIGHT + TAG_GAP);
        context.fillStyle = TAG_BG;
        roundRectPath(context, TEXT_X + box.x, boxY, box.width, TAG_HEIGHT, 18);
        context.fill();
        context.fillStyle = MUTED;
        context.fillText(box.text, TEXT_X + box.x + 12, boxY + 22);
      }
    }
    y += commentBlockHeight + 14;
  }

  // 0.92: text and thin marks need higher quality than photos to avoid
  // visible JPEG ringing around glyph edges.
  return canvas.toDataURL("image/jpeg", 0.92);
}
