"""Private source identity and the explicit contract for exportable audio.

Catalog access alone is insufficient: the current game needs sources that can
supply audio for normalized, cached excerpts. SDK-only playback is a different
transport and must not be passed to the clip encoder as if it were a file.
"""
from dataclasses import dataclass
from pathlib import Path
from typing import Any, ContextManager, Iterable, Mapping, Protocol, runtime_checkable
import math
import unicodedata


@dataclass(frozen=True)
class Track:
    track_id: str
    title: str
    artist: str
    duration: float
    reference: Mapping[str, Any]


@dataclass(frozen=True)
class SourcedTrack:
    source_id: str
    track: Track


class CatalogSource(Protocol):
    source_id: str

    def catalog(self) -> Iterable[Track]: ...


@runtime_checkable
class ClipSource(CatalogSource, Protocol):
    """Provider code owns private references; only temporary local audio leaves it.

    audio_file must yield a local file and clean up any downloaded material when
    its context exits. Borrowed library originals must never be deleted/modified.
    artwork returns a bounded JPEG, None for absence, or raises on transient errors.
    Credentials belong in provider configuration, never in a track reference.
    """

    def audio_file(self, track_id: str, reference: Mapping[str, Any],
                   work_dir: Path) -> ContextManager[Path]: ...

    def artwork(self, track_id: str, reference: Mapping[str, Any]) -> bytes | None: ...


def song_key(artist, title):
    return (unicodedata.normalize('NFKC', artist).casefold(),
            unicodedata.normalize('NFKC', title).casefold())


def eligible_track(track):
    return (
        isinstance(track, Track)
        and isinstance(track.track_id, str) and bool(track.track_id)
        and isinstance(track.title, str) and bool(track.title.strip()) and len(track.title) <= 300
        and isinstance(track.artist, str) and bool(track.artist.strip()) and len(track.artist) <= 300
        and isinstance(track.duration, (int, float)) and not isinstance(track.duration, bool)
        and math.isfinite(track.duration) and track.duration >= 45
        and isinstance(track.reference, Mapping)
    )
