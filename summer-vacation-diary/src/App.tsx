import {
  CTAButton,
  FixedBottomCTA,
  Top,
  useDialog,
  useToast,
} from "@toss/tds-mobile";
import { useState } from "react";

import "./App.css";
import { PhotoUploadStep } from "./components/PhotoUploadStep";
import { PreviewStep } from "./components/PreviewStep";
import { WriteStep } from "./components/WriteStep";
import { CONTENT_MIN_LENGTH } from "./constants/diary";
import { useDiaryAnalysis } from "./hooks/useDiaryAnalysis";
import { useDiaryDraft } from "./hooks/useDiaryDraft";
import { useSketch } from "./hooks/useSketch";
import { DiaryExportError, exportDiaryImage } from "./services/diaryExport";
import { composeDiaryImage } from "./utils/diaryImage";

// Plain state instead of a router: the flow is a strict 3-step wizard with no
// deep links yet, so a router would add dependency weight without benefit.
// If stage 2+ needs shareable URLs, this maps 1:1 onto routes later.
type Step = "upload" | "write" | "preview";

// HHMMSS from the local clock, appended to the saved file name so two saves
// on the same date don't produce an identical name.
function clockSuffix(): string {
  const now = new Date();
  return (
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0")
  );
}

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
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const header = STEP_HEADERS[step];
  const canWrite = draft.photoDataUrl !== null;
  // trim() on both fields so whitespace-only input can't pass validation
  // (the spec's exception handling blocks empty/too-short diaries).
  const canPreview =
    draft.title.trim() !== "" &&
    draft.content.trim().length >= CONTENT_MIN_LENGTH;

  // Stage 4: compose the finished diary into one image and save it.
  const handleFinish = async () => {
    if (draft.photoDataUrl === null || saving) {
      return;
    }

    // Saving with a missing piece is allowed, but never silently: the AI
    // comment / 첨삭 (MVP-required) and the drawing are the whole point, so an
    // incomplete keepsake must be a knowing choice. A sketch *error* is the
    // one exception — it falls back to the original photo, which the spec
    // explicitly endorses and the preview already communicates.
    const drawingLoading = sketchState.status === "loading";
    const commentLoading = analysisState.status === "loading";
    const commentFailed = analysisState.status === "error";

    if (!drawingLoading && !commentLoading && commentFailed) {
      // Nothing will finish on its own — waiting wouldn't help, so offer a
      // retry (the analysis hook only re-runs on an explicit retry) or a save
      // without the comment.
      const retry = await openConfirm({
        title: "선생님 한줄평을 불러오지 못했어요",
        description:
          "다시 시도해서 한줄평과 첨삭까지 담거나, 지금 이대로 저장할 수 있어요.",
        confirmButton: "다시 시도",
        cancelButton: "이대로 저장",
      });
      if (retry) {
        retryAnalysis();
        return;
      }
    } else if (drawingLoading || commentLoading) {
      // Name only what is actually still generating (not a fixed "both"),
      // so the dialog never claims a piece that is already done.
      const pending = [
        drawingLoading ? "색연필 그림" : null,
        commentLoading ? "선생님 한줄평" : null,
      ].filter((part): part is string => part !== null);
      const proceed = await openConfirm({
        title: "아직 그림일기가 만들어지고 있어요",
        description: `조금 기다리면 ${pending.join("과 ")}까지 담아 저장할 수 있어요. 지금 이대로 저장할까요?`,
        confirmButton: "이대로 저장",
        cancelButton: "기다릴게요",
      });
      if (!proceed) {
        return;
      }
    }

    setSaving(true);
    try {
      const imageDataUrl = await composeDiaryImage({
        imageDataUrl: draft.sketchDataUrl ?? draft.photoDataUrl,
        title: draft.title.trim() || "제목 없는 일기",
        content: draft.content,
        date: draft.date,
        weather: draft.weather,
        analysis:
          analysisState.status === "success" ? analysisState.analysis : null,
      });
      const outcome = await exportDiaryImage(
        imageDataUrl,
        // ASCII name (some Android managers mangle Korean) + a time suffix so
        // saving twice in one day can't collide on an identical fileName,
        // whose duplicate handling the platform doesn't define.
        `summer-diary-${draft.date}-${clockSuffix()}.jpg`,
      );

      // saveBase64Data only guarantees a device file save — it does not
      // promise the photo album — so the copy stays location-neutral.
      const keepViewing = await openConfirm({
        title: "그림일기가 저장됐어요",
        description:
          outcome === "saved"
            ? "그림일기를 기기에 저장했어요. 새 일기를 시작할까요?"
            : "다운로드 폴더에 저장했어요. 새 일기를 시작할까요?",
        // Safe action is primary: 새로 쓰기 wipes the (not-yet-re-editable)
        // draft, so it's the de-emphasized cancel to avoid a reflex tap.
        confirmButton: "계속 보기",
        cancelButton: "새로 쓰기",
      });
      if (!keepViewing) {
        clearDraft();
        setStep("upload");
      }
    } catch (error) {
      const message =
        error instanceof DiaryExportError
          ? error.userMessage
          : "그림일기 저장에 실패했어요. 다시 시도해 주세요.";
      // Retry button keeps the failure recoverable in place instead of
      // vanishing with the 3s toast.
      toast.openToast(message, {
        button: {
          text: "다시 시도",
          onClick: () => void handleFinish(),
        },
      });
    } finally {
      setSaving(false);
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
          rightButton={
            <CTAButton loading={saving} onClick={handleFinish}>
              완성하기
            </CTAButton>
          }
        />
      )}
    </>
  );
}

export default App;
