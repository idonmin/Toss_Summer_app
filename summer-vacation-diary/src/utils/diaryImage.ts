import { weatherLabel } from "../constants/diary";
import type { WeatherValue } from "../constants/diary";
import type { DiaryAnalysis } from "../services/diaryAnalysis";
import { handwritingVariation } from "./handwriting";
import { buildHighlightSegments } from "./highlight";
import { ImageProcessError, loadImageFromDataUrl } from "./image";

export interface DiaryImageInput {
  imageDataUrl: string;
  title: string;
  content: string;
  /** YYYY-MM-DD */
  date: string;
  weather: WeatherValue;
  analysis: DiaryAnalysis | null;
}

// 저장 이미지는 미리보기의 picture-diary-frame.png 원본 크기와 좌표를
// 그대로 사용합니다. App.css의 퍼센트 배치를 바꾸면 이 값도 맞춰야 합니다.
const WIDTH = 1058;
const HEIGHT = 1487;
const TEMPLATE_URL = "/picture-diary-frame.png";

const HEADER = { x: 0.047, y: 0.119, width: 0.906, height: 0.0485 };
const TITLE = { x: 0.122, y: 0.1675, right: 0.047, height: 0.038 };
const PHOTO = { x: 0.047, y: 0.2125, width: 0.906, height: 0.366 };
const CONTENT = { x: 0.047, y: 0.5918, width: 0.906, height: 0.2314 };
const COMMENT = { x: 0.046, y: 0.8386, width: 0.908, height: 0.1197 };

const COLUMN_COUNT = 11;
const ROW_COUNT = 5;
const DIARY_FONT_FAMILY = '"NanumCoDingHeuiMang"';
const SYSTEM_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const DIARY_FONT_STACK = `${DIARY_FONT_FAMILY}, ${SYSTEM_FONT_STACK}`;

// 미리보기의 12/14/10px 등을 1058px 템플릿 원본 비율로 환산한 값입니다.
const HEADER_FONT = `400 29px ${DIARY_FONT_STACK}`;
const TITLE_FONT = `400 34px ${DIARY_FONT_STACK}`;
const CONTENT_FONT = `400 34px ${DIARY_FONT_STACK}`;
const COMMENT_LABEL_FONT = `700 22px ${SYSTEM_FONT_STACK}`;
const COMMENT_FONT = `500 30px ${SYSTEM_FONT_STACK}`;
const TAG_FONT = `400 22px ${SYSTEM_FONT_STACK}`;

const TEXT_COLOR = "#333333";
const COMMENT_COLOR = "#6b5e3f";
const LABEL_COLOR = "#806d3d";
const TAG_BACKGROUND = "#f3ecd2";
const MARK_COLOR = "rgba(224, 62, 46, 0.78)";

interface DiaryCell {
  text: string;
  mark: "circle" | "underline" | null;
}

interface CorrectionRun {
  mark: "circle" | "underline";
  row: number;
  startColumn: number;
  length: number;
}

function pxX(value: number): number {
  return value * WIDTH;
}

function pxY(value: number): number {
  return value * HEIGHT;
}

function fontWithWeight(font: string, weight: number): string {
  return /^(?:normal|bold|[1-9]00)\s/.test(font)
    ? font.replace(/^(?:normal|bold|[1-9]00)/, String(weight))
    : `${weight} ${font}`;
}

// 미리보기의 HandwrittenText와 같은 순서·seed·strength를 사용합니다.
function drawHandwrittenText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  startIndex: number,
  strength = 1,
): number {
  let cursorX = x;
  let characterIndex = startIndex;

  for (const character of Array.from(text)) {
    const width = context.measureText(character).width;
    const variation = handwritingVariation(character, characterIndex, strength);
    const fontSize = Number(context.font.match(/([\d.]+)px/)?.[1] ?? 34);

    context.save();
    context.font = fontWithWeight(context.font, variation.fontWeight);
    context.globalAlpha *= variation.opacity;
    context.translate(
      cursorX + width / 2 + variation.offsetXEm * fontSize,
      baseline + variation.offsetYEm * fontSize,
    );
    context.rotate((variation.rotationDeg * Math.PI) / 180);
    context.scale(variation.scale, variation.scale);
    context.fillText(character, -width / 2, 0);
    context.restore();

    cursorX += width;
    characterIndex += 1;
  }

  return characterIndex;
}

function drawCoverImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  // CSS object-fit: cover와 동일하게 중앙을 기준으로 넘치는 부분을 자릅니다.
  const scale = Math.max(
    width / image.naturalWidth,
    height / image.naturalHeight,
  );
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.naturalWidth - sourceWidth) / 2;
  const sourceY = (image.naturalHeight - sourceHeight) / 2;
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
}

