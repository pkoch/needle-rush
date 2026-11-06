"""Resumable job orchestration; source APIs and audio processing live elsewhere."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import time

from .artwork import sync_covers
from .audio import encode
from .errors import RemoteError, Unavailable
from .quiz import plan, public_question
from .site_client import SiteClient
from .sources import load_sources
from .state import private_json, save


def prepare_job(job, state, sources, api):
    if not isinstance(job.get('id'), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', job['id']):
        raise Unavailable('Invalid preparation job')
    folder = Path(state) / job['id']
    folder.mkdir(exist_ok=True, mode=0o700)
    manifest = folder / 'manifest.json'
    if manifest.exists():
        questions = private_json(manifest)
    else:
        started = time.monotonic()
        pool = sources.catalog(job.get('excluded', []))
        print(f'Catalog ready in {time.monotonic() - started:.1f}s', flush=True)
        questions = plan(pool, count=job.get('count', 22), start_slot=job.get('startSlot', 1))
        save(manifest, questions)
    # A resumed job must not silently generate a different pack or upload local state.
    count, first = job.get('count', 22), job.get('startSlot', 1)
    if (type(count) is not int or count < 1 or type(first) is not int or first < 1
            or not isinstance(questions, list) or len(questions) != count
            or not all(isinstance(question, dict) for question in questions)
            or [q.get('slot') for q in questions] != list(range(first, first + count))):
        raise Unavailable('Preparation manifest does not match the claimed job')
    for question in questions:
        clip = folder / (str(question['slot']) + '.mp3')
        started = time.monotonic()
        if not clip.exists():
            source, track_id, reference = sources.resolve(question)
            with tempfile.TemporaryDirectory(prefix='source-', dir=folder) as scratch:
                with source.audio_file(track_id, reference, Path(scratch)) as audio_path:
                    encode(audio_path, question['offset'], clip)
        encoded_at = time.monotonic()
        data = clip.read_bytes()
        if not 1000 <= len(data) <= 2097152:
            raise Unavailable('Prepared clip size is outside the delivery contract')
        payload = public_question(question, hashlib.sha256(data).hexdigest())
        api(f"jobs/{job['id']}/question", payload, job['lease'])
        api(f"jobs/{job['id']}/clip/{question['slot']}", data, job['lease'], True)
        print(f"Clip {question['slot'] - first + 1}/{count} ready: "
              f'encode {encoded_at - started:.1f}s, upload {time.monotonic() - encoded_at:.1f}s', flush=True)
    api(f"jobs/{job['id']}/finish", {}, job['lease'])
    print('Preparation complete: ' + str(len(questions)) + ' verified clips', flush=True)


def run(config_path, state, once=False, covers_only=False, *, sources=None, api=None):
    config = private_json(config_path)
    api = SiteClient(config) if api is None else api
    sources = load_sources(config) if sources is None else sources
    state = Path(state)
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(state, 0o700)
    if covers_only:
        print('Artwork sync: ' + json.dumps(sync_covers(sources, state, api)), flush=True)
        return
    last_cleanup, last_covers, job = 0, 0, None
    while True:
        try:
            if time.monotonic() - last_cleanup > 300:
                api('cleanup', {})
                last_cleanup = time.monotonic()
                for path in state.iterdir():
                    if path.is_dir() and not path.is_symlink() and time.time() - path.stat().st_mtime > 86400:
                        shutil.rmtree(path)
            if job is None:
                job = api('claim', {}).get('job')
            # New music always takes priority over optional artwork backfill.
            if job is None and time.monotonic() - last_covers > 30:
                try:
                    sync_covers(sources, state, api)
                except Exception:
                    print('Artwork sync unavailable; will retry', flush=True)
                last_covers = time.monotonic()
            if job:
                prepare_job(job, state, sources, api)
                job = None
        except RemoteError as error:
            if error.status == 409 or (job and 400 <= error.status < 500 and error.status != 429):
                if job:
                    try:
                        api(f"jobs/{job['id']}/fail", {}, job['lease'])
                    except Unavailable:
                        pass
                job = None
            print(str(error), flush=True)
        except Unavailable as error:
            if job:
                try:
                    api(f"jobs/{job['id']}/fail", {}, job['lease'])
                except Unavailable:
                    pass
                job = None
            print(str(error), flush=True)
        except Exception:
            print('Preparation failed; details suppressed to protect source credentials', flush=True)
        if once:
            return
        time.sleep(5)
