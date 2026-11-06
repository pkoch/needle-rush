"""Jellyfin discovery, private path mapping, and exact-source artwork."""
from contextlib import contextmanager
from pathlib import Path
import re
import urllib.parse

from .errors import RemoteError, Unavailable
from .http import request
from .model import Track, eligible_track, song_key
from .state import private_file


class JellyfinSource:
    def __init__(self, source_id, config):
        self.source_id = source_id
        self.key_path = config['jellyfin_key_path']
        self.root = Path(config.get('media_root', '/srv/media/Music')).resolve()
        self.base_url = config.get('base_url', 'http://127.0.0.1:8096').rstrip('/')
        parsed = urllib.parse.urlparse(self.base_url)
        if (parsed.scheme not in ('http', 'https') or not parsed.hostname
                or parsed.username or parsed.password or parsed.query or parsed.fragment):
            raise Unavailable('Invalid Jellyfin base URL')
        if parsed.scheme == 'http' and parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
            raise Unavailable('Remote Jellyfin connections require HTTPS')
        self._path_lookup = None

    def _headers(self):
        key = private_file(self.key_path).read_text().strip()
        return {'Authorization': 'MediaBrowser Token="' + key + '"'}

    def _items(self):
        total, offset = None, 0
        seen, items = set(), []
        headers = self._headers()
        while total is None or offset < total:
            params = {
                'Recursive': 'true', 'IncludeItemTypes': 'Audio', 'Fields': 'Path',
                'Limit': 500, 'StartIndex': offset, 'EnableTotalRecordCount': 'true',
                'SortBy': 'SortName', 'SortOrder': 'Ascending',
            }
            result = request(self.base_url + '/Items?' + urllib.parse.urlencode(params), headers)
            count, batch = result.get('TotalRecordCount'), result.get('Items')
            if (type(count) is not int or not 0 <= count <= 100000 or not isinstance(batch, list)
                    or len(batch) > 500 or (total is not None and total != count)):
                raise Unavailable('Catalog changed or exceeded bounded pagination')
            total = count
            if not batch and offset < total:
                raise Unavailable('Incomplete catalog page')
            for item in batch:
                ident = item.get('Id')
                if not isinstance(ident, str) or not ident or ident in seen:
                    raise Unavailable('Duplicate or invalid catalog item')
                seen.add(ident)
                items.append(item)
            offset += len(batch)
            if offset > total:
                raise Unavailable('Catalog count mismatch')
        return items

    def _local_path(self, value):
        if not isinstance(value, str) or not value:
            raise Unavailable('Source audio is unavailable')
        path = Path(value)
        try:
            if value.startswith('/media/Music/'):
                path = self.root / path.relative_to('/media/Music')
            path = path.resolve(strict=True)
            path.relative_to(self.root)
            if not path.is_file():
                raise ValueError()
            return path
        except (ValueError, OSError):
            raise Unavailable('Source audio is unavailable or outside its library') from None

    def catalog(self):
        result = {}
        for item in self._items():
            artists, ticks = item.get('Artists'), item.get('RunTimeTicks', 0)
            if (not isinstance(ticks, (int, float)) or isinstance(ticks, bool)
                    or not isinstance(artists, list) or not artists
                    or not all(isinstance(artist, str) and artist.strip() for artist in artists)):
                continue
            try:
                path = self._local_path(item.get('Path'))
            except Unavailable:
                continue
            reference = {'path': str(path), 'itemId': item.get('Id'), 'albumId': item.get('AlbumId')}
            track = Track(str(item.get('Id') or path), item.get('Name'), ', '.join(artists),
                          ticks / 10000000, reference)
            if eligible_track(track):
                result.setdefault(song_key(track.artist, track.title), track)
        tracks = list(result.values())
        self._path_lookup = {track.reference['path']: track.reference for track in tracks}
        return tracks

    @contextmanager
    def audio_file(self, track_id, reference, work_dir):
        # Revalidate even on a resumed manifest; never feed a URL to FFmpeg.
        yield self._local_path(reference.get('path'))

    def artwork(self, track_id, reference):
        reference = dict(reference)
        if not reference.get('itemId') and not reference.get('albumId'):
            if self._path_lookup is None:
                self.catalog()
            reference.update({key: value for key, value in
                              self._path_lookup.get(reference.get('path'), {}).items()
                              if key in ('itemId', 'albumId')})
        candidates = dict.fromkeys(str(reference.get(key) or '') for key in ('albumId', 'itemId'))
        for ident in candidates:
            if not re.fullmatch(r'[a-fA-F0-9-]{32,36}', ident):
                continue
            try:
                data = request(
                    self.base_url + '/Items/' + ident
                    + '/Images/Primary?maxWidth=512&maxHeight=512&quality=85&format=jpg',
                    self._headers(), limit=524288, raw=True,
                )
                if not data.startswith(b'\xff\xd8\xff'):
                    raise Unavailable('Library artwork was not a JPEG')
                return data
            except RemoteError as error:
                if error.status not in (400, 404):
                    raise
        return None
