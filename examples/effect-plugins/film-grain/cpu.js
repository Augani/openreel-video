// CPU fallback for Film Grain Pro: same algorithm as shader.wgsl.
// Used when WebGPU is unavailable or the shader failed to compile.

function hash21(x, y) {
  var qx = x * 123.34 - Math.floor(x * 123.34);
  var qy = y * 456.21 - Math.floor(y * 456.21);
  var d = qx * (qx + 45.32) + qy * (qy + 45.32);
  qx += d;
  qy += d;
  var v = qx * qy;
  return v - Math.floor(v);
}

function process(frame, params, host) {
  var w = frame.width;
  var h = frame.height;
  var d = frame.data;
  var size = Math.max(params.size, 1);
  var t = host.frame * 17;
  var amount = params.amount;
  var colored = params.colored === true;
  for (var y = 0; y < h; y++) {
    var cy = Math.floor(((y + 0.5) / h) * h / size);
    for (var x = 0; x < w; x++) {
      var cx = Math.floor(((x + 0.5) / w) * w / size);
      var n = hash21(cx + t, cy + t * 0.37) - 0.5;
      var gr = n;
      var gg = n;
      var gb = n;
      if (colored) {
        gg = hash21(cx + t + 11, cy + 3) - 0.5;
        gb = hash21(cx + 5, cy + t + 23) - 0.5;
      }
      var i = (y * w + x) * 4;
      var r = d[i] / 255;
      var g = d[i + 1] / 255;
      var b = d[i + 2] / 255;
      var luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      var response = 1 + (4 * luma * (1 - luma) - 1) * params.midtones;
      var k = amount * response * 255;
      d[i] = d[i] + gr * k;
      d[i + 1] = d[i + 1] + gg * k;
      d[i + 2] = d[i + 2] + gb * k;
    }
  }
}
