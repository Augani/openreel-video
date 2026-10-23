/**
 * Arabic UI for the Hawsh Khalifa build: English UI string → Arabic, from one dictionary (ar.ts) plus a
 * few patterns for strings built from parts ("Open Crop", "Expand Keyframes section", "3 selected").
 * Exact matches only, so user content (clip names, project names, typed text) is left alone unless it
 * happens to equal a UI label.
 */
import { AR } from "./ar";

type Pattern = [RegExp, (m: RegExpMatchArray, t: (s: string) => string | null) => string | null];

type Unit = "minute" | "hour" | "day";
const UNITS: Record<Unit, [one: string, two: string, few: string]> = {
  minute: ["دقيقة", "دقيقتين", "دقائق"],
  hour: ["ساعة", "ساعتين", "ساعات"],
  day: ["يوم", "يومين", "أيام"],
};
/** "5 دقائق", "دقيقتين", "11 دقيقة": Arabic plural rules for counts. */
function count(n: number, unit: Unit): string {
  const [one, two, few] = UNITS[unit];
  if (n === 1) return one;
  if (n === 2) return two;
  return `${n} ${n >= 3 && n <= 10 ? few : one}`;
}

/** Translates a part only when the dictionary knows it; otherwise the whole pattern is skipped. */
const part = (t: (s: string) => string | null, s: string) => t(s.trim());

const PATTERNS: Pattern[] = [
  [/^(.+)\. Drag onto a clip to apply, or double-click to apply to selected clip\.$/, (m, t) => {
    const name = part(t, m[1]);
    return name && `${name}. اسحبه إلى مقطع لتطبيقه، أو انقر مرتين لتطبيقه على المقطع المحدد.`;
  }],
  [/^(.+)\. Drag onto a clip edge, or double-click to apply to the selected cut\.$/, (m, t) => {
    const name = part(t, m[1]);
    return name && `${name}. اسحبه إلى طرف مقطع، أو انقر مرتين لتطبيقه على القطع المحدد.`;
  }],
  [/^Expand (.+) section$/, (m, t) => { const s = part(t, m[1]); return s && `توسيع قسم ${s}`; }],
  [/^Collapse (.+) section$/, (m, t) => { const s = part(t, m[1]); return s && `طي قسم ${s}`; }],
  [/^Open (.+)$/, (m, t) => { const s = part(t, m[1]); return s && `فتح ${s}`; }],
  [/^Preview and select (.+?)(?:, (?:Built-in fill|Paper effect))?$/, (m, t) => { const s = part(t, m[1]); return s && `معاينة واختيار ${s}`; }],
  [/^Preview and apply (.+)$/, (m, t) => { const s = part(t, m[1]); return s && `معاينة وتطبيق ${s}`; }],
  [/^Preview (.+)$/, (m, t) => { const s = part(t, m[1]); return s && `معاينة ${s}`; }],
  [/^Set entry animation to (.+)$/, (m, t) => { const s = part(t, m[1]); return s && `حركة الدخول: ${s}`; }],
  [/^Set exit animation to (.+)$/, (m, t) => { const s = part(t, m[1]); return s && `حركة الخروج: ${s}`; }],
  [/^Edit (.+) value$/, (m, t) => { const s = part(t, m[1]); return s && `تعديل قيمة ${s}`; }],
  [/^Add (.+)$/, (m, t) => { const s = part(t, m[1]); return s && `إضافة ${s}`; }],
  [/^Track (\d+)$/, (m) => `المسار ${m[1]}`],
  [/^(Rename|Duplicate|Delete|Hide|Show|Lock|Unlock) Track (\d+)$/, (m) => {
    const verb: Record<string, string> = { Rename: "إعادة تسمية", Duplicate: "تكرار", Delete: "حذف", Hide: "إخفاء", Show: "إظهار", Lock: "قفل", Unlock: "فتح قفل" };
    return `${verb[m[1]]} المسار ${m[2]}`;
  }],
  [/^Move Track (\d+) (up|down)$/, (m) => `نقل المسار ${m[1]} ${m[2] === "up" ? "للأعلى" : "للأسفل"}`],
  [/^Select (text|video|image|audio|shape) clip (.+)$/, (m) => {
    const kind: Record<string, string> = { text: "النص", video: "الفيديو", image: "الصورة", audio: "الصوت", shape: "الشكل" };
    return `تحديد مقطع ${kind[m[1]]} ${m[2]}`;
  }],
  [/^Go to step (\d+)$/, (m) => `الانتقال إلى الخطوة ${m[1]}`],
  [/^(\d+) emojis available$/, (m) => `${m[1]} رمزاً تعبيرياً متاحاً`],
  [/^(\d+) selected$/, (m) => `${m[1]} محدد`],
  [/^(\d+) items added to the project$/, (m) => `أُضيف ${m[1]} عناصر إلى المشروع`],
  [/^Undo \((\d+)\)$/, (m) => `تراجع (${m[1]})`],
  [/^Redo \((\d+)\)$/, (m) => `إعادة (${m[1]})`],
  [/^(\d+) (minute|hour|day)s? ago$/, (m) => `قبل ${count(Number(m[1]), m[2] as Unit)}`],
  [/^(\d+) older saves? available$/, (m) => `${m[1]} نسخة أقدم متاحة`],
  [/^· (\d+) kbps audio$/, (m) => `· ${m[1]} kbps صوت`],
  [/^Recover (.+)$/, (m) => `استعادة ${m[1]}`],
  [/^~(\d+) seconds?$/, (m) => `~${m[1]} ثانية`],
  [/^~(\d+) minutes?$/, (m) => `~${m[1]} دقيقة`],
  [/^(.+) · (\d+) cores$/, (m) => `${m[1]} · ${m[2]} أنوية`],
  [/^Loop (\S+) to (\S+) • I: mark start • O: mark end • Shift\+L: toggle$/, (m) =>
    `تكرار من ${m[1]} إلى ${m[2]} • I: بداية • O: نهاية • Shift+L: تشغيل/إيقاف`],
  [/^Go to a frame · (\S+) fps · HH:MM:SS:FF \(non-drop-frame\)\. You can also enter seconds\.$/, (m) =>
    `انتقل إلى إطار · ${m[1]} إطار/ث · HH:MM:SS:FF. يمكنك أيضاً إدخال الثواني.`],
  [/^Theme: (Light|Dark)\. Switch to (Light|Dark)$/, (m) =>
    `المظهر: ${m[1] === "Light" ? "فاتح" : "داكن"}. التبديل إلى ${m[2] === "Light" ? "الفاتح" : "الداكن"}`],
];

/** Arabic for one UI string, or null when it is not a known UI string. */
export function translateUi(text: string): string | null {
  const key = text.trim();
  if (!key || !/[A-Za-z]/.test(key)) return null;
  const exact = AR[key];
  if (exact !== undefined) return exact;
  for (const [re, fn] of PATTERNS) {
    const m = key.match(re);
    if (m) {
      const out = fn(m, translateUi);
      if (out) return out;
    }
  }
  return null;
}

/** Same as translateUi but keeps the surrounding whitespace of a text node. */
export function translateTextNode(value: string): string | null {
  const out = translateUi(value);
  if (out === null) return null;
  const lead = /^\s*/.exec(value)![0];
  const trail = /\s*$/.exec(value)![0];
  return lead + out + trail;
}
