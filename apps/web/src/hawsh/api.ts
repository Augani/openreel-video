/** Network side of the Director's Eyes library: list, import into the project, save an export. */
import { HAWSH_LIBRARY_MAX_BYTES, HAWSH_PAGE_SIZE, HAWSH_REF_BUCKET } from "./config";
import { exportProblem, imageJobItems, importFileName, referenceItems, videoJobItems, type HawshItem, type HawshKind, type HawshSource } from "./library";
import { hawshClient, useHawshStore } from "./session";

function signedIn() {
  const c = hawshClient();
  const uid = useHawshStore.getState().userId;
  if (!c || !uid) throw new Error("Open the editor from hawsh-khalifa.com to use your library.");
  return { c, uid };
}

export async function listLibrary(source: HawshSource, kind: HawshKind): Promise<HawshItem[]> {
  const { c, uid } = signedIn();
  if (source === "generations") {
    const table = kind === "image" ? "director_image_jobs" : "director_video_jobs";
    const cols = kind === "image" ? "id, title, prompt, image_urls, created_at" : "id, request_id, title, prompt, video_url, frame_urls, created_at";
    const { data, error } = await c.from(table).select(cols)
      .eq("user_id", uid).eq("status", "completed").is("hidden_at", null)
      .order("created_at", { ascending: false }).limit(HAWSH_PAGE_SIZE);
    if (error) throw new Error("Couldn't load your generations. Try again.");
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    return kind === "image" ? imageJobItems(rows) : videoJobItems(rows);
  }
  const { data, error } = await c.from("director_ref_library").select("id, path, kind, title, created_at")
    .eq("user_id", uid).eq("kind", kind).order("created_at", { ascending: false }).limit(HAWSH_PAGE_SIZE);
  if (error) throw new Error("Couldn't load your references. Try again.");
  const items = referenceItems((data ?? []) as unknown as Record<string, unknown>[]);
  if (!items.length) return items;
  const { data: signed } = await c.storage.from(HAWSH_REF_BUCKET).createSignedUrls(items.map((i) => i.path!), 3600);
  const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return items.map((i) => {
    const url = byPath.get(i.path!) ?? null;
    return { ...i, url, thumb: i.kind === "image" ? url : null };
  });
}

/** Downloads an item (CORS, allowed under the editor's COEP) and returns it as a File for importMedia. */
export async function itemToFile(item: HawshItem): Promise<File> {
  if (!item.url) throw new Error(`"${item.title}" has no file.`);
  const res = await fetch(item.url, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`Couldn't download "${item.title}".`);
  const blob = await res.blob();
  const mime = blob.type || (item.kind === "video" ? "video/mp4" : "image/png");
  return new File([blob], importFileName(item, res.url || item.url, mime), { type: mime });
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Saves an exported video to "My references": director-refs/{uid}/{uuid}.mp4 + a director_ref_library row.
 * The same file saved twice reuses the existing row (unique content hash per user).
 */
export async function saveExportToLibrary(blob: Blob, filename: string): Promise<{ reused: boolean }> {
  const { c, uid } = signedIn();
  const problem = exportProblem(blob, filename, HAWSH_LIBRARY_MAX_BYTES);
  if (problem) throw new Error(problem);
  const mov = filename.toLowerCase().endsWith(".mov") || blob.type === "video/quicktime";
  const mime = mov ? "video/quicktime" : "video/mp4";
  const hash = await sha256Hex(blob);
  const title = filename.replace(/\.[^.]+$/, "").slice(0, 80) || "Edited video";
  const { data: existing } = await c.from("director_ref_library").select("id").eq("user_id", uid).eq("content_sha256", hash).maybeSingle();
  if (existing) {
    await c.from("director_ref_library").update({ last_used_at: new Date().toISOString(), title }).eq("id", (existing as { id: string }).id);
    return { reused: true };
  }
  const path = `${uid}/${crypto.randomUUID()}.${mov ? "mov" : "mp4"}`;
  const { error: upErr } = await c.storage.from(HAWSH_REF_BUCKET).upload(path, blob, { contentType: mime, upsert: false });
  if (upErr) throw new Error("Upload failed. Check your connection and try again.");
  const { error } = await c.from("director_ref_library").insert({
    user_id: uid, path, kind: "video", mime, bytes: blob.size, source: "upload", title, role: null, content_sha256: hash,
  });
  if (error) {
    await c.storage.from(HAWSH_REF_BUCKET).remove([path]).catch(() => undefined);
    throw new Error("Couldn't add the video to your library. Try again.");
  }
  return { reused: false };
}
