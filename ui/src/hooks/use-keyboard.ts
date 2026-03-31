import { useEffect, useState } from "react";

/**
 * Register a global keyboard shortcut.
 * Ignores events when an input/textarea/select is focused.
 */
export function useHotkey(
  key: string,
  handler: () => void,
  options?: { meta?: boolean }
) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;

      // / key should only fire when not in an input
      if (key === "/" && isInput) return;

      const metaMatch = options?.meta
        ? e.metaKey || e.ctrlKey
        : !e.metaKey && !e.ctrlKey;

      if (e.key.toLowerCase() === key.toLowerCase() && metaMatch) {
        e.preventDefault();
        handler();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [key, handler, options?.meta]);
}

/**
 * j/k/Enter/Escape keyboard navigation for lists.
 * Returns the focused index and an onKeyDown handler.
 */
export function useListKeyboardNav<T>(
  items: T[],
  onSelect: (item: T) => void,
  onEscape?: () => void
) {
  const [focusedIndex, setFocusedIndex] = useState(-1);

  // Reset focus when items change
  useEffect(() => {
    setFocusedIndex(-1);
  }, [items.length]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (isInput) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && focusedIndex >= 0) {
        e.preventDefault();
        onSelect(items[focusedIndex]);
      } else if (e.key === "Escape") {
        if (focusedIndex >= 0) {
          setFocusedIndex(-1);
        } else {
          onEscape?.();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [items, focusedIndex, onSelect, onEscape]);

  return { focusedIndex, setFocusedIndex };
}
