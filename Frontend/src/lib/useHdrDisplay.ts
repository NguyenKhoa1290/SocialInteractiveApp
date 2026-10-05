import { useSyncExternalStore } from "react";

const VIDEO_HIGH = "(video-dynamic-range: high)";
const VIDEO_STANDARD = "(video-dynamic-range: standard)";
const DISPLAY_HIGH = "(dynamic-range: high)";

function readHdrCapability(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;

  // Prefer the video plane when supported; graphics and video can have
  // different capabilities. `standard` also matches HDR-capable displays.
  if (window.matchMedia(VIDEO_STANDARD).matches) {
    return window.matchMedia(VIDEO_HIGH).matches;
  }
  return window.matchMedia(DISPLAY_HIGH).matches;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};

  const queries = [VIDEO_HIGH, VIDEO_STANDARD, DISPLAY_HIGH].map((query) => window.matchMedia(query));
  for (const query of queries) query.addEventListener("change", onChange);
  return () => {
    for (const query of queries) query.removeEventListener("change", onChange);
  };
}

// Reports capability, not whether OS HDR is active or the stream is HDR.
// https://www.w3.org/TR/mediaqueries-5/#dynamic-range
export function useHdrDisplay(): boolean {
  return useSyncExternalStore(subscribe, readHdrCapability, () => false);
}
