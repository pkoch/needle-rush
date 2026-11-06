"""A second provider used only by tests; it needs no Jellyfin configuration."""
from contextlib import contextmanager
from pathlib import Path

from needle_music.model import Track


class FixtureSource:
    def __init__(self, source_id='fixture', count=8, tracks=None):
        self.source_id = source_id
        self.tracks = tracks if tracks is not None else [
            Track(str(i), f'Song {i}', 'Artist', 80,
                  {'privateId': f'private-{i}'}) for i in range(count)
        ]
        self.catalog_calls = 0
        self.opened = []
        self.closed = []
        self.artwork_calls = []

    def catalog(self):
        self.catalog_calls += 1
        return self.tracks

    @contextmanager
    def audio_file(self, track_id, reference, work_dir):
        self.opened.append((track_id, reference))
        path = Path(work_dir) / 'fixture.wav'
        path.write_bytes(b'fixture input')
        try:
            yield path
        finally:
            path.unlink()
            self.closed.append(track_id)

    def artwork(self, track_id, reference):
        self.artwork_calls.append((track_id, reference))
        return b'\xff\xd8\xff' + b'fixture' * 30
