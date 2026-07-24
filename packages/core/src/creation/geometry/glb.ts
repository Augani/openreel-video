import { computeMeshBounds, type Mesh } from "./mesh";
import { encodeBase64, type MeshToGltfOptions } from "./gltf";

const COMPONENT_FLOAT = 5126;
const COMPONENT_UNSIGNED_INT = 5125;
const TARGET_ARRAY_BUFFER = 34962;
const TARGET_ELEMENT_ARRAY_BUFFER = 34963;
const MODE_TRIANGLES = 4;

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const CHUNK_TYPE_JSON = 0x4e4f534a;
const CHUNK_TYPE_BIN = 0x004e4942;

function alignTo4(value: number): number {
  return (value + 3) & ~3;
}

interface MeshBinary {
  readonly buffer: Uint8Array;
  readonly positionOffset: number;
  readonly normalOffset: number;
  readonly uvOffset: number;
  readonly indexOffset: number;
  readonly positionLength: number;
  readonly normalLength: number;
  readonly uvLength: number;
  readonly indexLength: number;
}

function buildMeshBinary(mesh: Mesh): MeshBinary {
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

  return {
    buffer,
    positionOffset,
    normalOffset,
    uvOffset,
    indexOffset,
    positionLength: positionBytes.byteLength,
    normalLength: normalBytes.byteLength,
    uvLength: uvBytes.byteLength,
    indexLength: indexBytes.byteLength,
  };
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

function buildGlbJson(mesh: Mesh, binary: MeshBinary, options: MeshToGltfOptions): string {
  const bounds = computeMeshBounds(mesh.positions);
  const vertexCount = mesh.positions.length / 3;
  const json = {
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
        name: options.name ?? "material",
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
        count: mesh.indices.length,
        type: "SCALAR",
      },
    ],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: binary.positionOffset,
        byteLength: binary.positionLength,
        target: TARGET_ARRAY_BUFFER,
      },
      {
        buffer: 0,
        byteOffset: binary.normalOffset,
        byteLength: binary.normalLength,
        target: TARGET_ARRAY_BUFFER,
      },
      {
        buffer: 0,
        byteOffset: binary.uvOffset,
        byteLength: binary.uvLength,
        target: TARGET_ARRAY_BUFFER,
      },
      {
        buffer: 0,
        byteOffset: binary.indexOffset,
        byteLength: binary.indexLength,
        target: TARGET_ELEMENT_ARRAY_BUFFER,
      },
    ],
    buffers: [{ byteLength: binary.buffer.byteLength }],
  };
  return JSON.stringify(json);
}

export function meshToGlb(mesh: Mesh, options: MeshToGltfOptions = {}): Uint8Array {
  const binary = buildMeshBinary(mesh);
  const jsonString = buildGlbJson(mesh, binary, options);
  const jsonBytes = new TextEncoder().encode(jsonString);
  const jsonPadded = alignTo4(jsonBytes.byteLength);
  const binPadded = alignTo4(binary.buffer.byteLength);
  const totalLength = 12 + 8 + jsonPadded + 8 + binPadded;

  const out = new Uint8Array(totalLength);
  const view = new DataView(out.buffer);
  let offset = 0;
  view.setUint32(offset, GLB_MAGIC, true);
  view.setUint32(offset + 4, GLB_VERSION, true);
  view.setUint32(offset + 8, totalLength, true);
  offset += 12;

  view.setUint32(offset, jsonPadded, true);
  view.setUint32(offset + 4, CHUNK_TYPE_JSON, true);
  offset += 8;
  out.set(jsonBytes, offset);
  for (let i = jsonBytes.byteLength; i < jsonPadded; i += 1) {
    out[offset + i] = 0x20;
  }
  offset += jsonPadded;

  view.setUint32(offset, binPadded, true);
  view.setUint32(offset + 4, CHUNK_TYPE_BIN, true);
  offset += 8;
  out.set(binary.buffer, offset);

  return out;
}

export function meshToGlbBase64(mesh: Mesh, options: MeshToGltfOptions = {}): string {
  return encodeBase64(meshToGlb(mesh, options));
}
