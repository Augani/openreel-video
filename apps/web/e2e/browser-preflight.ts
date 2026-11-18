// Kept free of Playwright imports so Vitest can unit-test it without pulling Electron's global DOM typings.
/**
 * Fail fast (but not on the first hiccup) when the browser cannot be started. A
 * Chrome that is spawned but never completes the DevTools pipe handshake otherwise
 * costs the default 180s launch timeout in every test. Under machine load a single
 * launch can miss the window, so retry once after a backoff before giving up.
 */
export async function preflightBrowser(
  channel: string,
  launch: () => Promise<{ close(): Promise<void> }>,
  backoffMs = 10_000,
): Promise<void> {
  const attempts = 2;
  let lastMessage = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const browser = await launch();
      await browser.close();
      return;
    } catch (err) {
      lastMessage = (err as Error).message.split("\n")[0];
      if (attempt < attempts) await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw new Error(
    `Could not launch the "${channel}" browser within 45s after ${attempts} attempts, so no e2e test can run: ${lastMessage}. ` +
      "The machine may be overloaded (other Chrome/Electron/test runs): wait and retry, or set OPENREEL_E2E_CHANNEL=chromium after `playwright install chromium` to use the bundled browser.",
  );
}
