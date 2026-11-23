import { protocol, net } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cacheControlFor, contentTypeFor, resolveAppPath } from "./protocol-paths";

const SCHEME = "app";
/**
 * Serves one tiny page that only constructs an AudioContext. The preload embeds it in a hidden
 * iframe (preload/audio-warm-frame.ts): because the scheme differs from `app`, Chromium puts it in its
 * own renderer process, which absorbs the first-use audio device discovery (50-160 ms) so the editor's
 * own `new AudioContext()` later takes ~25 ms. See apps/desktop/PERF.md, "Cold start round 3".
 */
export const AUDIO_WARM_SCHEME = "openreel-warm";
export const AUDIO_WARM_URL = `${AUDIO_WARM_SCHEME}://audio/warm.html`;
export const AUDIO_WARM_PAGE =
  '<!doctype html><meta charset="utf-8"><title></title><script>try{new AudioContext()}catch(e){}</script>';

export const AUDIO_WARM_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  // The embedding page is cross-origin isolated (COEP require-corp): the frame has to opt in.
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'",
};

export function registerAppSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: AUDIO_WARM_SCHEME, privileges: { standard: true, secure: true } },
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        codeCache: true,
      },
    },
  ]);
}

export function handleAudioWarmScheme(): void {
  protocol.handle(AUDIO_WARM_SCHEME, () => new Response(AUDIO_WARM_PAGE, { headers: AUDIO_WARM_HEADERS }));
}

export function handleAppScheme(rendererRoot: string): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    const target = resolveAppPath(rendererRoot, url.pathname);
    if (target.kind === "bad-request") return new Response("Bad Request", { status: 400 });
    if (target.kind === "forbidden") return new Response("Forbidden", { status: 403 });

    let pathname = target.pathname;
    const range = request.headers.get("range");
    const fetchInit = range ? { headers: { range } } : undefined;

    let response: Response;
    try {
      response = await net.fetch(pathToFileURL(target.resolved).toString(), fetchInit);
    } catch {
      if (!target.spaFallback) return new Response("Not Found", { status: 404 });
      pathname = "/index.html";
      response = await net.fetch(pathToFileURL(path.join(rendererRoot, "index.html")).toString());
    }

    const headers = new Headers(response.headers);
    const contentType = contentTypeFor(pathname);
    if (contentType) headers.set("Content-Type", contentType);
    const cacheControl = cacheControlFor(pathname);
    if (cacheControl) headers.set("Cache-Control", cacheControl);
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
}

const APP_ORIGIN = `${SCHEME}://openreel`;
export const APP_INDEX = `${APP_ORIGIN}/index.html`;