function buildDiaryCells(
  content: string,
  analysis: DiaryAnalysis | null,
): DiaryCell[] {
  const segments =
    analysis === null
      ? [{ text: content, mark: null }]
      : buildHighlightSegments(
          content,
          analysis.highlightWords,
          analysis.highlightSentence,
        );
  const cells: DiaryCell[] = [];

  for (const segment of segments) {
    for (const character of Array.from(segment.text)) {
      if (character === "\n") {
        while (cells.length % COLUMN_COUNT !== 0) {
          cells.push({ text: "", mark: null });
        }
      } else {
        cells.push({ text: character, mark: segment.mark });
      }
    }
  }

  return cells.slice(0, COLUMN_COUNT * ROW_COUNT);
}

function buildCorrectionRuns(cells: DiaryCell[]): CorrectionRun[] {
  const runs: CorrectionRun[] = [];
  cells.forEach((cell, index) => {
    if (cell.mark === null) return;
    const row = Math.floor(index / COLUMN_COUNT);
    const column = index % COLUMN_COUNT;
    const previous = runs[runs.length - 1];
    if (
      previous !== undefined &&
      previous.mark === cell.mark &&
      previous.row === row &&
      previous.startColumn + previous.length === column
    ) {
      previous.length += 1;
    } else {
      runs.push({ mark: cell.mark, row, startColumn: column, length: 1 });
    }
  });
  return runs;
}

function drawWavyUnderline(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
) {
  context.save();
  context.strokeStyle = MARK_COLOR;
  context.lineWidth = 3.5;
  context.beginPath();
  context.moveTo(x, y);
  let cursor = x;
  let direction = 1;
  while (cursor < x + width) {
    const next = Math.min(cursor + 11, x + width);
    context.quadraticCurveTo(
      cursor + (next - cursor) / 2,
      y + direction * 6,
      next,
      y,
    );
    direction *= -1;
    cursor = next;
  }
  context.stroke();
  context.restore();
}

