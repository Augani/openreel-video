export type MotionShaderParamType = "number" | "color";

export interface MotionShaderParamDef {
  readonly name: string;
  readonly label: string;
  readonly type: MotionShaderParamType;
  readonly default: number | string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly control?: "slider" | "number";
}

export type MotionShaderCategory = "fill" | "effect" | "text";

export interface MotionShaderColorArrayParams {
  readonly uniform: string;
  readonly countUniform: string;
  readonly max: number;
}

export interface MotionShaderDef {
  readonly id: string;
  readonly name: string;
  readonly category: MotionShaderCategory;
  readonly glsl: string;
  readonly params: readonly MotionShaderParamDef[];
  readonly origin?: "builtin" | "generated";
  readonly vertexShader?: string;
  readonly staticUniforms?: Readonly<Record<string, number | readonly number[]>>;
  readonly colorArrayParams?: MotionShaderColorArrayParams;
  readonly needsNoiseTexture?: string;
  readonly timeScale?: number;
  readonly inputUniform?: string;
  readonly collection?: string;
}
