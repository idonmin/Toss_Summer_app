import { Button, Paragraph, useToast } from "@toss/tds-mobile";
import { colors } from "@toss/tds-colors";
import { useRef, useState } from "react";

import { ALLOWED_IMAGE_TYPES } from "../constants/diary";
import {
  IMAGE_ERROR_MESSAGES,
  ImageProcessError,
  processImageFile,
  validateImageFile,
} from "../utils/image";

interface PhotoUploadStepProps {
  photoDataUrl: string | null;
  onPhotoChange: (dataUrl: string) => void;
}

/**
 * Step 1: pick a photo from the device.
 *
 * A plain <input type="file"> is used instead of the apps-in-toss album SDK:
 * it opens the native picker in both the local browser and the Toss WebView,
 * and it needs no permission entry in granite.config.ts. The SDK album API can
 * replace this later if multi-select or finer permission UX becomes necessary.
 */
export function PhotoUploadStep({
  photoDataUrl,
  onPhotoChange,
}: PhotoUploadStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const toast = useToast();

  const openPicker = () => {
    // Ignore clicks while a previous pick is still processing: two concurrent
    // picks could resolve out of order and leave the older photo on screen.
    if (processing) {
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    // Reset the input so picking the same file again still fires onChange
    // (browsers skip the event when the value is unchanged).
    event.target.value = "";
    if (file === undefined) {
      return;
    }

    const validationError = validateImageFile(file);
    if (validationError !== null) {
      toast.openToast(IMAGE_ERROR_MESSAGES[validationError]);
      return;
    }

    setProcessing(true);
    try {
      const processed = await processImageFile(file);
      onPhotoChange(processed.dataUrl);
    } catch (error) {
      const code =
        error instanceof ImageProcessError ? error.code : "load-failed";
      toast.openToast(IMAGE_ERROR_MESSAGES[code]);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="step-body">
      {photoDataUrl !== null ? (
        <div className="photo-selected">
          <img
            className="photo-preview"
            src={photoDataUrl}
            alt="선택한 사진 미리보기"
          />
          <Button
            variant="weak"
            color="dark"
            display="block"
            size="medium"
            loading={processing}
            onClick={openPicker}
          >
            다른 사진 선택하기
          </Button>
          {/* The conversion itself starts on the next step (see useSketch),
              so tell the user here what will happen to their photo. */}
          <Paragraph
            typography="t7"
            color={colors.grey600}
            style={{ textAlign: "center" }}
          >
            다음 단계로 가면 사진이 색연필 그림으로 바뀌어요 ✏️
          </Paragraph>
        </div>
      ) : (
        <button
          type="button"
          className="photo-placeholder"
          onClick={openPicker}
          disabled={processing}
        >
          <span className="photo-placeholder-emoji" aria-hidden>
            📷
          </span>
          {/* Fixed colors pair with the fixed light placeholder background.
              Note: @toss/tds-mobile-ait currently pins colorPreference to
              "light", so adaptive.* tokens never change today — if a future
              provider honors dark mode, re-review fixed-vs-adaptive choices.
              as="span": Paragraph defaults to <div>, which is invalid inside
              a <button>; span keeps the markup valid without layout change. */}
          <Paragraph
            as="span"
            typography="t5"
            fontWeight="semibold"
            color={colors.grey800}
          >
            여름 사진 올리기
          </Paragraph>
          <Paragraph as="span" typography="t7" color={colors.grey600}>
            JPG · PNG · WEBP, 10MB 이하 사진 1장
          </Paragraph>
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        hidden
        onChange={handleFileChange}
      />
    </div>
  );
}
