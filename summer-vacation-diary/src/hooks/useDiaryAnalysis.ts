import { useCallback, useEffect, useRef, useState } from "react";

import { analyzeDiary, analysisErrorMessage } from "../services/diaryAnalysis";
import type { DiaryAnalysis } from "../services/diaryAnalysis";
import type { DiaryDraft } from "./useDiaryDraft";

export type AnalysisState =
  | { status: "loading" }
  | { status: "success"; analysis: DiaryAnalysis }
  | { status: "error"; message: string };

// Internal state remembers which input produced it, so a result computed for
// an older draft is never shown against newer content — not even for the one
// frame before the effect resets to loading.
type InternalState =
  | { status: "loading" }
  | { status: "success"; analysis: DiaryAnalysis; signature: string }
  | { status: "error"; message: string; signature: string };

interface PendingRequest {
  signature: string;
  promise: Promise<DiaryAnalysis>;
}

// Keep the last few results, not just one: reverting an edit (A -> B -> back
// to A) is common, and each entry is small next to the photo it already keyed.
const CACHE_MAX_ENTRIES = 3;

/**
 * Runs the diary analysis while `active` is true (i.e. the preview step is
 * showing). Successful results are cached by input signature and an in-flight
 * request for the same input is reused, so toggling 수정하기 ↔ 미리보기
 * without edits never spends a second API call.
 */
export function useDiaryAnalysis(draft: DiaryDraft, active: boolean) {
  const [internalState, setInternalState] = useState<InternalState>({
    status: "loading",
  });
  // Bumping this forces the effect to re-run for the same inputs (retry).
  const [attempt, setAttempt] = useState(0);
  const cacheRef = useRef(new Map<string, DiaryAnalysis>());
  const pendingRef = useRef<PendingRequest | null>(null);
  const requestIdRef = useRef(0);

  // `date` is excluded on purpose: it doesn't change the AI input, so editing
  // it must not re-trigger a request.
  const { photoDataUrl, title, content, weather } = draft;
  // JSON.stringify gives an unambiguous key without inventing a separator
  // that user text could theoretically contain.
  const signature = JSON.stringify([photoDataUrl, title, content, weather]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const cached = cacheRef.current.get(signature);
    if (cached !== undefined) {
      // Invalidate any in-flight request for an abandoned input: without this
      // bump, its late result could overwrite the cached one on screen.
      requestIdRef.current += 1;
      setInternalState({ status: "success", analysis: cached, signature });
      return;
    }

    // Stale-response guard: only the newest effect run may commit state.
    const requestId = ++requestIdRef.current;
    setInternalState({ status: "loading" });

    // Reuse the in-flight request when the input hasn't changed (the user
    // toggled 수정하기 ↔ 미리보기 mid-analysis) instead of firing — and
    // paying for — a duplicate API call.
    let pending = pendingRef.current;
    if (pending === null || pending.signature !== signature) {
      pending = {
        signature,
        promise: analyzeDiary({ photoDataUrl, title, content, weather }),
      };
      pendingRef.current = pending;
    }
    const request = pending;

    request.promise
      .then((analysis) => {
        if (pendingRef.current === request) {
          pendingRef.current = null;
        }
        // The result is valid for the input that produced it, so cache it even
        // if a newer request superseded this one — the user may revert.
        cacheRef.current.set(request.signature, analysis);
        if (cacheRef.current.size > CACHE_MAX_ENTRIES) {
          const oldestKey = cacheRef.current.keys().next().value;
          if (oldestKey !== undefined) {
            cacheRef.current.delete(oldestKey);
          }
        }
        if (requestId !== requestIdRef.current) {
          return;
        }
        setInternalState({
          status: "success",
          analysis,
          signature: request.signature,
        });
      })
      .catch((error: unknown) => {
        if (pendingRef.current === request) {
          pendingRef.current = null;
        }
        if (requestId !== requestIdRef.current) {
          return;
        }
        setInternalState({
          status: "error",
          message: analysisErrorMessage(error),
          signature: request.signature,
        });
      });
  }, [active, attempt, photoDataUrl, title, content, weather, signature]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  // A result produced by a different input is masked as loading — the effect
  // that replaces it is already scheduled for this same render.
  const state: AnalysisState =
    internalState.status !== "loading" && internalState.signature !== signature
      ? { status: "loading" }
      : internalState;

  return { state, retry };
}
