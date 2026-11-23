testsrc2-frames-128x72.rgba.gz: gzip of 28 raw RGBA 128x72 frames, in this order:
 0-11  testsrc2 frames 0..11
 12-15 testsrc2 frames 20, 25, 30, 39 (same scene, seconds apart)
 16-27 pairs (frame 0, frame 2) of: testsrc2,hflip,vflip / rgbtestsrc / smptebars / mandelbrot / gradients seed=3 / testsrc2,negate

Made with: ffmpeg -f lavfi -i "<source>=size=128x72:rate=24" -frames:v N -pix_fmt rgba -f rawvideo out.raw
