import { useState } from "react";
import { Icon } from "../icons";
import { validatePublishable } from "./validate";
import { publish, type SubmitInput } from "./submit";

export function PublishDialog({
  input,
  onClose,
}: {
  input: Omit<SubmitInput, "description" | "tags" | "license" | "visibility">;
  onClose: (submittedId?: string) => void;
}) {
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [license, setLicense] = useState("MIT");
  const [visibility, setVisibility] = useState<"public" | "unlisted">("public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePublish() {
    setError(null);
    const v = validatePublishable(input);
    if (!v.ok) {
      setError(v.errors.join("\n"));
      return;
    }
    setBusy(true);
    const r = await publish({
      ...input,
      description,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      license,
      visibility,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onClose(r.submissionId);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="w-[440px] rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-white">Publish "{input.name}"</h3>
          <button type="button" onClick={() => onClose()} aria-label="Close" className="text-zinc-500 hover:text-zinc-300">
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-3 text-xs text-zinc-300">
          <Field label="Kind"><span className="capitalize">{input.kind}</span></Field>
          <Field label="Visibility">
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as "public" | "unlisted")} className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1">
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
            </select>
          </Field>
          <Field label="Description">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full resize-none rounded border border-zinc-800 bg-zinc-900 px-2 py-1" />
          </Field>
          <Field label="Tags (comma-separated)">
            <input value={tags} onChange={(e) => setTags(e.target.value)} className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1" />
          </Field>
          <Field label="License">
            <select value={license} onChange={(e) => setLicense(e.target.value)} className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1">
              <option>MIT</option>
              <option>CC-BY-4.0</option>
              <option>All Rights Reserved</option>
            </select>
          </Field>
          {error && (
            <pre className="whitespace-pre-wrap rounded border border-red-900/40 bg-red-950/40 p-2 text-[11px] text-red-300">{error}</pre>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => onClose()} className="rounded border border-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-700">Cancel</button>
          <button type="button" disabled={busy} onClick={handlePublish} className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50">
            {busy ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      {children}
    </label>
  );
}
