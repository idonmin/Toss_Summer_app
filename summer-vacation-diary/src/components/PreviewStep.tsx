import { Button, Loader, Paragraph } from "@toss/tds-mobile";

import { weatherLabel } from "../constants/diary";
import type { AnalysisState } from "../hooks/useDiaryAnalysis";
import type { DiaryDraft } from "../hooks/useDiaryDraft";
import { isAiConnected } from "../services/diaryAnalysis";
import type { DiaryAnalysis } from "../services/diaryAnalysis";
import { buildHighlightSegments } from "../utils/highlight";

interface PreviewStepProps {
  draft: DiaryDraft;
  analysisState: AnalysisState;
  onRetry: () => void;
}

// "2026-07-13" → "2026년 7월 13일" for the diary header.
function formatKoreanDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) {
    return date;
  }
  return `${year}년 ${month}월 ${day}일`;
}

// Renders the diary text with 첨삭 marks. <mark> (not a styled <span>) so
// screen readers announce the highlighted parts as marked text.
function HighlightedContent({
  content,
  analysis,
}: {
  content: string;
  analysis: DiaryAnalysis;
}) {
  const segments = buildHighlightSegments(
    content,
    analysis.highlightWords,
    analysis.highlightSentence,
  );
  return (
    <>
      {segments.map((segment, index) =>
        segment.mark === null ? (
          // Index keys are safe here: the list is rebuilt from scratch on
          // every content/analysis change and has no per-item state.
          <span key={index}>{segment.text}</span>
        ) : (
          <mark
            key={index}
            className={
              segment.mark === "circle"
                ? "highlight-circle"
                : "highlight-underline"
            }
          >
            {segment.text}
          </mark>
        ),
      )}
    </>
  );
}

/**
 * Step 3: the diary card laid out per the spec's 기본 구성
 * (date/weather → photo → title → content → one-line comment).
 * Stage 2 fills the comment area with the real analysis result (comment +
 * tags + highlight marks); stage 3 will swap the photo for the drawing.
 */
export function PreviewStep({
  draft,
  analysisState,
  onRetry,
}: PreviewStepProps) {
  const analysis =
    analysisState.status === "success" ? analysisState.analysis : null;
  // Emotions first — they make the most evocative tags; Set dedupes overlap
  // between photo and diary keywords.
  const tags =
    analysis === null
      ? []
      : [
          ...new Set([
            ...analysis.emotions,
            ...analysis.photoKeywords,
            ...analysis.diaryKeywords,
          ]),
        ].slice(0, 6);

  return (
    <div className="step-body">
      <div className="diary-card">
        <div className="diary-card-header">
          <span>{formatKoreanDate(draft.date)}</span>
          <span>{weatherLabel(draft.weather)}</span>
        </div>

        <div className="diary-card-photo">
          {draft.photoDataUrl !== null ? (
            <img src={draft.photoDataUrl} alt="일기 사진" />
          ) : (
            <div className="diary-card-photo-empty">사진이 없어요</div>
          )}
        </div>

        <div className="diary-card-title">
          {draft.title !== "" ? draft.title : "제목 없는 일기"}
        </div>

        <div className="diary-card-content">
          {analysis !== null ? (
            <HighlightedContent content={draft.content} analysis={analysis} />
          ) : (
            draft.content
          )}
        </div>

        {/* Fixed colors throughout the card: it sits on a fixed paper
            background (#fffdf5), and the AIT provider is light-only today. */}
        <div className="diary-card-comment">
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
              {!isAiConnected && (
                <Paragraph
                  typography="t7"
                  color="#b0a988"
                  style={{ marginTop: 8 }}
                >
                  체험 모드 · 아직 분석 서버와 연결되지 않아 예시 결과가 보여요
                </Paragraph>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
