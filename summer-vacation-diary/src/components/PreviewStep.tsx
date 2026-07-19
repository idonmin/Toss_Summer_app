import { Button, Loader, Paragraph } from "@toss/tds-mobile";
import { useState } from "react";

import { weatherLabel } from "../constants/diary";
import type { AnalysisState } from "../hooks/useDiaryAnalysis";
import type { DiaryDraft } from "../hooks/useDiaryDraft";
import type { SketchState } from "../hooks/useSketch";
import { isAiConnected } from "../services/diaryAnalysis";
import type { DiaryAnalysis } from "../services/diaryAnalysis";
import { buildDiaryTags } from "../utils/diaryImage";
import { handwritingVariation } from "../utils/handwriting";
import { buildHighlightSegments } from "../utils/highlight";

interface PreviewStepProps {
  draft: DiaryDraft;
  analysisState: AnalysisState;
  onRetry: () => void;
  sketchState: SketchState;
  onSketchRetry: () => void;
}

// 날짜/날씨/제목처럼 한 요소 안에 있는 문자열도 한 글자씩 나눠서
// 본문과 같은 고정된 손글씨 흔들림을 적용합니다.
function HandwrittenText({
  text,
  seedOffset = 0,
}: {
  text: string;
  seedOffset?: number;
}) {
  return Array.from(text).map((character, index) => {
    const variation = handwritingVariation(character, index + seedOffset);
    return (
      <span
        key={`${index}-${character}`}
        className="handwritten-character"
        style={{
          fontSize: `${variation.scale}em`,
          // 날짜/날씨/제목에도 글자별 굵기와 농도 차이를 적용합니다.
          fontWeight: variation.fontWeight,
          opacity: variation.opacity,
          transform: `translate(${variation.offsetXEm}em, ${variation.offsetYEm}em) rotate(${variation.rotationDeg}deg)`,
        }}
      >
        {character === " " ? "\u00a0" : character}
      </span>
    );
  });
}

// Renders the diary text onto an 11x5 manuscript grid, one character per cell.
// Correction marks (circle/underline) are drawn as an absolutely-positioned
// visual overlay. The overlay is aria-hidden, so these marks are NOT exposed
// to screen readers (visual-only for now).
function HighlightedContent({
  content,
  analysis,
}: {
  content: string;
  analysis: DiaryAnalysis | null;
}) {
  const columnCount = 11;
  const rowCount = 5;
  const segments =
    analysis === null
      ? [{ text: content, mark: null }]
      : buildHighlightSegments(
          content,
          analysis.highlightWords,
          analysis.highlightSentence,
        );
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
        continue;
      }
      cells.push({ text: character, mark: segment.mark });
    }
  }

  // Fill the five manuscript rows printed on the supplied diary frame.
  const visibleCellCount = Math.max(
    columnCount * rowCount,
    Math.ceil(cells.length / columnCount) * columnCount,
  );
  while (cells.length < visibleCellCount) {
    cells.push({ text: "", mark: null });
  }

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

  return (
    <>
      {cells.slice(0, columnCount * rowCount).map((cell, index) => {
        // 본문도 날짜·날씨·제목과 동일한 기본 강도 1을 사용합니다.
        const variation = handwritingVariation(cell.text, index, 1);
        return (
          <span
            key={index}
            className="diary-grid-cell"
            style={{
              fontSize: `${variation.scale}em`,
              // 본문에도 같은 굵기와 농도 변화를 적용합니다.
              fontWeight: variation.fontWeight,
              opacity: variation.opacity,
              transform: `translate(${variation.offsetXEm}em, ${variation.offsetYEm}em) rotate(${variation.rotationDeg}deg)`,
            }}
          >
            {cell.text === " " ? "\u00a0" : cell.text}
          </span>
        );
      })}
      <span className="diary-correction-layer" aria-hidden>
        {correctionRuns.map((run, index) => (
          <span
            key={index}
            className={`diary-correction diary-correction-${run.mark}`}
            style={{
              left: `${(run.startColumn / columnCount) * 100}%`,
              top: `${(run.row / rowCount) * 100}%`,
              width: `${(run.length / columnCount) * 100}%`,
              height: `${100 / rowCount}%`,
            }}
          />
        ))}
      </span>
    </>
  );
}

/**
 * Step 3: the diary card laid out per the spec's 기본 구성
 * (date/weather → photo → title → content → one-line comment).
 * Stage 2 fills the comment area with the real analysis result (comment +
 * tags + highlight marks); stage 3 swaps the photo for the pencil drawing,
 * with the original photo as the fallback while converting / on failure
 * (spec: "원본 사진으로 그림일기를 만들거나 다시 시도할 수 있습니다").
 */
