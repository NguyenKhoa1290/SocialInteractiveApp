import { useEffect, useRef, useState } from "react";

const MIN_WIDTH = 320;
const STORAGE_KEY = "meeting-chat-width";

export function MeetingChatResizeHandle() {
  const handleRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<(width: number) => void>(() => {});
  const dragRef = useRef<{ x: number; width: number } | null>(null);
  const [size, setSize] = useState({ width: MIN_WIDTH, max: MIN_WIDTH });

  useEffect(() => {
    const handle = handleRef.current!;
    const container = handle.parentElement!;
    let preferred = Math.min(440, Math.max(MIN_WIDTH, window.innerWidth * 0.27));
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(saved) && saved >= MIN_WIDTH) preferred = saved;
    } catch { /* Storage can be unavailable in private browsing. */ }
    const apply = () => {
      const gap = parseFloat(getComputedStyle(container).columnGap) || 0;
      // Leave at least 320px for the stage/grid, plus the handle and both gaps.
      const max = Math.max(MIN_WIDTH, container.clientWidth - MIN_WIDTH - handle.offsetWidth - gap * 2);
      const width = Math.min(max, Math.max(MIN_WIDTH, preferred));
      container.style.setProperty("--meeting-chat-width", `${width}px`);
      setSize({ width, max });
    };
    resizeRef.current = (width) => { preferred = width; apply(); };
    const observer = new ResizeObserver(apply);
    observer.observe(container);
    apply();
    return () => {
      observer.disconnect();
      container.style.removeProperty("--meeting-chat-width");
      container.classList.remove("mroom-chat-resizing");
      resizeRef.current = () => {};
    };
  }, []);

  function save(width: number) {
    try { localStorage.setItem(STORAGE_KEY, String(width)); } catch { /* Optional preference. */ }
  }

  return (
    <div
      ref={handleRef}
      className="mroom-chat-resizer"
      role="separator"
      tabIndex={0}
      aria-label="Điều chỉnh chiều rộng chat"
      aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={Math.round(size.max)}
      aria-valuenow={Math.round(size.width)}
      onPointerDown={(e) => {
        if (!e.isPrimary || e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { x: e.clientX, width: size.width };
        e.currentTarget.parentElement?.classList.add("mroom-chat-resizing");
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current;
        if (drag) resizeRef.current(Math.min(size.max, Math.max(MIN_WIDTH, drag.width + drag.x - e.clientX)));
      }}
      onPointerUp={(e) => {
        if (!dragRef.current) return;
        dragRef.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        e.currentTarget.parentElement?.classList.remove("mroom-chat-resizing");
        save(size.width);
      }}
      onLostPointerCapture={(e) => {
        dragRef.current = null;
        e.currentTarget.parentElement?.classList.remove("mroom-chat-resizing");
      }}
      onKeyDown={(e) => {
        let width = size.width;
        if (e.key === "ArrowLeft") width += e.shiftKey ? 50 : 20;
        else if (e.key === "ArrowRight") width -= e.shiftKey ? 50 : 20;
        else if (e.key === "Home") width = MIN_WIDTH;
        else if (e.key === "End") width = size.max;
        else return;
        e.preventDefault();
        width = Math.min(size.max, Math.max(MIN_WIDTH, width));
        resizeRef.current(width);
        save(width);
      }}
    />
  );
}
