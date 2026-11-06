# Needle Rush outbound music worker

This worker prepares private music excerpts for the existing Sites game. It opens no inbound service. Source discovery, file access, artwork, quiz planning, encoding, and delivery are separate modules in `needle_music/`. Jellyfin remains the only production adapter included in this release.

The refactor preserves v32's game and delivery contract: the server requests a clip count (currently 12: ten rounds plus two reserves); the worker chooses distinct eligible songs, persists an owner-private manifest, and uploads questions and 30-second MP3 clips with checksums and leases. The frontend, scoring, timers, migrations, and original Site identity are unchanged. This change does not add music-service login, artist selection, preview playback, or automatic round timeouts. See [SOURCE-INTEGRATION.md](SOURCE-INTEGRATION.md) for those next steps.

## Installation and compatibility

Use Python 3.10 or later and install `ffmpeg` and `ffprobe`. There are no third-party Python packages.

Deploy the **whole `bridge/` directory**, including `needle_music/`, to the existing bridge installation directory. Replacing only `bridge.py` will fail. Preserve the protected configuration, credentials, and state directories outside this source tree. Stop the existing service before replacing its code, then restart and verify one preparation job. The existing service command and flags remain valid:

```sh
python3 bridge.py --config /protected/connector.json --state /private/needle-rush-state
python3 bridge.py --config /protected/connector.json --state /private/needle-rush-state --once
python3 bridge.py --config /protected/connector.json --state /private/needle-rush-state --covers-only
```

The configuration and referenced Jellyfin credential must be regular files owned by the service user with mode `0600`. The state directory uses `0700`. Keep real credentials out of source and uploaded manifests.

Existing configuration works without modification:

```json
{
  "site_url": "https://your-existing-site.example",
  "connector_secret": "PROVISION_PRIVATELY",
  "jellyfin_key_path": "/protected/jellyfin-key",
  "media_root": "/srv/media/Music"
}
```

Jellyfin defaults to `http://127.0.0.1:8096`. Files under its `/media/Music/` container mount map into `media_root`. The worker reads media from this local filesystem; setting a remote Jellyfin URL alone does not transfer the audio.

For explicit source configuration:

```json
{
  "site_url": "https://your-existing-site.example",
  "connector_secret": "PROVISION_PRIVATELY",
  "legacy_source_id": "home",
  "sources": [
    {
      "id": "home",
      "type": "jellyfin",
      "jellyfin_key_path": "/protected/jellyfin-key",
      "media_root": "/srv/media/Music",
      "base_url": "http://127.0.0.1:8096"
    }
  ]
}
```

Source IDs are stable persisted identities. Do not rename or remove them while their preparation state is needed. Legacy v32 manifests are read without rewriting or reselecting songs. `legacy_source_id` identifies the original Jellyfin instance; it is inferred when there is only one or its ID is `jellyfin`. Set it explicitly if multiple instances would make old manifests ambiguous. Remote Jellyfin API connections require HTTPS.

The unchanged service template retains `CPUQuota=25%`, `MemoryMax=256M`, `TasksMax=32`, `Nice=10`, owner-only state, and a read-only filesystem apart from that state directory. Preserve these resource limits and thermal controls. Create the state directory before starting the unit.

## Responsibilities and limits

- `jellyfin.py`: bounded catalog pagination, local path checks, and artwork from exact source IDs.
- `model.py` / `sources.py`: source capabilities, stable identity, normalized tracks, and cross-source deduplication.
- `quiz.py`: selection, distractors, offsets, and an explicit upload-field whitelist.
- `audio.py`: sequential, single-threaded, normalized 30-second MP3 encoding; metadata stripping and duration/size checks.
- `state.py` / `worker.py`: private atomic manifests, preparation, retries, and cleanup.
- `site_client.py` / `http.py`: the existing Sites protocol and bounded authenticated requests.
- `artwork.py`: optional batches of at most twelve JPEG thumbnails, each at most 512 KiB.

Source IDs, file paths, provider references, and credentials are never added to question uploads. Only answer metadata and opaque prepared media cross the connector boundary. Transient upload failures retry the same saved questions and clips. A missing provider fails rather than silently substituting different music. Artwork backfill runs while idle and does not block audio preparation.

## Verification

From the repository root:

```sh
python3 -m unittest discover -s bridge -v
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 bridge/bridge.py --help
```

The bridge suite includes a second provider fixture, old-manifest resume, identical retry payloads, private-field filtering, catalog failures, exact artwork routing, and cleanup after encoding failures. With FFmpeg installed it also generates synthetic audio and verifies the real encoder's duration, size, metadata, and preservation of the input file. That test skips if either FFmpeg tool is unavailable.

This refactor was verified locally; it has not been installed on the production bridge or deployed to Sites. Live protocol, resource limits under load, and a complete physical party session still need deployment acceptance testing.
