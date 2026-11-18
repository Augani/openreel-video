import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATES } from "@openreel/core";
import { TemplateThumb, bundledTemplateThumbnailUrl } from "./TemplateThumb";
import { templateFrameRect } from "./template-thumbnail";
import { CategoryTabs } from "./CategoryTabs";

afterEach(cleanup);

describe("bundledTemplateThumbnailUrl", () => {
  it("points every built-in template at its committed render", () => {
    for (const template of BUILTIN_TEMPLATES) {
      expect(bundledTemplateThumbnailUrl(template.id)).toMatch(new RegExp(`template-thumbs/${template.id}\\.webp$`));
    }
    expect(bundledTemplateThumbnailUrl("local-1")).toBeNull();
  });
});

describe("TemplateThumb", () => {
  it("shows the built-in render as a full-bleed image, never an icon on a gradient", () => {
    const { container } = render(
      <div className="aspect-video w-40">
        <TemplateThumb template={{ id: "builtin-quote-card", name: "Quote Card", thumbnailUrl: null }} alt="Quote Card" eager />
      </div>,
    );
    const image = screen.getByAltText("Quote Card");
    expect(image.getAttribute("src")).toContain("template-thumbs/builtin-quote-card.webp");
    expect(image.className).toContain("object-cover");
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("[class*='bg-gradient']")).toBeNull();
  });

  it("prefers a template's own thumbnail", () => {
    render(<TemplateThumb template={{ id: "builtin-quote-card", name: "Q", thumbnailUrl: "data:image/png;base64,AAAA" }} alt="own" eager />);
    expect(screen.getByAltText("own").getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });
});

describe("templateFrameRect", () => {
  it("fills the thumbnail for 16:9 templates and pillarboxes vertical ones at their own aspect", () => {
    expect(templateFrameRect({ width: 1920, height: 1080 })).toEqual({ x: 0, y: 0, width: 640, height: 360 });
    const vertical = templateFrameRect({ width: 1080, height: 1920 });
    expect(vertical.height).toBe(360);
    expect(vertical.width).toBe(Math.round(360 * (1080 / 1920)));
    expect(vertical.x).toBe(Math.round((640 - vertical.width) / 2));
  });

  it("letterboxes wide templates", () => {
    const wide = templateFrameRect({ width: 2400, height: 1000 });
    expect(wide.width).toBe(640);
    expect(wide.y).toBeGreaterThan(0);
  });
});

describe("CategoryTabs", () => {
  it("offers only platforms that have templates", () => {
    render(
      <CategoryTabs
        selectedCategory="all"
        onSelectCategory={() => undefined}
        categoryStats={{ all: 3, tiktok: 2, "youtube-video": 1 }}
      />,
    );
    expect(screen.getByRole("tab", { name: /TikTok/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /YouTube/ })).toBeTruthy();
    for (const empty of ["Facebook", "Twitter/X", "LinkedIn", "Pinterest"]) {
      expect(screen.queryByRole("tab", { name: new RegExp(empty) }), empty).toBeNull();
    }
  });
});
