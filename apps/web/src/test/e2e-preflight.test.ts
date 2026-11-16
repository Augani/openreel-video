import { expect, it } from "vitest";
import { preflightBrowser } from "../../e2e/browser-preflight";

it("retries once then succeeds", async () => {
  let calls = 0;
  await preflightBrowser("chrome", async () => {
    calls += 1;
    if (calls === 1) throw new Error("Timeout 45000ms exceeded\nstack");
    return { close: async () => undefined };
  }, 5);
  expect(calls).toBe(2);
});
it("fails with a clear error after two attempts", async () => {
  let calls = 0;
  await expect(
    preflightBrowser("chrome", async () => {
      calls += 1;
      throw new Error("Timeout 45000ms exceeded\nstack");
    }, 5),
  ).rejects.toThrow(/after 2 attempts.*Timeout 45000ms exceeded.*overloaded/s);
  expect(calls).toBe(2);
});
