import { useEffect, useId, useRef, useState, type DragEvent, type JSX } from "react";
import { Film, Image as ImageIcon, Loader2, Music, Upload, X } from "@/icons/lucide-compat";
import {
  FORMAT_CHOICES,
  clipKind,
  formatBytes,
  formatForSize,
  probeClipSize,
  type FormatChoice,
} from "./clips";
import { loadPracticeFiles, practiceClipsAvailable } from "./start-project";

export interface DropClipsProps {
  /** Files and the chosen format are final: create the project and import. Rejects on a hard failure. */
  onSubmit: (files: File[], format: FormatChoice) => Promise<void>;
  onBack?: () => void;
  /** Progress text while the project is created and the clips import. */
  progress?: string;
  error?: string | null;
}

const ACCEPT = "video/*,audio/*,image/*";

const KIND_ICON = { video: Film, audio: Music, image: ImageIcon } as const;

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, "0")}`;
}

/** Poster frame plus duration and resolution for a chosen clip, read from the file itself. */
function ClipThumb({ file, kind }: { file: File; kind: "video" | "audio" | "image" }): JSX.Element {
  const Icon = KIND_ICON[kind];
  const [url, setUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  useEffect(() => {
    if (kind === "audio" || typeof URL.createObjectURL !== "function") return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, kind]);
  const frame = "h-9 w-14 shrink-0 rounded-md bg-bg-3 object-cover";
  const readVideo = (el: HTMLVideoElement): void => {
    const size = el.videoWidth && el.videoHeight ? `${el.videoWidth}×${el.videoHeight}` : null;
    const parts = [Number.isFinite(el.duration) ? formatClock(el.duration) : null, size].filter(Boolean);
    setMeta(parts.join(" · ") || null);
  };
  return (
    <>
      {kind === "video" && url ? (
        <video
          src={`${url}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          aria-hidden="true"
          className={frame}
          onLoadedMetadata={(e) => readVideo(e.currentTarget)}
        />
      ) : kind === "image" && url ? (
        <img
          src={url}
          alt=""
          className={frame}
          onLoad={(e) => setMeta(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)}
        />
      ) : (
        <span className="grid h-9 w-14 shrink-0 place-items-center rounded-md bg-bg-3 text-fg-3">
          <Icon size={15} aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-fg">{file.name}</span>
        {meta && <span className="block truncate text-[11px] text-fg-3">{meta}</span>}
      </span>
    </>
  );
}

export default function DropClips({ onSubmit, onBack, progress, error }: DropClipsProps): JSX.Element {
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [formatId, setFormatId] = useState<FormatChoice["id"]>("horizontal");
  const formatTouched = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [practice, setPractice] = useState(false);
  const [loadingPractice, setLoadingPractice] = useState(false);

  useEffect(() => {
    let alive = true;
    void practiceClipsAvailable().then((ok) => {
      if (alive) setPractice(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  // The first picture-bearing clip decides the default format, until the user picks one.
  const firstVisual = files.find((f) => clipKind(f) !== "audio");
  useEffect(() => {
    if (!firstVisual || formatTouched.current) return;
    let alive = true;
    void probeClipSize(firstVisual).then((size) => {
      if (alive && size && !formatTouched.current) setFormatId(formatForSize(size.width, size.height));
    });
    return () => {
      alive = false;
    };
  }, [firstVisual]);

  const add = (incoming: File[]): void => {
    const bad = incoming.filter((f) => !clipKind(f)).map((f) => f.name);
    const accepted = incoming.filter((f) => clipKind(f));
    setRejected(bad);
    setFiles((current) => {
      const seen = new Set(current.map((f) => `${f.name}:${f.size}`));
      return [...current, ...accepted.filter((f) => !seen.has(`${f.name}:${f.size}`))];
    });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    add(Array.from(event.dataTransfer.files));
  };

  const usePractice = async (): Promise<void> => {
    setLoadingPractice(true);
    const loaded = await loadPracticeFiles();
    setLoadingPractice(false);
    if (loaded.length > 0) setFiles(loaded);
  };

  const format = FORMAT_CHOICES.find((f) => f.id === formatId) ?? FORMAT_CHOICES[0];
  const submit = async (): Promise<void> => {
    if (files.length === 0 || busy) return;
    setBusy(true);
    try {
      await onSubmit(files, format);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div
        role="group"
        aria-label="Drop zone for your clips"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors duration-150 ${
          dragging ? "border-accent bg-accent-soft" : "border-border-strong bg-bg-1"
        }`}
      >
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
          <Upload size={20} aria-hidden="true" />
        </span>
        <div>
          <div className="text-sm font-semibold text-fg">Drop videos, photos or audio</div>
          <div className="mt-0.5 text-xs text-fg-3">They stay on this computer. Nothing is uploaded.</div>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-lg border border-border-strong bg-bg-2 px-3 text-xs font-semibold text-fg hover:bg-bg-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => inputRef.current?.click()}
          >
            Choose files…
          </button>
          {practice && (
            <button
              type="button"
              disabled={loadingPractice}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-accent hover:bg-accent-soft disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => void usePractice()}
            >
              {loadingPractice && <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden="true" />}
              Use practice clips instead
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          aria-label="Choose clip files"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            add(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {rejected.length > 0 && (
        <p role="alert" className="text-xs text-status-error">
          Skipped {rejected.length} {rejected.length === 1 ? "file" : "files"} that are not video, audio or images:{" "}
          {rejected.slice(0, 3).join(", ")}
          {rejected.length > 3 ? "…" : ""}
        </p>
      )}

      {files.length > 0 && (
        <ul aria-label="Selected clips" className="flex max-h-52 flex-col gap-1.5 overflow-y-auto">
          {files.map((file) => {
            const kind = clipKind(file) ?? "video";
            return (
              <li
                key={`${file.name}:${file.size}`}
                className="flex items-center gap-2.5 rounded-lg border border-border bg-bg-2 px-2 py-1.5"
              >
                <ClipThumb file={file} kind={kind} />
                <span className="shrink-0 text-xs text-fg-3">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  disabled={busy}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded text-fg-3 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => setFiles((c) => c.filter((f) => f !== file))}
                >
                  <X size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <fieldset className="border-0 p-0">
        <legend id={`${uid}-format`} className="mb-2 text-xs font-medium text-fg-2">
          Video format
        </legend>
        <div role="radiogroup" aria-labelledby={`${uid}-format`} className="grid grid-cols-3 gap-2">
          {FORMAT_CHOICES.map((f) => {
            const selected = f.id === formatId;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={busy}
                onClick={() => {
                  formatTouched.current = true;
                  setFormatId(f.id);
                }}
                className={`flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  selected ? "border-accent/60 bg-accent-soft" : "border-border bg-bg-2 hover:border-accent/40"
                }`}
              >
                <span className="text-[13px] font-semibold text-fg">{f.label}</span>
                <span className="text-xs text-fg-3">{f.dimensions}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div role="status" aria-live="polite" className="min-h-4 text-xs text-fg-2">
        {busy ? progress : null}
      </div>
      {error && (
        <p role="alert" className="text-xs text-status-error">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
        {onBack ? (
          <button
            type="button"
            disabled={busy}
            className="rounded text-xs text-fg-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            onClick={onBack}
          >
            Back
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={files.length === 0 || busy}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg shadow-glow hover:bg-accent-strong disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={() => void submit()}
        >
          {busy && <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />}
          Continue
        </button>
      </div>
    </div>
  );
}
