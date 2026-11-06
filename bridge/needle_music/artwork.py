"""Optional artwork jobs use the same saved provider identity as audio jobs."""
from pathlib import Path
import re

from .errors import Unavailable
from .state import private_json


def sync_covers(sources, state, api):
    pending = api('covers/pending', {}).get('covers', [])
    if not isinstance(pending, list) or len(pending) > 12:
        raise Unavailable('Artwork batch exceeded bound')
    ready, missing = 0, 0
    for entry in pending:
        job = str(entry.get('jobId', ''))
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', job):
            raise Unavailable('Invalid artwork job')
        manifest = Path(state) / job / 'manifest.json'
        questions = private_json(manifest) if manifest.exists() else []
        question = next((q for q in questions if q.get('slot') == entry.get('slot')), None)
        data = None
        if question:
            source, track_id, reference = sources.resolve(question)
            data = source.artwork(track_id, reference)
        if data is None:
            api('covers/' + entry['id'], {'missing': True})
            missing += 1
        else:
            if not isinstance(data, bytes) or not 100 <= len(data) <= 524288 or not data.startswith(b'\xff\xd8\xff'):
                raise Unavailable('Source artwork must be a bounded JPEG')
            api('covers/' + entry['id'], data, binary=True, content_type='image/jpeg')
            ready += 1
    return {'ready': ready, 'missing': missing}
