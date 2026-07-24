# OpenReel rigging sidecars

This folder is the desktop app's optional rigging backend resource root.

In development, OpenReel checks this folder first after environment overrides:

- `OPENREEL_BLENDER_PATH=/absolute/path/to/blender`
- `BLENDER_PATH=/absolute/path/to/blender`

To bundle Blender, place platform slots under:

- `blender/darwin-arm64/Blender.app/Contents/MacOS/Blender`
- `blender/darwin-x64/Blender.app/Contents/MacOS/Blender`
- `blender/win32-x64/blender.exe`
- `blender/linux-x64/blender`

Packaged builds copy this folder to `process.resourcesPath/rigging`. The actual
Blender binaries/app bundles are intentionally gitignored because they are large
redistributable sidecars. Keep provenance, versions, hashes, and source-offer
notes in app documentation instead of committing the binary bundle.

The desktop main process currently generates Blender Python job scripts at
runtime for MCP rigging tools such as `rig_humanoid_model`. Keep durable shared
job assets or bundled Blender resources under this folder when they become
large enough to version separately from the TypeScript sidecar code.
