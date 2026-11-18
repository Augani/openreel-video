// Duotone Map: pure JavaScript, no I/O. Runs inside the plugin sandbox Worker.
// process(frame, params, host) edits frame.data (straight RGBA) in place.

function process(frame, params) {
  var d = frame.data;
  var s = params.shadows;
  var h = params.highlights;
  var k = params.intensity;
  var c = params.contrast;
  var average = params.mode === "average";
  var invert = params.invert === true;
  for (var i = 0; i < d.length; i += 4) {
    var r = d[i];
    var g = d[i + 1];
    var b = d[i + 2];
    var l = average ? (r + g + b) / 765 : (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    l = (l - 0.5) * c + 0.5;
    l = l < 0 ? 0 : l > 1 ? 1 : l;
    if (invert) l = 1 - l;
    var mr = (s.r + (h.r - s.r) * l) * 255;
    var mg = (s.g + (h.g - s.g) * l) * 255;
    var mb = (s.b + (h.b - s.b) * l) * 255;
    d[i] = r + (mr - r) * k;
    d[i + 1] = g + (mg - g) * k;
    d[i + 2] = b + (mb - b) * k;
  }
}
