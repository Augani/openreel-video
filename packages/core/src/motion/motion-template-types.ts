import type { MotionComposition } from "./types";

export type MotionTemplateCategory =
  | "ads"
  | "app-ui-demos"
  | "lower-thirds"
  | "product-shots"
  | "social-hooks"
  | "kinetic-typography"
  | "logo-reveals"
  | "end-screens";

export interface MotionTemplateVariable {
  readonly id: string;
  readonly label: string;
  readonly type: "text" | "color" | "media" | "number" | "boolean";
  readonly defaultValue: string | number | boolean;
}

export interface MotionTemplate {
  readonly id: string;
  readonly name: string;
  readonly category: MotionTemplateCategory;
  readonly description: string;
  readonly thumbnailUrl?: string | null;
  readonly previewUrl?: string | null;
  readonly variables: MotionTemplateVariable[];
  readonly composition: MotionComposition;
}
