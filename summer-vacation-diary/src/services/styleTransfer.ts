import { recompressDataUrl } from "../utils/image";
import { applyPencilFilter } from "../utils/sketchFilter";

// ---------------------------------------------------------------------------
// Stage 3 (사진 → 그림 변환) service layer.
//
// Mirrors the stage-2 seam in diaryAnalysis.ts: the UI only calls
// `transferPhotoToSketch()`, and behind it sit two providers:
//  - OpenAI Images (edits endpoint) when VITE_OPENAI_API_KEY is set
//  - a local canvas pencil filter otherwise, so the flow works with no key
// The same seam is where a future backend proxy slots in without UI changes.
// ---------------------------------------------------------------------------

export type SketchErrorCode =
  | "timeout"
  | "network"
  | "invalid-key"
  | "model-unavailable"
  | "rate-limited"
  | "quota-exceeded"
  | "content-blocked"
  | "api-error"
  | "invalid-response";

export const SKETCH_ERROR_MESSAGES: Record<SketchErrorCode, string> = {
  timeout: "그림 변환이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.",
  network: "네트워크 연결을 확인하고 다시 시도해 주세요.",
  "invalid-key": "API 키가 올바르지 않아요. .env의 키를 확인해 주세요.",
  // gpt-image-1 is gated behind OpenAI organization verification — a key that
  // works fine for chat can still fail here, so name the real cause instead
  // of a generic "connection failed" that would send the user the wrong way.
  "model-unavailable":
    "이 API 키로는 그림 변환 모델을 쓸 수 없어요. OpenAI 조직 인증 여부를 확인해 주세요.",
  "rate-limited": "지금은 요청이 많아요. 잠시 후 다시 시도해 주세요.",
  // Same HTTP status (429) as rate limiting but the opposite advice: an
  // empty credit balance never recovers by waiting.
  "quota-exceeded":
    "OpenAI 크레딧이 모두 소진됐어요. 결제 설정을 확인해 주세요.",
  "content-blocked":
    "이 사진은 그림으로 바꾸지 못했어요. 다른 사진으로 시도해 주세요.",
  "api-error":
    "그림 변환 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
  "invalid-response": "변환된 그림을 읽지 못했어요. 다시 시도해 주세요.",
};

export class SketchError extends Error {
  constructor(public readonly code: SketchErrorCode) {
    super(code);
    this.name = "SketchError";
  }
}

export function sketchErrorMessage(error: unknown): string {
  return SKETCH_ERROR_MESSAGES[sketchErrorCode(error)];
}

export function sketchErrorCode(error: unknown): SketchErrorCode {
  return error instanceof SketchError ? error.code : "api-error";
}

/**
 * Whether retrying the SAME photo can possibly succeed. content-blocked is
 * deterministic (moderation rejects the photo itself), so the UI must steer
 * the user toward a different photo instead of offering a retry that costs
 * an API call and predictably fails again.
 */
export function isSketchErrorRetryable(error: unknown): boolean {
  return sketchErrorCode(error) !== "content-blocked";
}

// Same trim rationale as diaryAnalysis.ts: stray whitespace in .env would
// produce a malformed Authorization header.
const apiKey = (import.meta.env.VITE_OPENAI_API_KEY ?? "").trim();
const imageModel =
  (import.meta.env.VITE_OPENAI_IMAGE_MODEL ?? "").trim() || "gpt-image-1";

// Quality maps directly to OpenAI pricing and latency (per image, roughly:
// low ≈ $0.01 / ~15s, medium ≈ $0.04 / ~30s, high ≈ $0.17 / ~60s).
// Medium default: the drawing IS the product here, and the wait overlaps
// with the diary-writing step anyway.
const QUALITY_VALUES = ["low", "medium", "high"] as const;
type SketchQuality = (typeof QUALITY_VALUES)[number];
const rawQuality = (import.meta.env.VITE_OPENAI_IMAGE_QUALITY ?? "").trim();
const imageQuality: SketchQuality = (
  QUALITY_VALUES as readonly string[]
).includes(rawQuality)
  ? (rawQuality as SketchQuality)
  : "medium";

export const isSketchAiConnected = apiKey !== "";

/**
 * Converts the diary photo into a colored-pencil style drawing and returns it
 * as a ≤1280px JPEG data URL, ready to store in the draft (개발 단계 3단계).
 */
export function transferPhotoToSketch(photoDataUrl: string): Promise<string> {
  return isSketchAiConnected
    ? sketchWithOpenAi(photoDataUrl)
    : sketchWithLocalFilter(photoDataUrl);
}

// --- OpenAI provider --------------------------------------------------------

const OPENAI_IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits";
// Image generation is far slower than chat (medium quality commonly runs
// 30-60s), so the budget is generous compared to the 30s used for analysis.
const REQUEST_TIMEOUT_MS = 120_000;

