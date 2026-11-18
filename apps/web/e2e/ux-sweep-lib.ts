import type { Page } from "@playwright/test";

/**
 * Layout audit run inside the page: everything a person would trip over that a
 * screenshot cannot count. Returns plain data so a spec can assert on it and a
 * report can print it.
 *
 *  - unlabeled: visible buttons / links / inputs with no accessible name (icon-only buttons without aria-label)
 *  - offscreen: visible controls that are not inside a scroll container and extend past the viewport
 *  - clippedText: visible text whose own box is narrower than its content with no ellipsis (cut off mid-word)
 *  - overlaps: pairs of visible controls whose boxes overlap by more than a quarter of the smaller one
 *  - noFocusRing: (optional) controls whose focus makes no visible difference
 */
export interface AuditFinding { kind: string; target: string; detail: string }

export async function auditLayout(page: Page, options: { focus?: boolean; scope?: string } = {}): Promise<AuditFinding[]> {
  return page.evaluate(async ({ focus, scope }) => {
    const out: Array<{ kind: string; target: string; detail: string }> = [];
    const root: ParentNode = scope ? (document.querySelector(scope) ?? document) : document;
    const vw = window.innerWidth, vh = window.innerHeight;
    const describe = (el: Element): string => {
      const label = el.getAttribute("aria-label") || el.getAttribute("data-testid") || (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
      const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls ? `.${cls}` : ""}[${label}]`;
    };
    const visible = (el: Element): boolean => {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      for (let node: Element | null = el; node; node = node.parentElement) {
        if (node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true") return false;
        const s = getComputedStyle(node);
        if (s.display === "none" || s.visibility === "hidden") return false;
      }
      return true;
    };
    // The part of a box that is really on screen: clipped by scrolling / overflow ancestors and the viewport.
    const visibleRect = (el: Element): { left: number; top: number; right: number; bottom: number } | null => {
      const r = el.getBoundingClientRect();
      let box = { left: Math.max(0, r.left), top: Math.max(0, r.top), right: Math.min(vw, r.right), bottom: Math.min(vh, r.bottom) };
      for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        const s = getComputedStyle(node);
        if (!/(auto|scroll|hidden|clip)/.test(s.overflowX + s.overflowY)) continue;
        const c = node.getBoundingClientRect();
        box = { left: Math.max(box.left, c.left), top: Math.max(box.top, c.top), right: Math.min(box.right, c.right), bottom: Math.min(box.bottom, c.bottom) };
      }
      return box.right - box.left > 2 && box.bottom - box.top > 2 ? box : null;
    };
    // Reachable: the topmost thing at a point inside the visible part is the control (or part of it), so it is not behind a dialog or scrolled away.
    const reachable = (el: Element): boolean => {
      const v = visibleRect(el);
      if (!v) return false;
      const top = document.elementFromPoint((v.left + v.right) / 2, (v.top + v.bottom) / 2);
      return !!top && (el.contains(top) || top.contains(el));
    };
    const controls = Array.from(root.querySelectorAll<HTMLElement>("button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=combobox], [role=slider], [role=menuitem], [role=switch], [role=checkbox], [role=radio]")).filter((el) => visible(el) && reachable(el));
    const nameOf = (el: HTMLElement): string => {
      const direct = el.getAttribute("aria-label") || el.getAttribute("title") || "";
      if (direct.trim()) return direct;
      const by = el.getAttribute("aria-labelledby");
      if (by && by.split(/\s+/).some((id) => (document.getElementById(id)?.textContent ?? "").trim())) return "labelled";
      if ((el.textContent ?? "").trim()) return el.textContent!.trim();
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        if (el.labels && Array.from(el.labels).some((l) => (l.textContent ?? "").trim())) return "labelled";
        if ((el as HTMLInputElement).placeholder) return (el as HTMLInputElement).placeholder;
      }
      const img = el.querySelector("img[alt]");
      if (img && img.getAttribute("alt")?.trim()) return "img";
      return "";
    };
    // Scroll/clip ancestors that actually hide overflow.
    const clippers = (el: Element): DOMRect[] => {
      const rects: DOMRect[] = [];
      for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        const s = getComputedStyle(node);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX + s.overflowY)) rects.push(node.getBoundingClientRect());
      }
      return rects;
    };
    for (const el of controls) {
      if (!nameOf(el)) out.push({ kind: "unlabeled", target: describe(el), detail: "no accessible name" });
      const rect = el.getBoundingClientRect();
      const hidden = clippers(el);
      const clipped = hidden.some((c) => rect.right > c.right + 1 || rect.left < c.left - 1 || rect.bottom > c.bottom + 1 || rect.top < c.top - 1);
      const outside = rect.right > vw + 1 || rect.bottom > vh + 1 || rect.left < -1 || rect.top < -1;
      if (outside && !clipped) out.push({ kind: "offscreen", target: describe(el), detail: `rect ${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)} in ${vw}x${vh}` });
    }
    // Text cut off without an ellipsis.
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("button, label, span, p, h1, h2, h3, h4, [role=tab], [role=option]"))) {
      if (!el.childNodes.length || !Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim())) continue;
      if (!visible(el)) continue;
      const s = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 2 && /(hidden|clip)/.test(s.overflowX) && s.textOverflow !== "ellipsis" && el.clientWidth > 0) {
        out.push({ kind: "clippedText", target: describe(el), detail: `content ${el.scrollWidth}px in ${el.clientWidth}px` });
      }
    }
    // Overlapping controls.
    const area = (r: DOMRect) => r.width * r.height;
    for (let i = 0; i < controls.length; i++) {
      for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i], b = controls[j];
        if (a.contains(b) || b.contains(a)) continue;
        const va = visibleRect(a), vb = visibleRect(b);
        if (!va || !vb) continue;
        const ra = { width: va.right - va.left, height: va.bottom - va.top }, rb = { width: vb.right - vb.left, height: vb.bottom - vb.top };
        const w = Math.min(va.right, vb.right) - Math.max(va.left, vb.left), h = Math.min(va.bottom, vb.bottom) - Math.max(va.top, vb.top);
        if (w <= 2 || h <= 2) continue;
        if (w * h > 0.25 * Math.min(area(ra as DOMRect), area(rb as DOMRect))) {
          // Resize handles and the like sit on an edge by design.
          if (a.hasAttribute("data-resize-handle") || b.hasAttribute("data-resize-handle")) continue;
          // One of them hidden behind a clipper the other is not inside is not a real overlap.
          out.push({ kind: "overlap", target: `${describe(a)} <> ${describe(b)}`, detail: `${Math.round(w)}x${Math.round(h)} px shared` });
        }
      }
    }
    if (focus) {
      for (const el of controls.slice(0, 60)) {
        if (el.matches(":disabled") || el.getAttribute("tabindex") === "-1") continue;
        const read = () => { const s = getComputedStyle(el); return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.backgroundColor, s.color, s.textDecorationLine].join("|"); };
        // A control that already has focus (a dialog focuses its first button) is measured unfocused first.
        if (document.activeElement === el) { el.blur(); await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); }
        const before = read();
        try { (el as HTMLElement & { focus(o?: { focusVisible?: boolean }): void }).focus({ focusVisible: true }); } catch { el.focus(); }
        if (document.activeElement !== el) continue;
        // Let the control's own focus handlers (draft state, validation) settle before it is blurred again.
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const after = read();
        const ringless = /^none\|/.test(after.split("|").slice(0, 1).join("|") + "|") && before === after;
        if (ringless) out.push({ kind: "noFocusRing", target: describe(el), detail: "focus changes nothing visible" });
        el.blur();
      }
    }
    return out;
  }, { focus: options.focus ?? false, scope: options.scope ?? null });
}
