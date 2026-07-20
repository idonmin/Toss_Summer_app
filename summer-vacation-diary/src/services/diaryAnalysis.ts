import { weatherLabel } from "../constants/diary";
import type { WeatherValue } from "../constants/diary";

// ---------------------------------------------------------------------------
// Stage 2 (AI 분석) service layer.
//
// The UI only talks to `analyzeDiary()`. Behind it there are two providers:
//  - OpenAI (vision chat completion) when VITE_OPENAI_API_KEY is set
//  - a deterministic local mock otherwise, so the whole flow can be built
//    and tested before any key exists
// Keeping this seam here also makes the future "move behind our own backend
// proxy" change a one-file swap instead of a UI rewrite.
// ---------------------------------------------------------------------------

export interface DiaryAnalysisInput {
  photoDataUrl: string | null;
  title: string;
  content: string;
  weather: WeatherValue;
}

export interface DiaryAnalysis {
  photoKeywords: string[];
  diaryKeywords: string[];
  emotions: string[];
  /** Verbatim substrings of the diary content, to be circled in the preview. */
  highlightWords: string[];
  /** One verbatim sentence of the diary content, underlined in the preview. */
  highlightSentence: string | null;
  /** The teacher-style one-line comment. */
  comment: string;
}

export type AnalysisErrorCode =
  | "timeout"
  | "network"
  | "invalid-key"
  | "rate-limited"
  | "api-error"
  | "invalid-response";

export const ANALYSIS_ERROR_MESSAGES: Record<AnalysisErrorCode, string> = {
  timeout: "분석이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.",
  network: "네트워크 연결을 확인하고 다시 시도해 주세요.",
  // Distinct message for a bad key: it's the most likely failure on the very
  // first real call after the user fills in .env, and "connection failed"
  // would send them debugging the wrong thing.
  "invalid-key": "API 키가 올바르지 않아요. .env의 키를 확인해 주세요.",
  "rate-limited": "지금은 요청이 많아요. 잠시 후 다시 시도해 주세요.",
  "api-error": "분석 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
  "invalid-response": "분석 결과를 읽지 못했어요. 다시 시도해 주세요.",
};

export class AnalysisError extends Error {
  constructor(public readonly code: AnalysisErrorCode) {
    super(code);
    this.name = "AnalysisError";
  }
}

export function analysisErrorMessage(error: unknown): string {
  if (error instanceof AnalysisError) {
    return ANALYSIS_ERROR_MESSAGES[error.code];
  }
  return ANALYSIS_ERROR_MESSAGES["api-error"];
}

// Vite inlines VITE_* variables into the client bundle at build time, so the
// key is readable by anyone who inspects the shipped app. That is acceptable
// for local development and the challenge demo, but before a public release
// this call must move behind our own backend so the key never ships.
// Trimmed once here: a key pasted into .env with stray whitespace would pass
// the connectivity check below but send a malformed Authorization header.
const apiKey = (import.meta.env.VITE_OPENAI_API_KEY ?? "").trim();
const model = (import.meta.env.VITE_OPENAI_MODEL ?? "").trim() || "gpt-4o-mini";

export const isAiConnected = apiKey !== "";

/**
 * Analyzes the photo + diary text and returns keywords, emotions, highlight
 * targets and the one-line comment (개발 단계 2단계).
 */
export function analyzeDiary(
  input: DiaryAnalysisInput,
): Promise<DiaryAnalysis> {
  return isAiConnected ? analyzeWithOpenAi(input) : analyzeWithMock(input);
}

// --- OpenAI provider --------------------------------------------------------

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
// The spec's 예외 처리 section requires a timeout path; 30s matches its
// "평균 생성 시간 30초 이내" target.
const REQUEST_TIMEOUT_MS = 30_000;

