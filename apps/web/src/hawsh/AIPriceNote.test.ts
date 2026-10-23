import { describe, expect, it } from "vitest";
import { priceNote } from "./AIPriceNote";
import { translateUi } from "./i18n/translate";

describe("priceNote", () => {
  it("shows the price per step without float noise", () => {
    expect(priceNote(0.1)).toMatch(/^0\.1 نقطة لكل خطوة/);
    expect(priceNote(0.30000000000000004)).toMatch(/^0\.3 نقطة/);
  });
});

describe("chat composer placeholder", () => {
  it("is translated with the ellipsis character the composer uses", () => {
    expect(translateUi("Ask the AI to edit your video…")).toBe("اطلب من الذكاء الاصطناعي تعديل الفيديو…");
  });
});
