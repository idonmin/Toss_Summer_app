import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_FILE_BYTES,
  MIN_IMAGE_DIMENSION_PX,
} from "../constants/diary";

export type ImageErrorCode =
  "unsupported-format" | "file-too-large" | "image-too-small" | "load-failed";

export const IMAGE_ERROR_MESSAGES: Record<ImageErrorCode, string> = {
  "unsupported-format": "JPG, PNG, WEBP 형식의 사진만 올릴 수 있어요.",
  "file-too-large": "10MB 이하의 사진만 올릴 수 있어요.",
  "image-too-small": "사진이 너무 작아요. 더 큰 사진을 선택해 주세요.",
  "load-failed": "사진을 불러오지 못했어요. 다른 사진으로 시도해 주세요.",
};

// Downscale target: big enough for the diary card and the future
// style-conversion API input, but small enough that the base64 draft fits
// comfortably inside the ~5MB localStorage quota (a raw 10MB photo would
// become ~13MB as base64 and always fail to save).
const MAX_DIMENSION_PX = 1280;
const JPEG_QUALITY = 0.85;

export interface ProcessedImage {
  dataUrl: string;
  width: number;
  height: number;
}

export class ImageProcessError extends Error {
  constructor(public readonly code: ImageErrorCode) {
    super(code);
    this.name = "ImageProcessError";
  }
}

// Cheap checks (MIME type, byte size) run before decoding the image,
// so obviously-invalid files fail fast without touching the canvas.
export function validateImageFile(file: File): ImageErrorCode | null {
  // Some Android pickers/file managers hand over valid images with an empty
  // MIME type. An empty type is treated as "unknown" and allowed through —
  // the decode step below rejects anything that isn't actually an image.
  if (file.type !== "" && !ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return "unsupported-format";
  }
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    return "file-too-large";
  }
  return null;
}

export function processImageFile(file: File): Promise<ProcessedImage> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);

      if (
        image.naturalWidth < MIN_IMAGE_DIMENSION_PX ||
        image.naturalHeight < MIN_IMAGE_DIMENSION_PX
      ) {
        reject(new ImageProcessError("image-too-small"));
        return;
      }

      const scale = Math.min(
        1,
        MAX_DIMENSION_PX / Math.max(image.naturalWidth, image.naturalHeight),
      );
      const width = Math.round(image.naturalWidth * scale);
      const height = Math.round(image.naturalHeight * scale);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new ImageProcessError("load-failed"));
        return;
      }
      // JPEG has no alpha channel, and an untouched canvas is transparent
      // black — without this fill, transparent PNG areas would turn black.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      // Re-encode as JPEG regardless of the source format: photos rarely need
      // transparency, and JPEG keeps the data URL roughly 5-10x smaller than PNG.
      resolve({
        dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
        width,
        height,
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new ImageProcessError("load-failed"));
    };

    image.src = objectUrl;
  });
}
