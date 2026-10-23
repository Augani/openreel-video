import { describe, expect, it } from "vitest";
import { translateTextNode, translateUi } from "./translate";

describe("translateUi", () => {
  it("translates known UI strings exactly", () => {
    expect(translateUi("Export")).toBe("تصدير");
    expect(translateUi("  Media ")).toBe("الوسائط");
  });
  it("leaves unknown text, user content and non-Latin text alone", () => {
    expect(translateUi("UP 10 S13.mp4")).toBeNull();
    expect(translateUi("Poppins")).toBeNull();
    expect(translateUi("00:00:05:00")).toBeNull();
    expect(translateUi("تصدير")).toBeNull();
    expect(translateUi("")).toBeNull();
  });
  it("translates strings built from parts only when every part is known", () => {
    expect(translateUi("Open Crop")).toBe("فتح اقتصاص");
    expect(translateUi("Expand Keyframes section")).toBe("توسيع قسم الإطارات المفتاحية");
    expect(translateUi("Add Grinning Face")).toBe("إضافة وجه مبتسم");
    expect(translateUi("Add Purple Unicorn")).toBeNull();
    expect(translateUi("5 minutes ago")).toBe("قبل 5 دقائق");
    expect(translateUi("2 hours ago")).toBe("قبل ساعتين");
    expect(translateUi("12 days ago")).toBe("قبل 12 يوم");
    expect(translateUi("Rename Track 2")).toBe("إعادة تسمية المسار 2");
    expect(translateUi("3 selected")).toBe("3 محدد");
    expect(translateUi("Sepia. Drag onto a clip to apply, or double-click to apply to selected clip.")).toMatch(/^بني قديم\. اسحبه/);
  });
});

describe("translateTextNode", () => {
  it("keeps the whitespace around the text", () => {
    expect(translateTextNode(" Export ")).toBe(" تصدير ");
    expect(translateTextNode("Poppins")).toBeNull();
  });
});