export function PreviewStep({
  draft,
  analysisState,
  onRetry,
  sketchState,
  onSketchRetry,
}: PreviewStepProps) {
  const analysis =
    analysisState.status === "success" ? analysisState.analysis : null;

  // Before/after toggle: seeing their own photo become the drawing is the
  // product's wow moment, so comparing must be one tap, not a re-upload.
  const [showOriginal, setShowOriginal] = useState(false);
  const sketchUrl =
    sketchState.status === "success" ? sketchState.sketchDataUrl : null;
  const showsSketch = sketchUrl !== null && !showOriginal;

  // Announced through the always-mounted live region below. A region that
  // mounts together with its text is often not read at all — only TEXT
  // CHANGES inside an existing region are reliably announced, which is
  // exactly what happens when loading flips to success mid-visit.
  const sketchAnnouncement =
    sketchState.status === "loading"
      ? "사진을 색연필 그림으로 바꾸고 있어요"
      : sketchState.status === "success"
        ? "색연필 그림이 완성됐어요"
        : sketchState.status === "error"
          ? "그림 변환에 실패해서 원본 사진이 보여요"
          : "";
  // Shared with the saved-image renderer so the preview and the exported
  // diary always show the same tags.
  const tags = analysis === null ? [] : buildDiaryTags(analysis);
  const [year = "", month = "", day = ""] = draft.date.split("-");
  const diaryDate = new Date(`${draft.date}T00:00:00`);
  const weekday = Number.isNaN(diaryDate.getTime())
    ? ""
    : new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(diaryDate);

  return (
    <div className="step-body">
      <p className="visually-hidden" role="status">
        {sketchAnnouncement}
      </p>

      <div className="diary-card">
        <div className="diary-template">
          <img
            className="diary-template-frame"
            src="/picture-diary-frame.png"
            alt=""
            aria-hidden
          />

          <div className="diary-card-header">
            <span>
              <strong>
                <HandwrittenText text={year} />
              </strong>
            </span>
            <span>
              <strong>
                <HandwrittenText text={String(Number(month))} seedOffset={10} />
              </strong>
            </span>
            <span>
              <strong>
                <HandwrittenText text={String(Number(day))} seedOffset={20} />
              </strong>
            </span>
            <span>
              <strong>
                <HandwrittenText text={weekday} seedOffset={30} />
              </strong>
            </span>
            <span className="diary-weather">
              <strong>
                <HandwrittenText
                  text={weatherLabel(draft.weather)}
                  seedOffset={40}
                />
              </strong>
            </span>
          </div>

          <div className="diary-title-row">
            <strong>
              <HandwrittenText
                text={draft.title !== "" ? draft.title : "제목 없는 일기"}
                seedOffset={50}
              />
            </strong>
          </div>

          <div className="diary-card-photo">
            {draft.photoDataUrl !== null ? (
              <>
                <img
                  src={showsSketch ? sketchUrl : draft.photoDataUrl}
                  alt={
                    showsSketch ? "색연필 그림으로 바뀐 일기 사진" : "일기 사진"
                  }
                />
                {sketchState.status === "loading" && (
                  // aria-hidden: the persistent live region at the top of this
                  // component already announces the conversion; reading this
                  // overlay too would announce it twice.
                  <div className="sketch-overlay" aria-hidden>
                    <Loader size="small" />
                    <span>사진을 색연필 그림으로 바꾸고 있어요</span>
                  </div>
                )}
                {sketchUrl !== null && (
                  <button
                    type="button"
                    className="sketch-toggle"
                    onClick={() => setShowOriginal((value) => !value)}
                  >
                    {showOriginal ? "그림 보기" : "원본 사진 보기"}
                  </button>
                )}
              </>
            ) : (
              <div className="diary-card-photo-empty">사진이 없어요</div>
            )}
          </div>

          <div className="diary-card-content">
            <HighlightedContent content={draft.content} analysis={analysis} />
          </div>

          {/* Fixed colors throughout the card: it sits on a fixed paper
            background (#fffdf5), and the AIT provider is light-only today. */}
          <div className="diary-card-comment">
            <div className="diary-comment-label">선생님 한줄평</div>
            {analysisState.status === "loading" && (
              <div className="comment-loading">
                <Loader size="small" />
                <Paragraph as="span" typography="t7" color="#8a7d55">
                  선생님이 일기를 읽고 있어요...
                </Paragraph>
              </div>
            )}

            {analysisState.status === "error" && (
              <div className="comment-error">
                <Paragraph typography="t7" color="#8a7d55">
                  {analysisState.message}
                </Paragraph>
                <Button
                  size="small"
                  variant="weak"
                  color="dark"
                  onClick={onRetry}
                >
                  다시 시도
                </Button>
              </div>
            )}

            {analysis !== null && (
              <>
                <Paragraph typography="t6" fontWeight="medium" color="#6b5e3f">
                  ✏️ {analysis.comment}
                </Paragraph>
                {tags.length > 0 && (
                  <div className="diary-tags">
                    {tags.map((tag) => (
                      <span key={tag} className="diary-tag">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Outside the analysis-success branch on purpose: keyless users
              see the mock drawing even while the analysis is loading or has
              failed, and it must never pass for the real AI conversion. */}
            {!isAiConnected && (
              <Paragraph
                typography="t7"
                color="#6b5e3f"
                style={{ marginTop: 8 }}
              >
                체험 모드 · AI와 연결되지 않아 예시 분석과 간단한 그림 효과가
                보여요
              </Paragraph>
            )}
          </div>
        </div>

        {sketchState.status === "error" && (
          <div className="sketch-error">
            <Paragraph typography="t7" color="#6b5e3f">
              {sketchState.message}
            </Paragraph>
            <div className="sketch-error-actions">
              <Paragraph as="span" typography="t7" color="#6b5e3f">
                원본 사진으로도 완성할 수 있어요
              </Paragraph>
              {sketchState.retryable && (
                <Button
                  size="small"
                  variant="weak"
                  color="dark"
                  onClick={onSketchRetry}
                >
                  다시 시도
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
