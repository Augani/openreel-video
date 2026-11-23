import {
  renderMeshToImage,
  renderMeshToPng,
  rayTraceMeshToImage,
  rayTraceMeshToPng,
  renderMeshAuto,
  encodePng,
  encodeBase64,
  meshToGltf,
  meshToGlbBase64,
} from "@openreel/core/creation/index";

/**
 * Mesh rendering and glTF/GLB writing for the creation tools. Loaded on first call (dynamic import from
 * registry.ts) so the rasterizer, ray tracer, WebGPU path and glTF writers stay out of the agent chunk.
 */

type Mesh = Parameters<typeof renderMeshToImage>[0];
type RenderOptions = Parameters<typeof renderMeshToImage>[1];
type ExportOptions = Parameters<typeof meshToGltf>[1];

export interface CreationMeshRender {
  renderWidth: number;
  renderHeight: number;
  coveredPixels: number;
  shadowedPixels: number | undefined;
  dataUri: string | undefined;
  backend: "webgpu" | "cpu";
}

export async function renderCreationMesh(
  mesh: Mesh,
  mode: "raster" | "raytrace" | "auto",
  baseOptions: RenderOptions,
  includePng: boolean,
  shadows: boolean,
): Promise<CreationMeshRender> {
  if (mode === "auto") {
    const image = await renderMeshAuto(mesh, baseOptions);
    return {
      renderWidth: image.width,
      renderHeight: image.height,
      coveredPixels: image.coveredPixels,
      shadowedPixels: undefined,
      backend: image.backend,
      dataUri: includePng
        ? `data:image/png;base64,${encodeBase64(encodePng(image.rgba, image.width, image.height))}`
        : undefined,
    };
  }
  if (mode === "raytrace") {
    const options = { ...baseOptions, shadows };
    const rendered = includePng
      ? rayTraceMeshToPng(mesh, options)
      : rayTraceMeshToImage(mesh, options);
    return {
      renderWidth: rendered.width,
      renderHeight: rendered.height,
      coveredPixels: rendered.coveredPixels,
      shadowedPixels:
        "shadowedPixels" in rendered ? rendered.shadowedPixels : undefined,
      dataUri: "dataUri" in rendered ? rendered.dataUri : undefined,
      backend: "cpu",
    };
  }
  const rendered = includePng
    ? renderMeshToPng(mesh, baseOptions)
    : renderMeshToImage(mesh, baseOptions);
  return {
    renderWidth: rendered.width,
    renderHeight: rendered.height,
    coveredPixels: rendered.coveredPixels,
    shadowedPixels: undefined,
    dataUri: "dataUri" in rendered ? rendered.dataUri : undefined,
    backend: "cpu",
  };
}

export function exportCreationMesh(
  mesh: Mesh,
  format: "gltf" | "glb" | undefined,
  options: ExportOptions,
): {
  gltf: ReturnType<typeof meshToGltf> | undefined;
  glbBase64: string | undefined;
} {
  return {
    gltf: format === "gltf" ? meshToGltf(mesh, options) : undefined,
    glbBase64: format === "glb" ? meshToGlbBase64(mesh, options) : undefined,
  };
}
