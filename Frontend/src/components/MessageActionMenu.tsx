import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./message-action-menu.css";

export type MessageAction = {
  id: string;
  label: string;
  tone?: "default" | "danger";
  onSelect: () => void;
};

type MenuPosition = { top: number; left: number };

// Menu thao tac thu gon dung chung cho chat ca nhan, nhom va thao luan hop.
// Popup duoc render vao body de khong bi cat boi vung lich su tin nhan dang
// cuon (overflow-y: auto), dac biet tren man hinh dien thoai.
export function MessageActionMenu({
  actions,
  open,
  onOpenChange,
  align = "start",
}: {
  actions: MessageAction[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  align?: "start" | "end";
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  useEffect(() => {
    if (!open) return;

    function closeWhenOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      onOpenChange(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }

    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onOpenChange, open]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    function updatePosition() {
      const trigger = triggerRef.current;
      const popup = popupRef.current;
      if (!trigger || !popup) return;

      const triggerRect = trigger.getBoundingClientRect();
      const popupRect = popup.getBoundingClientRect();
      const gap = 8;
      const margin = 8;
      const leftBeforeClamp = align === "end" ? triggerRect.right - popupRect.width : triggerRect.left;
      const left = Math.max(margin, Math.min(leftBeforeClamp, window.innerWidth - popupRect.width - margin));
      const topAbove = triggerRect.top - popupRect.height - gap;
      const top = topAbove >= margin ? topAbove : Math.min(window.innerHeight - popupRect.height - margin, triggerRect.bottom + gap);
      setPosition({ top, left });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    // `scroll` khong noi bot tu cac khung lich su, nen bat o pha capture.
    document.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, open]);

  return (
    <div className={`message-action-menu${open ? " is-open" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="message-action-trigger"
        aria-label="Thao tác tin nhắn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={popupRef}
            className="message-action-popover"
            role="menu"
            aria-label="Thao tác tin nhắn"
            style={position ? { top: position.top, left: position.left } : { visibility: "hidden" }}
          >
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className={`message-action-item${action.tone === "danger" ? " is-danger" : ""}`}
                onClick={() => {
                  action.onSelect();
                  onOpenChange(false);
                }}
              >
                {action.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
