/** Small, deliberately closed JSON-schema subset shared by edit files and tools. */
export interface EditSchema {
  type?: "object" | "array" | "string" | "number" | "boolean";
  properties?: Record<string, EditSchema>;
  required?: string[];
  additionalProperties?: boolean | EditSchema;
  items?: EditSchema;
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  maxItems?: number;
  pattern?: string;
}

export function validateEditJSON(value: unknown, schema: EditSchema, path = "$", depth = 0): void {
  if (depth > 32) throw new Error(`${path}: document is too deeply nested`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}: unsupported value`);
  if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path}: expected a finite number`);
    if (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum) throw new Error(`${path}: number is outside the supported range`);
  } else if (schema.type === "string") {
    if (typeof value !== "string" || value.length > (schema.maxLength ?? 10000)) throw new Error(`${path}: invalid string`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) throw new Error(`${path}: unsupported string value`);
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") throw new Error(`${path}: expected a boolean`);
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length > (schema.maxItems ?? 2000)) throw new Error(`${path}: invalid or oversized array`);
    value.forEach((item, i) => validateEditJSON(item, schema.items ?? {}, `${path}[${i}]`, depth + 1));
  } else if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path}: expected an object`);
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in obj)) throw new Error(`${path}.${key}: required`);
    for (const [key, item] of Object.entries(obj)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error(`${path}: forbidden property`);
      const child = schema.properties?.[key];
      if (child) validateEditJSON(item, child, `${path}.${key}`, depth + 1);
      else if (typeof schema.additionalProperties === "object") validateEditJSON(item, schema.additionalProperties, `${path}.${key}`, depth + 1);
      else if (schema.additionalProperties !== true) throw new Error(`${path}.${key}: unsupported property`);
    }
  }
}

export const editString: EditSchema = { type: "string", maxLength: 10000 };
export const editId: EditSchema = { type: "string", pattern: "^[a-zA-Z0-9_.:-]{1,200}$" };
export const editNumber = (minimum = -100000, maximum = 100000): EditSchema => ({ type: "number", minimum, maximum });
export const editTime = editNumber(0, 86400);
export const editBoolean: EditSchema = { type: "boolean" };
export const editEnum = (values: readonly string[]): EditSchema => ({ type: "string", enum: values });
export const editObject = (properties: Record<string, EditSchema>, required: string[] = []): EditSchema => ({ type: "object", properties, required, additionalProperties: false });
export const editArray = (items: EditSchema, maxItems = 2000): EditSchema => ({ type: "array", items, maxItems });
