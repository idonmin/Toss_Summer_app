import { useCallback, useEffect, useRef, useState } from "react";

import {
  isSketchErrorRetryable,
  sketchErrorMessage,
  transferPhotoToSketch,
} from "../services/styleTransfer";
import type { DiaryDraft } from "./useDiaryDraft";

export type SketchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; sketchDataUrl: string }
  | {
      status: "error";
      message: string;
      /** false when retrying the same photo can never succeed (moderation). */
      retryable: boolean;
    };

interface PendingRequest {
  /** The photo data URL this request was started for. */
  source: string;
  promise: Promise<string>;
}

// Sketches are ~200-400KB each, so the in-memory cache stays small. It only
// covers "picked photo A, tried B, went back to A" within one session —
// across sessions the draft's persisted sketchDataUrl is the cache.
const CACHE_MAX_ENTRIES = 2;

/**
 * Runs the stage-3 photo → drawing conversion while `active` is true.
 *
 * The conversion starts the moment the user leaves the upload step (a
 * commitment signal — no API spend for abandoned photos) and runs while they
 * write, so the 30-60s the image model needs is hidden behind typing time.
 * The finished sketch is written INTO the draft, which both persists it and
 * makes "photo changed → sketch cleared" a single-source-of-truth rule that
 * App.tsx enforces at the moment the photo changes.
 */
export function useSketch(
  draft: Pick<DiaryDraft, "photoDataUrl" | "sketchDataUrl">,
  updateDraft: (patch: Partial<DiaryDraft>) => void,
  active: boolean,
) {
  const { photoDataUrl, sketchDataUrl } = draft;

  // Errors remember which photo they belong to, so an error for an abandoned
  // photo is never shown against a newly picked one.
  const [error, setError] = useState<{
    source: string;
    message: string;
    retryable: boolean;
  } | null>(null);
  // Bumping this re-runs the effect for the same inputs (explicit retry).
  const [attempt, setAttempt] = useState(0);
  const cacheRef = useRef(new Map<string, string>());
  const pendingRef = useRef<PendingRequest | null>(null);
  const requestIdRef = useRef(0);

  // The resolve handlers below need the CURRENT photo, not the one captured
  // when the request started — a ref avoids re-subscribing them on each edit.
  const photoRef = useRef(photoDataUrl);
  useEffect(() => {
    photoRef.current = photoDataUrl;
  }, [photoDataUrl]);

  useEffect(() => {
    if (!active || photoDataUrl === null || sketchDataUrl !== null) {
      return;
    }
    // A failed conversion must NOT auto-retry on step navigation — each
    // attempt costs an API call, so only the explicit retry button (which
    // clears `error` and bumps `attempt`) may fire again.
    if (error !== null && error.source === photoDataUrl) {
      return;
    }

    const cached = cacheRef.current.get(photoDataUrl);
    if (cached !== undefined) {
      // Invalidate any in-flight request for an abandoned photo: without this
      // bump, its late result could race with the cached one being committed.
      requestIdRef.current += 1;
      updateDraft({ sketchDataUrl: cached });
      return;
    }

    // Stale-response guard: only the newest effect run may commit state.
    const requestId = ++requestIdRef.current;

    // Reuse the in-flight request when the photo hasn't changed (the user
    // navigated back and forth mid-conversion) instead of paying twice.
    let pending = pendingRef.current;
    if (pending === null || pending.source !== photoDataUrl) {
      pending = {
        source: photoDataUrl,
        promise: transferPhotoToSketch(photoDataUrl),
      };
      pendingRef.current = pending;
    }
    const request = pending;

    request.promise
      .then((sketch) => {
        if (pendingRef.current === request) {
          pendingRef.current = null;
        }
        // The sketch is valid for the photo that produced it, so cache it
        // even if superseded — the user may revert to that photo.
        cacheRef.current.set(request.source, sketch);
        if (cacheRef.current.size > CACHE_MAX_ENTRIES) {
          const oldestKey = cacheRef.current.keys().next().value;
          if (oldestKey !== undefined) {
            cacheRef.current.delete(oldestKey);
          }
        }
        // Two guards: the photo must still be the one this sketch was drawn
        // from (photo swaps don't bump requestId while on the upload step,
        // where this effect is inactive), and no newer run may be superseded.
        if (photoRef.current !== request.source) {
          return;
        }
        if (requestId !== requestIdRef.current) {
          return;
        }
        updateDraft({ sketchDataUrl: sketch });
      })
      .catch((cause: unknown) => {
        if (pendingRef.current === request) {
          pendingRef.current = null;
        }
        if (photoRef.current !== request.source) {
          return;
        }
        if (requestId !== requestIdRef.current) {
          return;
        }
        setError({
          source: request.source,
          message: sketchErrorMessage(cause),
          retryable: isSketchErrorRetryable(cause),
        });
      });
  }, [active, attempt, error, photoDataUrl, sketchDataUrl, updateDraft]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((count) => count + 1);
  }, []);

  let state: SketchState;
  if (photoDataUrl === null) {
    state = { status: "idle" };
  } else if (sketchDataUrl !== null) {
    state = { status: "success", sketchDataUrl };
  } else if (error !== null && error.source === photoDataUrl) {
    state = {
      status: "error",
      message: error.message,
      retryable: error.retryable,
    };
  } else if (active) {
    state = { status: "loading" };
  } else {
    state = { status: "idle" };
  }

  return { state, retry };
}
