import {
  getOperationalEnvironment,
  saveBase64Data,
} from "@apps-in-toss/web-framework";

// ---------------------------------------------------------------------------
// Stage 4 (저장) service layer.
//
// Inside the Toss app the native bridge writes the file to the device
// (saveBase64Data, SDK 3.x). In a plain browser — the local dev flow — the
// bridge doesn't exist, so a regular <a download> is used instead. The caller
// gets told which path ran so the success message can match reality.
// ---------------------------------------------------------------------------

export type ExportOutcome = "saved" | "downloaded";

export class DiaryExportError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
    this.name = "DiaryExportError";
  }
}

// getOperationalEnvironment reads a global the Toss WebView injects; in a
// plain browser it throws (or returns nothing), which is exactly the signal
// that the native bridge is unavailable.
function isInsideTossApp(): boolean {
  try {
    const environment = getOperationalEnvironment();
    return environment === "toss" || environment === "sandbox";
  } catch {
    return false;
  }
}

/**
 * Saves the composed diary image to the user's device.
 * `dataUrl` must be a base64 data URL (canvas.toDataURL output).
 */
export async function exportDiaryImage(
  dataUrl: string,
  fileName: string,
): Promise<ExportOutcome> {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) {
    throw new DiaryExportError("이미지를 만들지 못했어요. 다시 시도해 주세요.");
  }

  if (isInsideTossApp()) {
    try {
      await saveBase64Data({
        // The bridge expects bare base64 — the data: prefix must be stripped.
        data: dataUrl.slice(commaIndex + 1),
        fileName,
        mimeType: "image/jpeg",
      });
      return "saved";
    } catch {
      throw new DiaryExportError(
        "그림일기를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    }
  }

  // Local-browser fallback: a normal file download.
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  // Firefox only honors the click when the anchor is attached to the DOM.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return "downloaded";
}
