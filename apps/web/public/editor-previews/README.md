# Editor catalog previews

The raster effect and overlay thumbnails are cropped from the user-supplied authored designs in `new-screens/`. They preserve the reference catalog imagery. The editor frame, controls, text, panels and timeline are rendered React/shadcn UI.

Transition thumbnails reuse the exact original artwork declarations from the detailed **Panel · Transitions** HTML in `ReferenceTransitionPreview.tsx`. Borders, selection and used markers are rendered from current UI/project state, without baked screenshot borders or badges. Hover retains the existing animated media preview.

Media used in verification projects is a local test fixture and is not included in the production media library. Actual project media, generated results and audio waveforms are rendered from their real source data.
