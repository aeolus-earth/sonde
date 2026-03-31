import {
  useState,
  useRef,
  useCallback,
  type ReactNode,
  type ReactElement,
  cloneElement,
} from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: ReactNode;
  side?: "top" | "bottom";
  children: ReactElement;
}

export function Tooltip({ content, side = "top", children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const show = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      setPos({
        x: rect.left + rect.width / 2,
        y: side === "top" ? rect.top - 6 : rect.bottom + 6,
      });
      setVisible(true);
    }, 400);
  }, [side]);

  const hide = useCallback(() => {
    clearTimeout(timeoutRef.current);
    setVisible(false);
  }, []);

  return (
    <>
      {cloneElement(children, {
        ref,
        onMouseEnter: show,
        onMouseLeave: hide,
        onFocus: show,
        onBlur: hide,
      })}
      {visible &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[100] max-w-[280px] rounded-[5.5px] border border-border bg-surface-raised px-2 py-1 text-[11px] text-text-secondary shadow-lg"
            style={{
              left: pos.x,
              top: pos.y,
              transform:
                side === "top"
                  ? "translate(-50%, -100%)"
                  : "translate(-50%, 0)",
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
