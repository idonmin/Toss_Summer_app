import {
  Paragraph,
  SegmentedControl,
  TextArea,
  TextField,
} from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";

import {
  CONTENT_MAX_LENGTH,
  CONTENT_MIN_LENGTH,
  TITLE_MAX_LENGTH,
  WEATHER_OPTIONS,
} from "../constants/diary";
import type { WeatherValue } from "../constants/diary";
import type { DiaryDraft } from "../hooks/useDiaryDraft";

interface WriteStepProps {
  draft: DiaryDraft;
  onChange: (patch: Partial<DiaryDraft>) => void;
}

/**
 * Step 2: title, diary text, date and weather.
 * All fields write straight into the shared draft, so leaving this screen
 * (or the app) never loses input — the draft hook persists it.
 */
export function WriteStep({ draft, onChange }: WriteStepProps) {
  const contentLength = draft.content.length;
  // Validate on trimmed length so whitespace padding can't satisfy the
  // 20-char minimum; the visible counter still shows the raw length.
  const contentTooShort =
    contentLength > 0 && draft.content.trim().length < CONTENT_MIN_LENGTH;
  // A whitespace-only title also blocks the preview button (App.tsx trims it),
  // so surface the reason here instead of leaving the button silently disabled.
  const titleBlank = draft.title.length > 0 && draft.title.trim() === "";

  return (
    <div className="step-body">
      <TextField
        variant="line"
        label="제목"
        labelOption="sustain"
        placeholder="오늘의 제목을 지어주세요"
        maxLength={TITLE_MAX_LENGTH}
        value={draft.title}
        hasError={titleBlank}
        help={
          titleBlank
            ? "공백 말고 제목을 입력해 주세요"
            : // maxLength cuts input silently; explain the limit once it's hit.
              draft.title.length >= TITLE_MAX_LENGTH
              ? `제목은 ${TITLE_MAX_LENGTH}자까지 적을 수 있어요`
              : undefined
        }
        onChange={(event) => onChange({ title: event.target.value })}
      />

      <div className="field-row">
        <Paragraph typography="t7" color={adaptive.grey600}>
          날짜
        </Paragraph>
        {/* Native date input: the OS date picker on mobile beats any custom
            calendar for effort-to-quality, and TDS has no date picker widget. */}
        <input
          className="date-input"
          type="date"
          aria-label="일기 날짜"
          value={draft.date}
          onChange={(event) => {
            // Some browsers emit an empty string while the picker is being
            // cleared; keep the previous date instead of storing an invalid one.
            if (event.target.value !== "") {
              onChange({ date: event.target.value });
            }
          }}
        />
      </div>

      <div className="field-row field-row-column">
        <Paragraph typography="t7" color={adaptive.grey600}>
          날씨
        </Paragraph>
        {/* aria-label goes on the control itself so the name lands on the
            radiogroup element SegmentedControl renders, not on a wrapper. */}
        <SegmentedControl
          aria-label="날씨"
          alignment="fluid"
          value={draft.weather}
          onChange={(value) => onChange({ weather: value as WeatherValue })}
        >
          {WEATHER_OPTIONS.map((option) => (
            <SegmentedControl.Item key={option.value} value={option.value}>
              {option.label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </div>

      <TextArea
        variant="line"
        label="일기"
        labelOption="sustain"
        placeholder={`오늘의 이야기를 ${CONTENT_MIN_LENGTH}자 이상 적어주세요`}
        minHeight={180}
        maxLength={CONTENT_MAX_LENGTH}
        value={draft.content}
        hasError={contentTooShort}
        help={
          contentTooShort
            ? `${CONTENT_MIN_LENGTH}자 이상 적어주세요 (${contentLength}/${CONTENT_MAX_LENGTH})`
            : `${contentLength}/${CONTENT_MAX_LENGTH}`
        }
        onChange={(event) => onChange({ content: event.target.value })}
      />
    </div>
  );
}
