/**
 * Applies the Arabic UI to the live page: text nodes and the title / aria-label / placeholder attributes,
 * now and whenever React renders more. Only the node value or attribute is replaced in place (no nodes
 * are added or moved), so React keeps working on the same nodes. Typed text (inputs, textareas,
 * contenteditable) and anything under [data-no-translate] is never touched.
 */
import { translateTextNode, translateUi } from "./translate";

const ATTRS = ["title", "aria-label", "placeholder"] as const;
const SKIP = "script, style, textarea, input, [contenteditable=''], [contenteditable='true'], [data-no-translate]";

function skipped(el: Element | null): boolean {
  return !el || !!el.closest(SKIP);
}

function translateText(node: Text): void {
  const parent = node.parentElement;
  if (skipped(parent)) return;
  const out = translateTextNode(node.nodeValue ?? "");
  if (out === null || out === node.nodeValue) return;
  node.nodeValue = out;
  parent!.setAttribute("data-ar", "");
}

function translateAttrs(el: Element): void {
  if (el.closest("[data-no-translate]")) return;
  for (const name of ATTRS) {
    const value = el.getAttribute(name);
    if (!value) continue;
    const out = translateUi(value);
    if (out !== null && out !== value) el.setAttribute(name, out);
  }
}

function translateTree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) return translateText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) {
    if ((root as Element).matches?.("[data-no-translate]")) return;
    translateAttrs(root as Element);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) translateText(n as Text);
    else translateAttrs(n as Element);
  }
}

let observer: MutationObserver | null = null;

/** Starts translating `root` (default: the whole document body) and keeps it translated. */
export function startArabicUi(root: HTMLElement = document.body): () => void {
  document.documentElement.lang = "ar";
  const title = translateUi(document.title);
  if (title) document.title = title;
  translateTree(root);
  observer?.disconnect();
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") translateText(r.target as Text);
      else if (r.type === "attributes") translateAttrs(r.target as Element);
      else r.addedNodes.forEach(translateTree);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  return () => { observer?.disconnect(); observer = null; };
}
