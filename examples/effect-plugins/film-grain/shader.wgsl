// Film Grain Pro: animated grain, strongest in the midtones.
// Grain is a pure function of (pixel cell, frame) so preview and export agree.

fn effect(uv: vec2<f32>, src: vec4<f32>) -> vec4<f32> {
  let cell = floor(uv * host.resolution / max(params.size, 1.0));
  let t = host.frame * 17.0;
  let n = orHash21(cell + vec2<f32>(t, t * 0.37)) - 0.5;

  var grain = vec3<f32>(n, n, n);
  if (params.colored != 0u) {
    grain = vec3<f32>(
      n,
      orHash21(cell + vec2<f32>(t + 11.0, 3.0)) - 0.5,
      orHash21(cell + vec2<f32>(5.0, t + 23.0)) - 0.5,
    );
  }

  let luma = dot(src.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  let response = mix(1.0, 4.0 * luma * (1.0 - luma), params.midtones);
  let rgb = clamp(src.rgb + grain * params.amount * response, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(rgb, src.a);
}
