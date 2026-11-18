#!/usr/bin/env python3
"""Generate tiny local Main10 fixtures from HDR transfer equations, without downloads.

PQ RGB values represent absolute BT.2020-primary luminance in nits (1000-nit peak).
HLG RGB values are scene-linear fractions, passed through the ARIB STD-B67 OETF.
The encoded samples are 10-bit BT.2020 non-constant-luminance limited-range YCbCr;
these are not SDR pixels relabeled with HDR metadata.
"""
import array
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / 'Openreel Video Android/app/src/androidTest/assets'
WIDTH, HEIGHT, FPS = 320, 180, 30


def pq(value):
    linear = max(0.0, value / 10000.0) ** (2610.0 / 16384.0)
    return ((3424.0 / 4096.0 + 2413.0 / 128.0 * linear) /
            (1.0 + 2392.0 / 128.0 * linear)) ** (2523.0 / 32.0)


def hlg(value):
    a = 0.17883277
    b = 1.0 - 4.0 * a
    c = 0.5 - a * math.log(4.0 * a)
    return math.sqrt(3.0 * value) if value <= 1.0 / 12.0 else a * math.log(12.0 * value - b) + c


def fixture_frame(transfer):
    top = [(n, n, n) for n in (0.1, 10.0, 100.0, 400.0, 1000.0)]
    bottom = [(100.0, 0.0, 0.0), (0.0, 100.0, 0.0), (0.0, 0.0, 100.0), (50.0, 50.0, 50.0), (0.0, 0.0, 0.0)]
    transform = pq if transfer == 'pq' else lambda n: hlg(n / 1000.0)
    patches = []
    for colors in (top, bottom):
        row = []
        for color in colors:
            red, green, blue = map(transform, color)
            luma = 0.2627 * red + 0.6780 * green + 0.0593 * blue
            cb = (blue - luma) / (2.0 * (1.0 - 0.0593))
            cr = (red - luma) / (2.0 * (1.0 - 0.2627))
            row.append((round(64 + 876 * luma), round(512 + 896 * cb), round(512 + 896 * cr)))
        patches.append(row)
    values = array.array('H')
    for channel, scale in ((0, 1), (1, 2), (2, 2)):
        for y in range(HEIGHT // scale):
            for x in range(WIDTH // scale):
                value = patches[(y * scale) // (HEIGHT // 2)][min(4, (x * scale) // (WIDTH // 5))][channel]
                values.append(max(0, min(1023, value)))
    if sys.byteorder != 'little':
        values.byteswap()
    return values.tobytes()


def main():
    ffmpeg = shutil.which('ffmpeg')
    ffprobe = shutil.which('ffprobe')
    if not ffmpeg or not ffprobe:
        raise SystemExit('Local ffmpeg with libx265 and ffprobe are required.')
    manifest = {'source': 'Analytical PQ / HLG BT.2020 RGB to 10-bit limited-range YCbCr',
                'dimensions': [WIDTH, HEIGHT], 'frames': FPS, 'durationSeconds': 1,
                'grayscalePatchNitsPq': [0.1, 10, 100, 400, 1000],
                'grayscaleSceneLinearHlg': [0.0001, 0.01, 0.1, 0.4, 1.0], 'fixtures': {}}
    with tempfile.TemporaryDirectory(prefix='openreel-hdr-fixture-') as temporary:
        for transfer, color_transfer in (('pq', 'smpte2084'), ('hlg', 'arib-std-b67')):
            raw = Path(temporary) / f'{transfer}.yuv'
            raw.write_bytes(fixture_frame(transfer) * FPS)
            target = DESTINATION / f'checklist-hdr-{transfer}.mp4'
            parameters = f'pools=1:frame-threads=1:wpp=0:log-level=error:repeat-headers=1:colorprim=9:transfer={16 if transfer == "pq" else 18}:colormatrix=9'
            if transfer == 'pq':
                parameters += ':hdr10=1:master-display=G(8500,39850)B(6550,2300)R(35400,14600)WP(15635,16450)L(10000000,1):max-cll=1000,400'
            command = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo',
                       '-pixel_format', 'yuv420p10le', '-video_size', f'{WIDTH}x{HEIGHT}',
                       '-framerate', str(FPS), '-i', str(raw), '-an', '-c:v', 'libx265',
                       '-preset', 'ultrafast', '-crf', '18', '-profile:v', 'main10',
                       '-x265-params', parameters, '-color_primaries', 'bt2020',
                       '-color_trc', color_transfer, '-colorspace', 'bt2020nc',
                       '-color_range', 'tv', '-tag:v', 'hvc1', '-movflags', '+faststart', str(target)]
            subprocess.run(command, check=True)
            probe = json.loads(subprocess.check_output([ffprobe, '-v', 'error', '-select_streams', 'v:0',
                '-show_entries', 'stream=codec_name,profile,pix_fmt,width,height,color_range,color_space,color_transfer,color_primaries,duration,nb_frames', '-of', 'json', str(target)]))['streams'][0]
            assert probe['codec_name'] == 'hevc' and probe['profile'] == 'Main 10'
            assert probe['pix_fmt'] == 'yuv420p10le' and probe['color_transfer'] == color_transfer
            assert probe['color_primaries'] == 'bt2020' and probe['nb_frames'] == str(FPS)
            manifest['fixtures'][target.name] = {'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'ffprobe': probe}
            print(target.name, probe)
    (DESTINATION / 'checklist-hdr-fixtures.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
