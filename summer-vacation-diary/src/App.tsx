import { CTAButton, FixedBottomCTA, Top, useDialog } from "@toss/tds-mobile";
import { useState } from "react";

import "./App.css";
import { PhotoUploadStep } from "./components/PhotoUploadStep";
import { PreviewStep } from "./components/PreviewStep";
import { WriteStep } from "./components/WriteStep";
import { CONTENT_MIN_LENGTH } from "./constants/diary";
import { useDiaryAnalysis } from "./hooks/useDiaryAnalysis";
import { useDiaryDraft } from "./hooks/useDiaryDraft";
import { useSketch } from "./hooks/useSketch";

// Plain state instead of a router: the flow is a strict 3-step wizard with no
// deep links yet, so a router would add dependency weight without benefit.
// If stage 2+ needs shareable URLs, this maps 1:1 onto routes later.
type Step = "upload" | "write" | "preview";

const STEP_HEADERS: Record<Step, { title: string; subtitle: string }> = {
  upload: {
    title: "어떤 여름이었나요?",
    subtitle: "그림일기로 만들 사진 1장을 골라주세요.",
  },
  write: {
    title: "일기 쓰기",
    subtitle: "사진 속 이야기를 짧게 적어주세요.",
  },
  preview: {
    title: "그림일기 미리보기",
    subtitle: "선생님의 한줄평과 함께 확인해 보세요.",
  },
};

function App() {
  const [step, setStep] = useState<Step>("upload");
  const { draft, updateDraft, clearDraft } = useDiaryDraft();
  // Analysis runs only while the preview is visible; results are cached by
  // input inside the hook, so re-entering preview without edits is free.
  const { state: analysisState, retry: retryAnalysis } = useDiaryAnalysis(
    draft,
    step === "preview",
  );
  // The drawing conversion starts when the user commits to writing (leaves
  // the upload step): its 30-60s latency then overlaps with typing time, and
  // an abandoned photo pick never spends an API call.
  const { state: sketchState, retry: retrySketch } = useSketch(
    draft,
    updateDraft,
    step !== "upload",
  );
  const { openConfirm } = useDialog();

  const header = STEP_HEADERS[step];
  const canWrite = draft.photoDataUrl !== null;
  // trim() on both fields so whitespace-only input can't pass validation
  // (the spec's exception handling blocks empty/too-short diaries).
  const canPreview =
    draft.title.trim() !== "" &&
    draft.content.trim().length >= CONTENT_MIN_LENGTH;

  const handleFinish = async () => {
    // Stages 3-4 (drawing conversion, image export) are not built yet, so
    // "finish" currently means: explain that, then offer a fresh start.
    // Destructive (clears the draft) → always confirm first.
    const confirmed = await openConfirm({
      title: "여기까지 준비됐어요",
      description:
        "사진을 그림으로 바꾸는 기능은 다음 업데이트에서 추가돼요. 지금 내용을 지우고 새 일기를 시작할까요?",
      confirmButton: "새로 쓰기",
      cancelButton: "닫기",
    });
    if (confirmed) {
      clearDraft();
      setStep("upload");
    }
  };

  return (
    <>
      <Top
        title={
          <Top.TitleParagraph size={22}>{header.title}</Top.TitleParagraph>
        }
        subtitleBottom={
          <Top.SubtitleParagraph size={15}>
            {header.subtitle}
          </Top.SubtitleParagraph>
        }
      />

      {step === "upload" && (
        <PhotoUploadStep
          photoDataUrl={draft.photoDataUrl}
          onPhotoChange={(dataUrl) =>
            // A sketch belongs to exactly one photo — replacing the photo
            // must drop the old drawing in the same state update, or the
            // preview could pair the new photo with the previous sketch.
            updateDraft({ photoDataUrl: dataUrl, sketchDataUrl: null })
          }
        />
      )}
      {step === "write" && <WriteStep draft={draft} onChange={updateDraft} />}
      {step === "preview" && (
        <PreviewStep
          draft={draft}
          analysisState={analysisState}
          onRetry={retryAnalysis}
          sketchState={sketchState}
          onSketchRetry={retrySketch}
        />
      )}

      {step === "upload" && (
        <FixedBottomCTA disabled={!canWrite} onClick={() => setStep("write")}>
          일기 쓰러 가기
        </FixedBottomCTA>
      )}
      {step === "write" && (
        <FixedBottomCTA.Double
          leftButton={
            <CTAButton
              color="dark"
              variant="weak"
              onClick={() => setStep("upload")}
            >
              이전
            </CTAButton>
          }
          rightButton={
            <CTAButton
              disabled={!canPreview}
              onClick={() => setStep("preview")}
            >
              미리보기
            </CTAButton>
          }
        />
      )}
      {step === "preview" && (
        <FixedBottomCTA.Double
          leftButton={
            <CTAButton
              color="dark"
              variant="weak"
              onClick={() => setStep("write")}
            >
              수정하기
            </CTAButton>
          }
          rightButton={<CTAButton onClick={handleFinish}>완성하기</CTAButton>}
        />
      )}
    </>
  );
}

export default App;
