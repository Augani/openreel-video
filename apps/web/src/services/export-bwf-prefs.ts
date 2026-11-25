/** The Broadcast WAV fields of the export dialog, kept per browser so the quick export and the dialog agree. */
export interface BwfPrefs {
  description: string;
  originator: string;
}

const KEY = "openreel.export.bwf";
const EMPTY: BwfPrefs = { description: "", originator: "" };

export function readBwfPrefs(): BwfPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<BwfPrefs>;
    return {
      description: typeof parsed.description === "string" ? parsed.description : "",
      originator: typeof parsed.originator === "string" ? parsed.originator : "",
    };
  } catch {
    return { ...EMPTY };
  }
}

export function writeBwfPrefs(prefs: BwfPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked: the fields still apply to this session's dialog only.
  }
}
