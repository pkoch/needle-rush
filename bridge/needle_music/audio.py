"""The shared, bounded MP3 encoding contract for every clip source."""
import json
import math
import os
from pathlib import Path
import re
import subprocess

from .errors import Unavailable


def encode(source_path, offset, target):
    if isinstance(offset, bool) or not isinstance(offset, (int, float)) or not math.isfinite(offset) or offset < 0:
        raise Unavailable('Invalid excerpt offset')
    try:
        source_path = Path(source_path).resolve(strict=True)
        if not source_path.is_file():
            raise OSError()
    except (OSError, ValueError):
        raise Unavailable('Source audio must be an available local file') from None
    target = Path(target)
    temp = target.with_suffix('.part.mp3')
    # Measure the excerpt at delivery rate, then apply gain and a peak limiter.
    # Dynamic loudnorm internally upsamples to 192 kHz; avoid that costly path.
    source = [
        'ffmpeg', '-nostdin', '-hide_banner', '-threads', '1', '-filter_threads', '1',
        '-ss', str(offset), '-t', '30', '-i', str(source_path), '-vn', '-map', '0:a:0',
    ]
    try:
        measured = subprocess.run(
            source + ['-af', 'aresample=44100,aformat=channel_layouts=stereo,ebur128=peak=sample:framelog=quiet',
                      '-f', 'null', '-'],
            check=True, timeout=120, capture_output=True, text=True,
        )
        values = re.findall(r'I:\s+(-?[\d.]+) LUFS', measured.stderr)
        if not values:
            raise Unavailable('Clip loudness measurement failed')
        loudness = float(values[-1])
        if not math.isfinite(loudness):
            raise Unavailable('Clip loudness measurement failed')
        gain = min(20.0, -16.0 - loudness)
        audio_filter = (
            f'aresample=44100,aformat=channel_layouts=stereo,volume={gain:.3f}dB,'
            'alimiter=limit=0.841395:level=false:latency=true'
        )
        args = source + [
            '-loglevel', 'error', '-t', '30', '-map_metadata', '-1', '-af', audio_filter,
            '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-threads', '1', '-b:a', '192k',
            '-y', str(temp),
        ]
        subprocess.run(args, check=True, timeout=120, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        check = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration:format_tags', '-of', 'json', str(temp)],
            check=True, timeout=20, capture_output=True,
        )
        result = json.loads(check.stdout)
        if not 29.8 <= float(result['format']['duration']) <= 30.3 or not 1000 <= temp.stat().st_size <= 2097152:
            raise Unavailable('Clip validation failed')
        if any(key.lower() != 'encoder' for key in result['format'].get('tags', {})):
            raise Unavailable('Clip retained identifying tags')
        os.replace(temp, target)
    except (subprocess.SubprocessError, OSError, ValueError, KeyError):
        raise Unavailable('Clip conversion or validation failed') from None
    finally:
        if temp.exists():
            temp.unlink()
