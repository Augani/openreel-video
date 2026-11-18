# Linked compositions (Dynamic Link style)

OpenReel cannot link to After Effects. Linked compositions give the same workflow inside OpenReel: a clip on the timeline references a **live composition** that you edit in its own window, and the timeline updates the moment you edit it, with no render and no re-import.

## What a linked composition is

A composition is a graphic document: a stack of text, shape, SVG and image layers (the Essential Graphics template format) plus the controls you chose to expose. It is the master. Every timeline instance of it mirrors the master, so editing the composition changes every instance.

Investigated and rejected as the basis:

- **Motion compositions** (`Project.motionCompositions`, `motion/`): a full After Effects style document, but this build ships no editor window for it, so there is nothing to edit it "live" in.
- **Nested sequences** (`timeline/sequences.ts`): already live, but they hold video and audio clips and are edited in the timeline, not a graphics window. They stay the right tool for grouping footage.
- **Essential Graphics instances** (`graphic-templates/`): a single instance owns its template. Linked compositions add the shared master on top of this, so they reuse its expansion, controls, protected intro/outro and interchange behaviour.

Data model (`packages/core/src/linked-comps/`):

- `Project.linkedCompositions[]`: the masters (`id`, `name`, `template`, `revision`).
- A timeline instance is a `GraphicInstance` with `linkedCompositionId`, its own start, length, control values and `paramKeyframes`. Its `template` is kept equal to the master by `editLinkedComposition`.
- An instance expands into ordinary text, shape and SVG clips with the same `expandGraphicInstance` as every graphic. The preview, the exporter, the render cache and smart render only ever see those clips, which is why preview and export agree.

## Using it

| Action | Where | Shortcut |
| --- | --- | --- |
| Replace with Linked Composition | Clip menu; right-click a text, shape, SVG clip or a graphic bar | Cmd/Ctrl+Alt+L |
| Open Linked Composition | Clip menu; double-click the graphic bar; right-click it; Inspector "Open composition" | Cmd/Ctrl+Alt+O |
| Render and Replace | Clip menu; right-click the bar; Inspector | Cmd/Ctrl+Alt+Shift+R |
| Restore Unrendered | Clip menu; right-click the rendered clip; Inspector | Cmd/Ctrl+Alt+Shift+U |

**Replace with Linked Composition.** Select text, shape or SVG clips (or one existing graphic). They move into a new composition and are replaced by one live instance spanning them; their keyframes, text animations and text and colour controls are carried over. Video, image and audio clips cannot become composition layers (a composition is a graphics document): the command says so and points to Nest. In a mixed selection the graphics are replaced and the rest stay where they were, with a notice.

**Editing.** The composition window shows the master with the Essential Graphics editor: layers, alignment, pinning, responsive design, and "Expose as control". Each change is sent to the editor window, applied to the project as one undoable step, and shown on the timeline immediately. Undo in the editor window also undoes it, and the composition window follows. Editing the master from Essential Graphics > Edit on a linked graphic does the same.

- **Web:** the window is a pop-up of the same app (`#/composition/<id>`) talking to the editor over a `BroadcastChannel`. Allow pop-ups for the site.
- **Desktop:** a second Electron window. The main process opens it and relays validated messages between the two windows over IPC (`linkedComp` in the preload bridge), so edits reach the editor window's stores through the same bridge as the other desktop features. Closing the editor window closes its composition windows.

A change made in the window on an outdated revision (you edited the same composition in the editor at the same time) is refused and the window shows the editor's current version with a notice. Controls you did not customise on an instance follow a changed default in the master; controls you did customise keep their value.

**Master properties.** Controls exposed in the composition appear on every instance in the Inspector. Number controls for opacity, rotation and X/Y position (the "Opacity", "Rotation", "X position", "Y position" expose buttons) can be keyframed on the instance: the diamond adds or removes a keyframe at the playhead, editing an animated control keys the playhead time, and "n keys x" stops animating. Keyframes are in seconds from the instance start, use the editor's easings, and become ordinary clip keyframes on the layer.

**Render and Replace.** Renders the composition's layers (alone) over the instance's span with the normal exporter, imports the file into the project, and swaps the live layers for that one media clip. Restore Unrendered removes the clip and brings the live layers back where the clip now is (move or trim the clip and the layers follow). If you edit the composition after rendering, the rendered clip is marked out of date. Desktop renders ProRes 4444 with alpha; the browser renders opaque H.264.

Every operation above is exactly one undo step. (Importing the rendered file into the media library is not part of history, like any import; the swap is.)

## Interchange (XML, FCPXML, EDL, OTIO, AAF)

None of these formats carries graphics, so a linked composition is flattened on export and the export report says so, once per composition rather than once per layer:

- **Rendered** composition: exported as its rendered media clip (reported as "approximated: flattened to its rendered clip", and "out of date" if edited after rendering).
- **Live** composition: cannot be flattened without a render, so it is left out and reported as dropped with the instruction to Render and Replace first. Export does not render it for you.

## Verification

- `packages/core/src/linked-comps/*.test.ts`: creation, Replace, master edits, control follow/keep, keyframes (interpolated values compared numerically against the clip keyframes and the expected values), preview == export (a live-edited project against a fresh expansion of its saved document at sampled times), Render and Replace / Restore round trip, interchange report, and one undo step per operation through the real action executor.
- `apps/web/src/services/linked-comp.test.ts`: the commands in the project store, the window host (edit, stale revision, invalid template, undo reaching the window) and the message protocol.
- `apps/desktop/test/linked-comp-hub.test.ts`: IPC contract and relay rules.
- `apps/web/e2e/linked-compositions.spec.ts`: the user flow in Chrome.

See [known-limitations.md](known-limitations.md) for what is not covered.
