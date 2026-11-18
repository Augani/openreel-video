import { afterEach, describe, expect, it, vi } from "vitest";
import { getResultUrl, type TaskRecord } from "./image-generation";
import { kieaiGet } from "./client";
vi.mock("./client", () => ({
  KIEAI_API_BASE_URL: "https://api.kie.ai",
  kieaiGet: vi.fn(),
  kieaiPostJson: vi.fn(),
}));
const record = (
  state: TaskRecord["state"],
  resultJson: TaskRecord["resultJson"] = null,
): TaskRecord => ({
  taskId: "task",
  model: "z-image",
  state,
  resultJson,
  createTime: "",
  updateTime: "",
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(kieaiGet).mockReset();
});
describe("existing provider result formats", () => {
  const url = "https://cdn.kie.ai/result.png";
  const arrays = ["resultUrls", "images"].map(
    (key) => ({ label: key, value: { [key]: [url] } }),
  );
  const strings = ["resultUrl", "image_url"].map((key) => ({ label: key, value: { [key]: url } }));
  const nested = ["result"].flatMap((wrapper) => [
    ...["url"].map((key) => ({
      label: `${wrapper}.${key}`,
      value: { [wrapper]: { [key]: url } },
    })),
    { label: `${wrapper}.urls`, value: { [wrapper]: { urls: [url] } } },
  ]);
  it.each([...arrays, ...strings, ...nested])(
    "retains $label extraction",
    ({ value }) => expect(getResultUrl(record("success", value))).toBe(url),
  );
  it("retains JSON-string results", () =>
    expect(
      getResultUrl(record("success", JSON.stringify({ resultUrls: [url] }))),
    ).toBe(url));
  it.each([null, "invalid json", {}])(
    "rejects an unusable result %j",
    (value) => expect(() => getResultUrl(record("success", value))).toThrow(),
  );
});