// English prompt on purpose: image models follow style instructions written
// in English more reliably, and no Korean user text is involved here.
const SKETCH_PROMPT = [
  "Redraw this exact photo as a warm colored-pencil drawing for a summer",
  "vacation picture diary. Keep the same composition, subjects, poses and",
  "overall colors as the original photo. Hand-drawn colored pencil strokes,",
  "soft paper texture, gentle warm summer light. Do not add, remove or",
  "replace any people or objects.",
].join(" ");

// The images endpoint takes multipart/form-data (a file upload), not JSON,
// so the canvas data URL must be decoded back into binary first.
function dataUrlToBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(",");
  const mime = /^data:([^;]+);base64$/.exec(dataUrl.slice(0, commaIndex))?.[1];
  if (commaIndex === -1 || mime === undefined) {
    // Draft data URLs always come from canvas.toDataURL, so reaching this
    // is a programming error, not a user-facing condition.
    throw new SketchError("invalid-response");
  }
  const binary = atob(dataUrl.slice(commaIndex + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

// Reads the error payload to tell apart "this key can't use the image model"
// (the most likely first-call failure) and "photo rejected by moderation"
// from generic API failures — each needs a different user instruction.
async function toSketchError(response: Response): Promise<SketchError> {
  let code = "";
  let message = "";
  try {
    const body = (await response.json()) as {
      error?: { code?: unknown; message?: unknown };
    };
    if (typeof body.error?.code === "string") {
      code = body.error.code;
    }
    if (typeof body.error?.message === "string") {
      message = body.error.message;
    }
  } catch {
    // Unreadable error body — fall through to status-based mapping.
  }
  if (response.status === 401) {
    return new SketchError("invalid-key");
  }
  // Checked BEFORE the bare 429 mapping: OpenAI uses 429 both for transient
  // rate limits and for an exhausted credit balance (code insufficient_quota),
  // and only the former is worth telling the user to retry.
  if (code === "insufficient_quota") {
    return new SketchError("quota-exceeded");
  }
  if (response.status === 429) {
    return new SketchError("rate-limited");
  }
  if (code === "moderation_blocked" || message.includes("safety system")) {
    return new SketchError("content-blocked");
  }
  if (
    response.status === 403 ||
    code === "model_not_found" ||
    message.toLowerCase().includes("verif")
  ) {
    return new SketchError("model-unavailable");
  }
  return new SketchError("api-error");
}

async function sketchWithOpenAi(photoDataUrl: string): Promise<string> {
  // The form (including dataUrlToBlob, which can throw on a corrupted draft)
  // is built BEFORE the abort timer is armed — otherwise a synchronous throw
  // here would skip the finally below and leak the armed timer for 120s.
  const form = new FormData();
  form.append("model", imageModel);
  // The draft photo is already a ≤1280px JPEG (utils/image.ts), comfortably
  // under the API's input limits — no extra downscale pass needed here.
  form.append("image", dataUrlToBlob(photoDataUrl), "photo.jpg");
  form.append("prompt", SKETCH_PROMPT);
  // "auto" lets the API pick the supported canvas closest to the photo's
  // aspect ratio instead of force-cropping everything to a square.
  form.append("size", "auto");
  form.append("quality", imageQuality);
  // JPEG output shrinks the base64 payload ~5x vs the default PNG — the
  // response is large enough for that to matter on mobile networks.
  form.append("output_format", "jpeg");
  form.append("n", "1");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let body: unknown;
  // Same two-phase abort handling as diaryAnalysis.ts: the timer must stay
  // armed through the body read, or a stalled body would hang the UI forever.
  let phase: "request" | "body" = "request";
  try {
    const response = await fetch(OPENAI_IMAGE_EDIT_URL, {
      method: "POST",
      // No Content-Type header on purpose: the browser must generate the
      // multipart boundary itself; setting the header manually breaks it.
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: form,
    });
    if (!response.ok) {
      throw await toSketchError(response);
    }
    phase = "body";
    body = await response.json();
  } catch (error) {
    if (error instanceof SketchError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new SketchError("timeout");
    }
    throw new SketchError(phase === "request" ? "network" : "invalid-response");
  } finally {
    clearTimeout(timer);
  }

  const b64 = (body as { data?: Array<{ b64_json?: unknown }> }).data?.[0]
    ?.b64_json;
  if (typeof b64 !== "string" || b64 === "") {
    throw new SketchError("invalid-response");
  }

  try {
    // The API returns up to 1536px; recompress to the same ≤1280px JPEG the
    // draft photo uses so the sketch also fits the localStorage draft.
    return await recompressDataUrl(`data:image/jpeg;base64,${b64}`);
  } catch {
    throw new SketchError("invalid-response");
  }
}

// --- Local filter provider ---------------------------------------------------

// Simulated latency mirrors the analysis mock: the loading overlay is part of
// the flow being built, so it should actually appear in keyless dev runs.
const MOCK_DELAY_MS = 1500;

async function sketchWithLocalFilter(photoDataUrl: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
  try {
    return await applyPencilFilter(photoDataUrl);
  } catch {
    throw new SketchError("invalid-response");
  }
}