// Keys are snake_case to mirror the planning doc's "AI 반환 데이터 예시",
// so the prompt, the doc and the parser all describe the same shape.
const SYSTEM_PROMPT = `당신은 여름방학 그림일기를 읽고 따뜻한 한줄평을 써 주는 선생님입니다.
사용자가 올린 사진과 일기를 함께 분석해서, 아래 키를 가진 JSON 객체만 응답하세요.
- "photo_keywords": 사진 속 장소·사물·분위기 키워드 (한국어, 최대 3개)
- "diary_keywords": 일기의 주요 키워드 (한국어, 최대 4개)
- "emotions": 일기에서 느껴지는 핵심 감정 (한국어, 최대 3개)
- "highlight_words": 일기 본문에 '그대로' 등장하는 의미 있는 단어 2~4개 (본문에 없는 단어는 금지)
- "highlight_sentence": 일기 본문에 '그대로' 등장하는 가장 인상적인 문장 1개 (마땅한 문장이 없으면 null)
- "comment": 사진 장면과 일기의 감정을 함께 담은 따뜻한 한줄평. 존댓말 한 문장, 공백 포함 50자 이내. 어린아이에게 말하듯 하지 말고, 평가나 지적 대신 감상과 공감을 담으세요.`;

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "low" } };

interface ChatMessage {
  role: "system" | "user";
  content: string | ChatContentPart[];
}

function buildMessages(input: DiaryAnalysisInput): ChatMessage[] {
  const userParts: ChatContentPart[] = [
    {
      type: "text",
      text: [
        `제목: ${input.title}`,
        `날씨: ${weatherLabel(input.weather)}`,
        "일기:",
        input.content,
      ].join("\n"),
    },
  ];
  if (input.photoDataUrl !== null) {
    // detail "low": the photo is already downscaled to ≤1280px, and keyword /
    // mood extraction doesn't need high-res tiles — this keeps token cost flat.
    userParts.push({
      type: "image_url",
      image_url: { url: input.photoDataUrl, detail: "low" },
    });
  }
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userParts },
  ];
}

function toStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (item): item is string => typeof item === "string" && item.trim() !== "",
    )
    .map((item) => item.trim())
    .slice(0, max);
}

// The model's JSON is untrusted input: every field is validated, and highlight
// targets that are not verbatim substrings of the diary are dropped so the
// preview never marks text that isn't there.
function parseAnalysis(rawJson: string, content: string): DiaryAnalysis {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new AnalysisError("invalid-response");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new AnalysisError("invalid-response");
  }
  const record = parsed as Record<string, unknown>;

  const comment =
    typeof record.comment === "string" ? record.comment.trim() : "";
  if (comment === "") {
    // The comment is the one field the user actually reads — without it the
    // response is useless, so treat it as a failure (spec: 한줄평 생성 실패).
    throw new AnalysisError("invalid-response");
  }

  // Verbatim-filter BEFORE capping at 4: if the model pads the list with
  // paraphrased words, slicing first could throw away the valid ones.
  const highlightWords = toStringArray(record.highlight_words, 8)
    .filter((word) => content.includes(word))
    .slice(0, 4);
  const sentence =
    typeof record.highlight_sentence === "string"
      ? record.highlight_sentence.trim()
      : "";
  // Length cap: underlining a huge "sentence" would decorate most of the
  // diary, against the spec's 첨삭 원칙 (지나치게 많이 사용하지 않음).
  const sentenceIsUsable =
    sentence !== "" && sentence.length <= 100 && content.includes(sentence);

  return {
    photoKeywords: toStringArray(record.photo_keywords, 3),
    diaryKeywords: toStringArray(record.diary_keywords, 4),
    emotions: toStringArray(record.emotions, 3),
    highlightWords,
    highlightSentence: sentenceIsUsable ? sentence : null,
    comment,
  };
}

