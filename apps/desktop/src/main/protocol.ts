import { protocol, net } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cacheControlFor, contentTypeFor, resolveAppPath } from "./protocol-paths";

const SCHEME = "app";

export function registerAppSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
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
