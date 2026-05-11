#!/bin/bash
# Upload FFmpeg vidstab core files to Cloudflare R2
# Bucket: pub-openreel (or your bucket name)
# Path prefix: ffmpeg-vidstab/

BUCKET="pub-openreel"
MT_DIR="/tmp/vidstab/mt/dist/esm"
ST_DIR="/tmp/vidstab/st/dist/esm"

echo "Uploading multi-threaded core..."
wrangler r2 object put "$BUCKET/ffmpeg-vidstab/mt/ffmpeg-core.js" --file "$MT_DIR/ffmpeg-core.js" --content-type "text/javascript"
wrangler r2 object put "$BUCKET/ffmpeg-vidstab/mt/ffmpeg-core.wasm" --file "$MT_DIR/ffmpeg-core.wasm" --content-type "application/wasm"
wrangler r2 object put "$BUCKET/ffmpeg-vidstab/mt/ffmpeg-core.worker.js" --file "$MT_DIR/ffmpeg-core.worker.js" --content-type "text/javascript"

echo "Uploading single-threaded core..."
wrangler r2 object put "$BUCKET/ffmpeg-vidstab/st/ffmpeg-core.js" --file "$ST_DIR/ffmpeg-core.js" --content-type "text/javascript"
wrangler r2 object put "$BUCKET/ffmpeg-vidstab/st/ffmpeg-core.wasm" --file "$ST_DIR/ffmpeg-core.wasm" --content-type "application/wasm"

echo "Done! Files available at:"
echo "  https://pub-openreel.r2.dev/ffmpeg-vidstab/mt/"
echo "  https://pub-openreel.r2.dev/ffmpeg-vidstab/st/"
