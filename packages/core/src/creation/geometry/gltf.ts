import { computeMeshBounds, type Mesh } from "./mesh";

export interface GltfDocument {
  readonly asset: { readonly version: "2.0"; readonly generator: string };
  readonly scene: number;
  readonly scenes: ReadonlyArray<{ readonly nodes: readonly number[] }>;
  readonly nodes: ReadonlyArray<{ readonly mesh: number; readonly name?: string }>;
  readonly meshes: ReadonlyArray<{
    readonly name?: string;
    readonly primitives: ReadonlyArray<{
      readonly attributes: Record<string, number>;
      readonly indices: number;
      readonly material?: number;
      readonly mode: number;
    }>;
  }>;
  readonly materials?: ReadonlyArray<Record<string, unknown>>;
  readonly accessors: ReadonlyArray<Record<string, unknown>>;
  readonly bufferViews: ReadonlyArray<Record<string, unknown>>;
  readonly buffers: ReadonlyArray<{ readonly byteLength: number; readonly uri: string }>;
}

const COMPONENT_FLOAT = 5126;
const COMPONENT_UNSIGNED_INT = 5125;
const TARGET_ARRAY_BUFFER = 34962;
const TARGET_ELEMENT_ARRAY_BUFFER = 34963;
const MODE_TRIANGLES = 4;

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function encodeBase64(bytes: Uint8Array): string {
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;
    output += BASE64_CHARS[(triplet >> 18) & 63];
    output += BASE64_CHARS[(triplet >> 12) & 63];
    output += i + 1 < bytes.length ? BASE64_CHARS[(triplet >> 6) & 63] : "=";
    output += i + 2 < bytes.length ? BASE64_CHARS[triplet & 63] : "=";
  }
  return output;
}

function alignTo4(value: number): number {
  return (value + 3) & ~3;
}

export interface MeshToGltfOptions {
  readonly name?: string;
  readonly baseColor?: string;
}

function hexToRgba(hex: string | undefined): [number, number, number, number] {
  if (!hex) return [0.8, 0.8, 0.8, 1];
  const normalized = hex.replace("#", "");
  if (normalized.length < 6) return [0.8, 0.8, 0.8, 1];
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [0.8, 0.8, 0.8, 1];
  return [r, g, b, 1];
}

export function meshToGltf(mesh: Mesh, options: MeshToGltfOptions = {}): GltfDocument {
  const positionBytes = new Uint8Array(mesh.positions.buffer.slice(0));
  const normalBytes = new Uint8Array(mesh.normals.buffer.slice(0));
  const uvBytes = new Uint8Array(mesh.uvs.buffer.slice(0));
  const indexBytes = new Uint8Array(mesh.indices.buffer.slice(0));

  const positionOffset = 0;
  const normalOffset = alignTo4(positionOffset + positionBytes.byteLength);
  const uvOffset = alignTo4(normalOffset + normalBytes.byteLength);
  const indexOffset = alignTo4(uvOffset + uvBytes.byteLength);
  const totalLength = alignTo4(indexOffset + indexBytes.byteLength);

  const buffer = new Uint8Array(totalLength);
  buffer.set(positionBytes, positionOffset);
  buffer.set(normalBytes, normalOffset);
  buffer.set(uvBytes, uvOffset);
  buffer.set(indexBytes, indexOffset);

  const bounds = computeMeshBounds(mesh.positions);
  const vertexCount = mesh.positions.length / 3;
  const indexCount = mesh.indices.length;

  return {
    asset: { version: "2.0", generator: "openreel-cpu-geometry-kernel" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: options.name }],
    meshes: [
      {
        name: options.name,
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            material: 0,
            mode: MODE_TRIANGLES,
          },
        ],
      },
    ],
    materials: [
      {
        name: `${options.name ?? "material"}`,
        pbrMetallicRoughness: {
          baseColorFactor: hexToRgba(options.baseColor),
          metallicFactor: 0.1,
          roughnessFactor: 0.7,
        },
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: COMPONENT_FLOAT,
        count: vertexCount,
        type: "VEC3",
        min: [bounds.min.x, bounds.min.y, bounds.min.z],
        max: [bounds.max.x, bounds.max.y, bounds.max.z],
      },
      { bufferView: 1, componentType: COMPONENT_FLOAT, count: vertexCount, type: "VEC3" },
      { bufferView: 2, componentType: COMPONENT_FLOAT, count: vertexCount, type: "VEC2" },
      {
        bufferView: 3,
        componentType: COMPONENT_UNSIGNED_INT,
        count: indexCount,
        type: "SCALAR",
      },
    ],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: positionOffset,
        byteLength: positionBytes.byteLength,
        target: TARGET_ARRAY_BUFFER,
      },
      {
        buffer: 0,
        byteOffset: normalOffset,
        byteLength: normalBytes.byteLength,
        target: TARGET_ARRAY_BUFFER,
      },
      {
        buffer: 0,
        byteOffset: uvOffset,
        byteLength: uvBytes.byteLength,
        target: TARGET_ARRAY_BUFFER,
      },
      {
        buffer: 0,
        byteOffset: indexOffset,
        byteLength: indexBytes.byteLength,
        target: TARGET_ELEMENT_ARRAY_BUFFER,
      },
    ],
    buffers: [
      {
        byteLength: totalLength,
        uri: `data:application/octet-stream;base64,${encodeBase64(buffer)}`,
      },
    ],
  };
}