async function analyzeWithOpenAi(
  input: DiaryAnalysisInput,
): Promise<DiaryAnalysis> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let body: unknown;
  // The abort timer must stay armed through the BODY read too — clearing it
  // when headers arrive would let a stalled body hang the loading UI forever.
  let phase: "request" | "body" = "request";
  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        // max_completion_tokens (not the deprecated max_tokens) and no
        // explicit temperature: keeps the request valid if the user points
        // VITE_OPENAI_MODEL at a reasoning-family model, which rejects both.
        // 1200 leaves room for a long verbatim highlight_sentence from a
        // 500-char diary — as a cap it doesn't add cost when unused.
        max_completion_tokens: 1200,
        // Forces a JSON object back, so parsing failures become rare instead
        // of routine.
        response_format: { type: "json_object" },
        messages: buildMessages(input),
      }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AnalysisError("invalid-key");
      }
      if (response.status === 429) {
        throw new AnalysisError("rate-limited");
      }
      throw new AnalysisError("api-error");
    }
    phase = "body";
    body = await response.json();
  } catch (error) {
    if (error instanceof AnalysisError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new AnalysisError("timeout");
    }
    // A non-abort failure while requesting is a network problem; while
    // reading/parsing the body it's a malformed response.
    throw new AnalysisError(
      phase === "request" ? "network" : "invalid-response",
    );
  } finally {
    clearTimeout(timer);
  }
  const raw = (body as { choices?: Array<{ message?: { content?: unknown } }> })
    .choices?.[0]?.message?.content;
  if (typeof raw !== "string") {
    throw new AnalysisError("invalid-response");
  }
  return parseAnalysis(raw, input.content);
}

// --- Mock provider ----------------------------------------------------------
// Deterministic on purpose: the same diary always produces the same result,
// which makes the preview UI stable to build against and easy to eyeball.

const MOCK_DELAY_MS = 1200;

// The three example comments from the planning doc, so the mock output looks
// like what the real model is asked to produce.
const MOCK_COMMENTS = [
  "시원한 바다와 함께한 여유로운 하루가 글에 잘 담겨 있네요.",
  "친구들과 보낸 즐거운 여름의 순간이 오래 기억에 남을 것 같아요.",
  "파도 소리와 편안했던 마음이 함께 전해지는 기록이에요.",
];

const MOCK_EMOTION_RULES: Array<{ pattern: RegExp; emotion: string }> = [
  { pattern: /즐거|즐겁|재밌|재미|신나/, emotion: "즐거움" },
  { pattern: /편안|여유|힐링/, emotion: "편안함" },
  { pattern: /행복|좋았|좋아/, emotion: "행복" },
  { pattern: /시원|바다|계곡|수영/, emotion: "시원함" },
  { pattern: /설레|기대/, emotion: "설렘" },
];

// Naive tokenizer: split on whitespace, strip edge punctuation, keep 2-8 char
// words. Longest-first is arbitrary but deterministic — good enough for a
// stand-in until the real model picks meaningful words.
function extractCandidateWords(content: string): string[] {
  const seen = new Set<string>();
  for (const token of content.split(/\s+/)) {
    const word = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (word.length >= 2 && word.length <= 8) {
      seen.add(word);
    }
  }
  return [...seen].sort((a, b) => b.length - a.length);
}

// Pieces produced by split() are contiguous substrings of the content, and
// trimming only removes edge whitespace — so the pick stays verbatim, which
// the highlight renderer requires.
function pickHighlightSentence(content: string): string | null {
  const pieces = content
    .split(/[.!?…\n]+/)
    .map((piece) => piece.trim())
    // 10-80 chars: long enough to be a sentence, short enough that the
    // underline stays an accent instead of covering the whole diary.
    .filter((piece) => piece.length >= 10 && piece.length <= 80);
  if (pieces.length === 0) {
    return null;
  }
  return pieces.reduce((longest, piece) =>
    piece.length > longest.length ? piece : longest,
  );
}

async function analyzeWithMock(
  input: DiaryAnalysisInput,
): Promise<DiaryAnalysis> {
  // Simulated latency so the loading UI is actually exercised in dev.
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));

  const words = extractCandidateWords(input.content);
  const emotions = MOCK_EMOTION_RULES.filter((rule) =>
    rule.pattern.test(input.content),
  )
    .map((rule) => rule.emotion)
    .slice(0, 3);

  return {
    // No client-side vision here — fixed summer-themed placeholders.
    photoKeywords: ["여름", "추억"],
    diaryKeywords: words.slice(0, 4),
    emotions: emotions.length > 0 ? emotions : ["행복", "여유"],
    highlightWords: words.slice(0, 3),
    highlightSentence: pickHighlightSentence(input.content),
    comment: MOCK_COMMENTS[input.content.length % MOCK_COMMENTS.length],
  };
}
