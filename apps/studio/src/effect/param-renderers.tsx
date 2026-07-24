import type { z } from "zod";

export interface ParamFieldProps {
  id: string;
  label: string;
  value: unknown;
  schema: z.ZodTypeAny;
  onChange: (value: unknown) => void;
}

type SchemaDef = Record<string, unknown>;

function resolveSchema(schema: z.ZodTypeAny): SchemaDef {
  const def = (schema as unknown as { _def: SchemaDef })._def;
  const typeName = (def.type ?? def.typeName) as string | undefined;
  if (typeName === "default" || typeName === "ZodDefault" || typeName === "optional" || typeName === "ZodOptional") {
    const inner = (def.innerType ?? def.schema) as z.ZodTypeAny | undefined;
    if (inner) return resolveSchema(inner);
  }
  return def;
}

export function ParamField({ id, label, value, schema, onChange }: ParamFieldProps) {
  const def = resolveSchema(schema);
  const typeName = (def.type ?? def.typeName) as string | undefined;

  if (typeName === "number" || typeName === "ZodNumber") {
    const min = (def.minValue as number | null | undefined) ?? 0;
    const max = (def.maxValue as number | null | undefined) ?? 1;
    const resolvedMin = min ?? 0;
    const resolvedMax = max ?? 1;
    const step = (resolvedMax - resolvedMin) / 100;
    return (
      <label className="flex flex-col gap-1 text-xs text-zinc-300">
        <span className="flex justify-between">
          <span>{label}</span>
          <span className="text-zinc-500">{typeof value === "number" ? value.toFixed(2) : "—"}</span>
        </span>
        <input
          id={id}
          aria-label={label}
          type="range"
          min={resolvedMin}
          max={resolvedMax}
          step={step}
          value={typeof value === "number" ? value : resolvedMin}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="h-1 w-full accent-blue-500"
        />
      </label>
    );
  }

  if (typeName === "enum" || typeName === "ZodEnum") {
    const options = (def.options as string[] | undefined) ?? Object.values((def.values ?? def.enum ?? {}) as Record<string, string>);
    if (options.length <= 4) {
      return (
        <label className="flex flex-col gap-1 text-xs text-zinc-300">
          <span>{label}</span>
          <div className="flex gap-1">
            {options.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onChange(v)}
                className={`flex-1 rounded border px-2 py-1 text-[11px] capitalize ${
                  value === v
                    ? "border-blue-500 bg-blue-900/40 text-white"
                    : "border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </label>
      );
    }
    return (
      <label className="flex flex-col gap-1 text-xs text-zinc-300">
        <span>{label}</span>
        <select
          id={id}
          aria-label={label}
          value={typeof value === "string" ? value : options[0]}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs"
        >
          {options.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (typeName === "boolean" || typeName === "ZodBoolean") {
    return (
      <label className="flex items-center justify-between text-xs text-zinc-300">
        <span>{label}</span>
        <input
          id={id}
          aria-label={label}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-blue-500"
        />
      </label>
    );
  }

  if (typeName === "string" || typeName === "ZodString") {
    return (
      <label className="flex flex-col gap-1 text-xs text-zinc-300">
        <span>{label}</span>
        <input
          id={id}
          aria-label={label}
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs"
        />
      </label>
    );
  }

  return null;
}

type RawShapeSchema = {
  _def: { shape?: Record<string, z.ZodTypeAny> } & Record<string, unknown>;
  shape?: Record<string, z.ZodTypeAny>;
};

export function fieldsFromObjectSchema(
  schema: z.ZodObject<z.ZodRawShape>,
): Array<{ key: string; label: string; schema: z.ZodTypeAny }> {
  const raw = schema as unknown as RawShapeSchema;
  const shape: Record<string, z.ZodTypeAny> =
    (typeof raw.shape === "object" && raw.shape !== null
      ? raw.shape
      : raw._def.shape) ?? {};
  return Object.entries(shape).map(([key, child]) => ({
    key,
    label: key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
    schema: child as z.ZodTypeAny,
  }));
}
