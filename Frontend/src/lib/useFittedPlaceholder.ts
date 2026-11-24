import { useEffect, type RefObject } from "react";

// Fit only the hint to the available text area. Typed messages retain their
// normal font size and can still span multiple lines.
export function useFittedPlaceholder(ref: RefObject<HTMLTextAreaElement | null>) {
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    let active = true;
    const context = document.createElement("canvas").getContext("2d");
    const fit = () => {
      if (!active || !context) return;
      const style = getComputedStyle(input);
      const available = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2;
      if (available <= 0) return;
      const size = parseFloat(style.fontSize);
      context.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
      const width = context.measureText(input.placeholder).width;
      input.style.setProperty("--placeholder-size", `${Math.min(size, size * available / Math.max(1, width))}px`);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(input);
    fit();
    void document.fonts.ready.then(fit);
    return () => { active = false; observer.disconnect(); };
  });
}
