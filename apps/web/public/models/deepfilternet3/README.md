# DeepFilterNet3 (speech enhancement)

On-device dialogue enhancement (noise and room-reverb removal) for the "Enhance Speech" audio effect.

- Model: DeepFilterNet3, Hendrik Schroeter et al. https://github.com/Rikorose/DeepFilterNet
- Weights: `models/DeepFilterNet3_onnx.tar.gz` from that repository (ONNX export of the pretrained DFN3 checkpoint)
- Licence: MIT OR Apache-2.0 (upstream is dual licensed; the MIT text is in `LICENSE-MIT`)
- Size: enc.onnx 1.9 MB + erb_dec.onnx 3.3 MB + df_dec.onnx 3.3 MB = 8.6 MB (fetched once, on first use, never in the entry bundle)
- Runtime: onnxruntime-web (WASM, CPU). 48 kHz mono, 10 ms hop, 20 ms look-ahead. No network access is needed once the files are cached.
- SHA-256:
  - enc.onnx      7c5399d3da8a50ebef1c1a0ae421b33376aa5e45d0e92df16da7e83c9c131916
  - erb_dec.onnx  ab669a1d10afe20911728b33053a452071042317a90581092b325da7b2f9d895
  - df_dec.onnx   23114ce3b0f6464b763ee62f7bb8aab6b2a129a21eabd5bcfe59413db05f278a

The STFT, ERB features, running normalisation, mask and deep-filter application are re-implemented in
`packages/core/src/audio/enhance/dfn3-dsp.ts`; only the three neural graphs come from upstream.
