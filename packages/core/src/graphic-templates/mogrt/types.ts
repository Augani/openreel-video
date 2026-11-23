/**
 * Motion Graphics Template (.mogrt) import: shared types.
 *
 * What a Premiere-authored .mogrt holds (as far as it is publicly documented; see definition.ts and prgraphic.ts for
 * how much of it is verified): a zip with `definition.json` (the Essential Graphics controls), the graphic itself
 * (`*.prgraphic` / `project.prproj`, gzip XML) and a thumbnail / preview. After Effects authored ones hold an
 * `.aegraphic` (an AE composition) instead, which only Adobe's engine can render.
 */

export type MogrtControlKind = "text" | "color" | "slider" | "checkbox" | "font" | "media" | "point" | "unknown";

export interface MogrtFontInfo {
  readonly fontEditable: boolean;
  readonly fontSizeEditable: boolean;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly allCaps?: boolean;
}

export interface MogrtControlBinding {
  /** Layer id or name inside the graphic. */
  readonly layer?: string;
  /** Property name as Essential Graphics shows it ("Source Text", "Fill Color", "Opacity", ...). */
  readonly property?: string;
}

/** One entry of definition.json `clientControls`: an editable control of the template. */
export interface MogrtControl {
  readonly id: string;
  readonly name: string;
  readonly group?: string;
  readonly kind: MogrtControlKind;
  /** The raw `type` field (a GUID in files Adobe writes), kept for the report. */
  readonly rawType: string;
  readonly defaultValue?: string | number | boolean | { readonly x: number; readonly y: number };
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly options?: readonly string[];
  readonly font?: MogrtFontInfo;
  readonly bindings: readonly MogrtControlBinding[];
}

export interface MogrtDefinition {
  readonly authorApp?: string;
  readonly authorAppVersion?: string;
  readonly name?: string;
  readonly description?: string;
  readonly duration?: number;
  readonly controls: readonly MogrtControl[];
  /** Fields of definition.json the importer did not read (listed in the report). */
  readonly unreadKeys: readonly string[];
}

export type MogrtReportSeverity = "dropped" | "approximated" | "info";

export interface MogrtReportItem {
  readonly severity: MogrtReportSeverity;
  /** Short label: "Text tracking", "Mask", "Control: Logo", ... */
  readonly feature: string;
  readonly detail: string;
  readonly layer?: string;
}

export interface MogrtImportReport {
  readonly fileName?: string;
  readonly authorApp?: string;
  readonly items: readonly MogrtReportItem[];
  readonly dropped: number;
  readonly approximated: number;
  readonly layersImported: number;
  readonly layersTotal: number;
  readonly controlsImported: number;
  readonly controlsTotal: number;
  /** One-line human summary for toasts. */
  readonly summary: string;
}

export type MogrtFailureReason = "not-a-zip" | "after-effects" | "no-graphic" | "invalid" | "unreadable" | "too-large";

export type MogrtImportResult =
  | {
      readonly ok: true;
      readonly template: import("../types").GraphicTemplate;
      readonly report: MogrtImportReport;
      /** data: URL of the template's thumbnail, when the archive has a png / jpeg one. */
      readonly thumbnail?: string;
    }
  | {
      readonly ok: false;
      readonly reason: MogrtFailureReason;
      readonly message: string;
      readonly report: MogrtImportReport;
    };
