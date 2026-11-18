/** Presets and portable/AI edits use normalized amounts. The existing saved
 * project, inspector and CPU rendering paths use percentage points for these
 * four parameters. Convert only at an explicitly identified boundary; never
 * infer units from a value's magnitude or rewrite saved project parameters. */
const percentageParameters: Readonly<Record<string, string>> = {
  brightness: "value",
  sharpen: "amount",
  vignette: "amount",
  grain: "amount",
};

function convert(type: string, params: Readonly<Record<string, unknown>>, exponent: number): Record<string, unknown> {
  const key = percentageParameters[type];
  const value = key ? params[key] : undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return { ...params };
  // Decimal exponent shifts avoid turning ordinary values such as 0.29 into
  // 28.999999999999996 in shared files and inspector controls.
  const [coefficient, power = "0"] = String(value).split("e");
  return { ...params, [key]: Number(`${coefficient}e${Number(power) + exponent}`) };
}

export function toRuntimeVideoEffectParams(type: string, normalized: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return convert(type, normalized, 2);
}

export function toNormalizedVideoEffectParams(type: string, runtime: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return convert(type, runtime, -2);
}
