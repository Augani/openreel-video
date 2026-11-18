// Prism Aberration: channel split along `angle`, scaled by distance from `center`.

fn effect(uv: vec2<f32>, src: vec4<f32>) -> vec4<f32> {
  let dir = vec2<f32>(cos(params.angle), sin(params.angle));
  let radial = mix(1.0, clamp(length(uv - params.center) * 2.0, 0.0, 2.0), params.falloff);
  let offset = dir * (params.amount * radial) / host.resolution;

  let plus = orSample(uv + offset);
  let minus = orSample(uv - offset);

  var rgb = src.rgb;
  if (params.channels == 0) {
    rgb = vec3<f32>(plus.r, src.g, minus.b);
  } else if (params.channels == 1) {
    rgb = vec3<f32>(plus.r, minus.g, src.b);
  } else {
    rgb = vec3<f32>(src.r, plus.g, minus.b);
  }
  return vec4<f32>(rgb, src.a);
}