function drawContent(
  context: CanvasRenderingContext2D,
  content: string,
  analysis: DiaryAnalysis | null,
) {
  const x = pxX(CONTENT.x);
  const y = pxY(CONTENT.y);
  const width = pxX(CONTENT.width);
  const height = pxY(CONTENT.height);
  const cellWidth = width / COLUMN_COUNT;
  const cellHeight = height / ROW_COUNT;
  const cells = buildDiaryCells(content, analysis);

  context.font = CONTENT_FONT;
  context.fillStyle = TEXT_COLOR;
  context.textAlign = "center";
  cells.forEach((cell, index) => {
    if (cell.text === "") return;
    const row = Math.floor(index / COLUMN_COUNT);
    const column = index % COLUMN_COUNT;
    const centerX = x + (column + 0.5) * cellWidth;
    const baseline = y + (row + 0.5) * cellHeight + 12;
    const variation = handwritingVariation(cell.text, index, 1);

    context.save();
    context.font = fontWithWeight(context.font, variation.fontWeight);
    context.globalAlpha *= variation.opacity;
    context.translate(
      centerX + variation.offsetXEm * 34,
      baseline + variation.offsetYEm * 34,
    );
    context.rotate((variation.rotationDeg * Math.PI) / 180);
    context.scale(variation.scale, variation.scale);
    context.fillText(cell.text === " " ? "\u00a0" : cell.text, 0, 0);
    context.restore();
  });
  context.textAlign = "start";

  // 미리보기와 동일하게 연속된 첨삭 구간을 한 개의 표시로 묶습니다.
  for (const run of buildCorrectionRuns(cells)) {
    const runX = x + run.startColumn * cellWidth;
    const runY = y + run.row * cellHeight;
    const runWidth = run.length * cellWidth;
    if (run.mark === "circle") {
      context.save();
      context.strokeStyle = MARK_COLOR;
      context.lineWidth = 4;
      context.translate(runX + runWidth / 2, runY + cellHeight / 2);
      context.rotate(-0.025);
      context.beginPath();
      context.ellipse(
        0,
        0,
        runWidth / 2 + 10,
        cellHeight * 0.38,
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
      context.restore();
    } else {
      drawWavyUnderline(context, runX, runY + cellHeight - 14, runWidth);
    }
  }
}

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

/** 감정 → 사진 키워드 → 일기 키워드 순서로 중복 없이 최대 6개. */
export function buildDiaryTags(analysis: DiaryAnalysis): string[] {
  return [
    ...new Set([
      ...analysis.emotions,
      ...analysis.photoKeywords,
      ...analysis.diaryKeywords,
    ]),
  ].slice(0, 6);
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let currentLine = "";

  for (const character of Array.from(text)) {
    const candidate = currentLine + character;

    if (
      currentLine !== "" &&
      context.measureText(candidate).width > maxWidth
    ) {
      lines.push(currentLine);
      currentLine = character;
    } else {
      currentLine = candidate;
    }
  }

  if (currentLine !== "") {
    lines.push(currentLine);
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const visibleLines = lines.slice(0, maxLines);
  let lastLine = visibleLines[maxLines - 1];

  while (
    lastLine.length > 0 &&
    context.measureText(`${lastLine}…`).width > maxWidth
  ) {
    lastLine = Array.from(lastLine).slice(0, -1).join("");
  }

  visibleLines[maxLines - 1] = `${lastLine}…`;
  return visibleLines;
}

function drawComment(
  context: CanvasRenderingContext2D,
  analysis: DiaryAnalysis | null,
) {
  if (analysis === null) return;
  const x = pxX(COMMENT.x);
  const y = pxY(COMMENT.y);
  const width = pxX(COMMENT.width);
  const height = pxY(COMMENT.height);
  const paddingX = 25;

  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();

  context.font = COMMENT_LABEL_FONT;
  context.fillStyle = LABEL_COLOR;
  context.fillText("선생님 한줄평", x + paddingX, y + 27);

  // 미리보기의 12px 한 줄 문장을 원본 템플릿 비율로 환산한 30px입니다.
  context.font = COMMENT_FONT;
  context.fillStyle = COMMENT_COLOR;

  const commentLines = wrapCanvasText(
    context,
    `✏️ ${analysis.comment}`,
    width - paddingX * 2,
    2,
  );

  commentLines.forEach((line, index) => {
    context.fillText(
      line,
      x + paddingX,
      y + 62 + index * 36,
    );
  });

  const tags = buildDiaryTags(analysis);
  context.font = TAG_FONT;
  let tagX = x + paddingX;
  const tagY = y + height - 47;
  for (const tag of tags) {
    const text = `#${tag}`;
    const tagWidth = context.measureText(text).width + 24;
    if (tagX + tagWidth > x + width - paddingX) break;
    context.fillStyle = TAG_BACKGROUND;
    roundRectPath(context, tagX, tagY, tagWidth, 34, 17);
    context.fill();
    context.fillStyle = COMMENT_COLOR;
    context.fillText(text, tagX + 12, tagY + 24);
    tagX += tagWidth + 8;
  }
  context.restore();
}

export async function composeDiaryImage(
  input: DiaryImageInput,
): Promise<string> {
  const [image, template] = await Promise.all([
    loadImageFromDataUrl(input.imageDataUrl),
    loadImageFromDataUrl(TEMPLATE_URL),
  ]);

  try {
    await document.fonts.load(`34px ${DIARY_FONT_FAMILY}`);
  } catch {
    // 폰트를 못 읽어도 시스템 폰트 fallback으로 저장은 계속합니다.
  }

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new ImageProcessError("load-failed");

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.textBaseline = "alphabetic";

  // DOM 미리보기와 같은 순서: 템플릿 → 사진 → 글자/첨삭 → 한줄평/태그.
  context.drawImage(template, 0, 0, WIDTH, HEIGHT);
  drawCoverImage(
    context,
    image,
    pxX(PHOTO.x),
    pxY(PHOTO.y),
    pxX(PHOTO.width),
    pxY(PHOTO.height),
  );

  const [year = "", month = "", day = ""] = input.date.split("-");
  const diaryDate = new Date(`${input.date}T00:00:00`);
  const weekday = Number.isNaN(diaryDate.getTime())
    ? ""
    : new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(diaryDate);
  const headerX = pxX(HEADER.x);
  const headerY = pxY(HEADER.y);
  const headerWidth = pxX(HEADER.width);
  const headerHeight = pxY(HEADER.height);
  const headerBaseline = headerY + headerHeight * 0.55 + 10;
  const headerItems = [
    { text: year, left: 0.062, seed: 0 },
    { text: String(Number(month)), left: 0.167, seed: 10 },
    { text: String(Number(day)), left: 0.271, seed: 20 },
    { text: weekday, left: 0.375, seed: 30 },
    { text: weatherLabel(input.weather), left: 0.85, seed: 40 },
  ];

  context.font = HEADER_FONT;
  context.fillStyle = "#222222";
  context.textAlign = "center";
  for (const item of headerItems) {
    const itemWidth = context.measureText(item.text).width;
    drawHandwrittenText(
      context,
      item.text,
      headerX + headerWidth * item.left - itemWidth / 2,
      headerBaseline,
      item.seed,
    );
  }
  context.textAlign = "start";

  const titleX = pxX(TITLE.x);
  const titleY = pxY(TITLE.y);
  const titleWidth = WIDTH - titleX - pxX(TITLE.right);
  const titleHeight = pxY(TITLE.height);
  context.save();
  context.beginPath();
  context.rect(titleX, titleY, titleWidth, titleHeight);
  context.clip();
  context.font = TITLE_FONT;
  context.fillStyle = "#222222";
  drawHandwrittenText(
    context,
    input.title || "제목 없는 일기",
    titleX,
    titleY + titleHeight / 2 + 12,
    50,
  );
  context.restore();

  drawContent(context, input.content, input.analysis);
  drawComment(context, input.analysis);

  return canvas.toDataURL("image/jpeg", 0.92);
}
