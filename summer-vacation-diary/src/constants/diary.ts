// Central place for product rules from the planning doc (AI_weekly_picture_diary_2.md),
// so screens and validation never drift apart when a rule changes.

export const WEATHER_OPTIONS = [
  { value: "sunny", label: "☀️ 맑음" },
  { value: "partly-cloudy", label: "⛅ 구름 조금" },
  { value: "cloudy", label: "☁️ 흐림" },
  { value: "rainy", label: "🌧️ 비" },
  { value: "stormy", label: "⛈️ 천둥번개" },
] as const;

export type WeatherValue = (typeof WEATHER_OPTIONS)[number]["value"];

export function weatherLabel(value: WeatherValue): string {
  return (
    WEATHER_OPTIONS.find((option) => option.value === value)?.label ??
    WEATHER_OPTIONS[0].label
  );
}

export const TITLE_MAX_LENGTH = 30;
export const CONTENT_MIN_LENGTH = 20;
export const CONTENT_MAX_LENGTH = 500;

// Upload rules from the spec: JPG/JPEG/PNG/WEBP, max 10MB, reject tiny images.
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;
export const MIN_IMAGE_DIMENSION_PX = 200;

// Versioned key so a future draft-shape change can just bump the suffix
// instead of writing migration code for old localStorage data.
export const DRAFT_STORAGE_KEY = "summer-vacation-diary:draft:v1";
