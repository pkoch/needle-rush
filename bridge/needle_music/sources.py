"""Source registration, cross-source deduplication and persisted source routing."""
import re

from .errors import Unavailable
from .jellyfin import JellyfinSource
from .model import ClipSource, SourcedTrack, eligible_track, song_key

SOURCE_FACTORIES = {'jellyfin': JellyfinSource}
IDENTIFIER = re.compile(r'[a-z][a-z0-9_-]{0,63}')


class Sources:
    def __init__(self, sources, legacy_source_id=None):
        self.by_id = {}
        for source in sources:
            if not isinstance(source, ClipSource):
                raise Unavailable('This source cannot supply prepared clips; catalog or SDK playback alone is insufficient')
            if not isinstance(source.source_id, str) or not IDENTIFIER.fullmatch(source.source_id) or source.source_id in self.by_id:
                raise Unavailable('Source IDs must be unique stable identifiers')
            self.by_id[source.source_id] = source
        self.legacy_source_id = legacy_source_id
        if legacy_source_id is not None and legacy_source_id not in self.by_id:
            raise Unavailable('Legacy source ID is not configured')

    def catalog(self, excluded=()):
        exclusions = {song_key(item['artist'], item['title']) for item in excluded}
        unique = {}
        for source_id, source in self.by_id.items():
            for index, track in enumerate(source.catalog()):
                if index >= 100000:
                    raise Unavailable('Source catalog exceeded bound')
                if eligible_track(track):
                    label = song_key(track.artist, track.title)
                    if label not in exclusions:
                        unique.setdefault(label, SourcedTrack(source_id, track))
        return list(unique.values())

    def resolve(self, question):
        saved = question.get('source')
        if saved is None:
            # v32 manifests keep source fields at top level. Do not rewrite them:
            # accepted questions/clip hashes must remain identical when resumed.
            source_id = self.legacy_source_id
            reference = {key: question.get(key) for key in ('path', 'itemId', 'albumId')}
            track_id = str(question.get('itemId') or question.get('path') or '')
        else:
            if not isinstance(saved, dict) or saved.get('version') != 1:
                raise Unavailable('Unsupported source reference in preparation manifest')
            source_id, reference, track_id = saved.get('id'), saved.get('reference'), saved.get('trackId')
            if not isinstance(reference, dict) or not isinstance(track_id, str) or not track_id:
                raise Unavailable('Invalid source reference in preparation manifest')
        if not isinstance(source_id, str) or source_id not in self.by_id:
            raise Unavailable('A source required by this preparation is not configured')
        return self.by_id[source_id], track_id, reference


def load_sources(config, factories=None):
    factories = SOURCE_FACTORIES if factories is None else factories
    settings = config.get('sources')
    if settings is None:
        # Existing installations require no configuration or service command change.
        settings = [{'id': 'jellyfin', 'type': 'jellyfin',
                     'jellyfin_key_path': config.get('jellyfin_key_path'),
                     'media_root': config.get('media_root', '/srv/media/Music')}]
    if not isinstance(settings, list) or not 1 <= len(settings) <= 16:
        raise Unavailable('Configure between one and sixteen music sources')
    sources, ids, jellyfin_ids = [], set(), []
    for setting in settings:
        if not isinstance(setting, dict):
            raise Unavailable('Invalid source configuration')
        source_id, kind = setting.get('id'), setting.get('type')
        if not isinstance(source_id, str) or not IDENTIFIER.fullmatch(source_id) or source_id in ids:
            raise Unavailable('Source IDs must be unique stable identifiers')
        if not isinstance(kind, str) or kind not in factories:
            raise Unavailable('Unknown music source type; install a supported source adapter first')
        if kind == 'jellyfin' and (not isinstance(setting.get('jellyfin_key_path'), str) or not setting['jellyfin_key_path']):
            raise Unavailable('Jellyfin requires a private credential file path')
        source = factories[kind](source_id, setting)
        if source.source_id != source_id:
            raise Unavailable('Source adapter returned a different configured ID')
        sources.append(source)
        ids.add(source_id)
        if kind == 'jellyfin':
            jellyfin_ids.append(source_id)
    legacy = config.get('legacy_source_id')
    if legacy is None:
        legacy = 'jellyfin' if 'jellyfin' in jellyfin_ids else jellyfin_ids[0] if len(jellyfin_ids) == 1 else None
    if legacy is not None and (not isinstance(legacy, str) or legacy not in jellyfin_ids):
        raise Unavailable('Legacy manifests require an explicit Jellyfin source ID')
    return Sources(sources, legacy)
