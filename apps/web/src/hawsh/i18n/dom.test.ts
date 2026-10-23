import { afterEach, describe, expect, it } from "vitest";
import { startArabicUi } from "./dom";

const flush = () => new Promise((r) => setTimeout(r, 0));
let stop: (() => void) | null = null;

afterEach(() => {
  stop?.();
  stop = null;
  document.body.innerHTML = "";
});

describe("startArabicUi", () => {
  it("translates text and attributes already on the page", () => {
    document.body.innerHTML = `<button title="Undo" aria-label="Export options">Export</button><input placeholder="Search tracks" value="Export">`;
    stop = startArabicUi();
    const btn = document.querySelector("button")!;
    expect(btn.textContent).toBe("تصدير");
    expect(btn.getAttribute("title")).toBe("تراجع");
    expect(btn.getAttribute("aria-label")).toBe("خيارات التصدير");
    expect(btn.hasAttribute("data-ar")).toBe(true);
    const input = document.querySelector("input")!;
    expect(input.value).toBe("Export");
    expect(input.getAttribute("placeholder")).toBe("ابحث في المسارات");
    expect(document.documentElement.lang).toBe("ar");
  });

  it("keeps translating what is rendered later and skips marked content", async () => {
    stop = startArabicUi();
    const span = document.createElement("span");
    span.textContent = "Media";
    const own = document.createElement("div");
    own.setAttribute("data-no-translate", "");
    own.textContent = "Media";
    document.body.append(span, own);
    await flush();
    expect(span.textContent).toBe("الوسائط");
    expect(own.textContent).toBe("Media");

    span.firstChild!.nodeValue = "Play";
    await flush();
    expect(span.textContent).toBe("تشغيل");
  });

  it("does not touch typed text in contenteditable", async () => {
    stop = startArabicUi();
    const ed = document.createElement("div");
    ed.setAttribute("contenteditable", "true");
    ed.textContent = "Export";
    document.body.append(ed);
    await flush();
    expect(ed.textContent).toBe("Export");
  });
});
