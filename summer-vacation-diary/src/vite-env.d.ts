/// <reference types="vite/client" />

// Typed env vars: without this augmentation `import.meta.env.VITE_*` is `any`,
// which would let typos through the type checker silently.
interface ImportMetaEnv {
  /** OpenAI API key for stage 2 analysis. Absent → mock analysis mode. */
  readonly VITE_OPENAI_API_KEY?: string;
  /** Optional vision model override. Empty → gpt-4o-mini. */
  readonly VITE_OPENAI_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}
