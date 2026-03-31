import type { MentionRef } from "@/types/chat";
import type { RecordType } from "@/types/sonde";
import { mentionChipClasses } from "./mention-chip";

function mentionPlainLength(id: string): number {
  return `@${id} `.length;
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (node instanceof HTMLElement && node.dataset.mentionId) {
    const id = node.dataset.mentionId ?? "";
    return `@${id} `;
  }
  if (node instanceof HTMLBRElement) {
    return "\n";
  }
  if (
    node.nodeType === Node.ELEMENT_NODE ||
    node.nodeType === Node.DOCUMENT_FRAGMENT_NODE
  ) {
    let s = "";
    for (const c of Array.from(node.childNodes)) {
      s += serializeNode(c);
    }
    return s;
  }
  return "";
}

export function serializeComposer(root: HTMLElement): {
  text: string;
  mentions: MentionRef[];
} {
  const mentions: MentionRef[] = [];
  const text = serializeNode(root);
  function collect(node: Node) {
    if (node instanceof HTMLElement && node.dataset.mentionId) {
      const id = node.dataset.mentionId;
      const type = (node.dataset.mentionType ?? "experiment") as RecordType;
      const label = node.dataset.mentionLabel ?? id;
      const program = node.dataset.mentionProgram;
      mentions.push({
        id,
        type,
        label,
        program: program || undefined,
      });
      return;
    }
    for (const c of Array.from(node.childNodes)) {
      collect(c);
    }
  }
  for (const c of Array.from(root.childNodes)) {
    collect(c);
  }
  return { text, mentions };
}

export function getPlainLengthBeforeRangeEnd(
  root: HTMLElement,
  range: Range
): number {
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.endContainer, range.endOffset);
  return serializeNode(pre.cloneContents()).length;
}

type Boundary = { node: Node; offset: number };

function endBoundary(root: HTMLElement): Boundary {
  const last = root.lastChild;
  if (!last) {
    return { node: root, offset: 0 };
  }
  if (last.nodeType === Node.TEXT_NODE) {
    const t = last.textContent ?? "";
    return { node: last, offset: t.length };
  }
  return { node: root, offset: root.childNodes.length };
}

/**
 * Map a plain-text offset (same string as serializeComposer().text) to a DOM
 * boundary suitable for Range.setStart / setEnd.
 */
export function mapPlainOffsetToBoundary(
  root: HTMLElement,
  targetOffset: number
): Boundary {
  const total = serializeComposer(root).text.length;
  if (targetOffset <= 0) {
    const first = root.firstChild;
    if (!first) {
      return { node: root, offset: 0 };
    }
    if (first.nodeType === Node.TEXT_NODE) {
      return { node: first, offset: 0 };
    }
    return { node: root, offset: 0 };
  }
  if (targetOffset >= total) {
    return endBoundary(root);
  }

  let pos = 0;

  function walk(node: Node): Boundary | null {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? "";
      const len = t.length;
      if (pos + len >= targetOffset) {
        return { node, offset: targetOffset - pos };
      }
      pos += len;
      return null;
    }

    if (node instanceof HTMLElement && node.dataset.mentionId) {
      const id = node.dataset.mentionId;
      const chipLen = mentionPlainLength(id);
      if (targetOffset === pos) {
        const parent = node.parentNode;
        if (!parent) return null;
        return {
          node: parent,
          offset: [...parent.childNodes].indexOf(node),
        };
      }
      if (targetOffset < pos + chipLen) {
        const parent = node.parentNode;
        if (!parent) return null;
        return {
          node: parent,
          offset: [...parent.childNodes].indexOf(node),
        };
      }
      if (targetOffset === pos + chipLen) {
        const parent = node.parentNode;
        if (!parent) return null;
        return {
          node: parent,
          offset: [...parent.childNodes].indexOf(node) + 1,
        };
      }
      pos += chipLen;
      return null;
    }

    if (node instanceof HTMLBRElement) {
      if (pos + 1 >= targetOffset) {
        return { node, offset: 0 };
      }
      pos += 1;
      return null;
    }

    for (const c of Array.from(node.childNodes)) {
      const b = walk(c);
      if (b) return b;
    }
    return null;
  }

  for (const c of Array.from(root.childNodes)) {
    const b = walk(c);
    if (b) return b;
  }
  return endBoundary(root);
}

export function createRangeForPlainInterval(
  root: HTMLElement,
  start: number,
  end: number
): Range | null {
  if (start > end) return null;
  const a = mapPlainOffsetToBoundary(root, start);
  const b = mapPlainOffsetToBoundary(root, end);
  const r = document.createRange();
  try {
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    return r;
  } catch {
    return null;
  }
}

export function createMentionChipElement(ref: MentionRef): HTMLSpanElement {
  const span = document.createElement("span");
  span.contentEditable = "false";
  span.dataset.mentionId = ref.id;
  span.dataset.mentionType = ref.type;
  span.dataset.mentionLabel = ref.label;
  if (ref.program) {
    span.dataset.mentionProgram = ref.program;
  }
  span.className = `${mentionChipClasses(ref.type)} align-middle leading-tight`;
  span.setAttribute("spellcheck", "false");

  if (ref.type === "experiment" && ref.program) {
    const p = document.createElement("span");
    p.className = "shrink-0 text-[10px] font-sans text-white/85";
    p.textContent = `${ref.program}/`;
    const idEl = document.createElement("span");
    idEl.className =
      "min-w-0 truncate font-mono text-[11px] font-semibold tabular-nums tracking-tight text-white";
    idEl.textContent = ref.id;
    span.appendChild(p);
    span.appendChild(idEl);
  } else {
    const t = document.createElement("span");
    t.className =
      "font-mono text-[11px] font-semibold tabular-nums tracking-tight text-white";
    t.textContent = `@${ref.id}`;
    span.appendChild(t);
  }
  return span;
}

