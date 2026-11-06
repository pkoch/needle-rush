import hashlib
import json
from pathlib import Path
import random
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from needle_music.artwork import sync_covers
from needle_music.audio import encode
from needle_music.errors import Unavailable, RemoteError
from needle_music.jellyfin import JellyfinSource
from needle_music.model import Track
from needle_music.quiz import plan
from needle_music.sources import Sources, load_sources
from needle_music.state import private_json, save
from needle_music.worker import prepare_job
from test_support import FixtureSource


class SourceTests(unittest.TestCase):
    def test_legacy_config_and_manifest_resolve_to_original_jellyfin(self):
        sources = load_sources({'jellyfin_key_path': '/private/key', 'media_root': '/music'})
        question = {'slot': 1, 'path': '/music/a.flac', 'itemId': 'a'*32, 'albumId': 'b'*32}
        provider, ident, reference = sources.resolve(question)
        self.assertEqual(provider.source_id, 'jellyfin')
        self.assertEqual(ident, 'a'*32)
        self.assertEqual(reference['path'], '/music/a.flac')
        self.assertEqual(provider.base_url, 'http://127.0.0.1:8096')
        self.assertNotIn('source', question)

    def test_multiple_sources_are_deduplicated_and_excluded_by_song_not_id(self):
        one = FixtureSource('one', tracks=[
            Track('same-id', 'Song', 'ARTIST', 80, {'private': 'one'}),
            Track('two', 'Excluded', 'Artist', 90, {}),
        ])
        two = FixtureSource('two', tracks=[
            Track('different-id', 'Ｓｏｎｇ', 'artist', 80, {}),
            Track('same-id', 'Different', 'Artist', 80, {'private': 'two'}),
            Track('short', 'Short', 'Artist', 20, {}),
            Track('nan', 'Broken', 'Artist', float('nan'), {}),
            Track('inf', 'Broken too', 'Artist', float('inf'), {}),
        ])
        pool = Sources([one, two]).catalog([{'title':'excluded','artist':'artist'}])
        self.assertEqual([(p.source_id,p.track.track_id,p.track.title) for p in pool],
                         [('one','same-id','Song'),('two','same-id','Different')])

    def test_manifest_preserves_source_routing_across_configuration_order(self):
        one, two = FixtureSource('one'), FixtureSource('two')
        question = {'source': {'version':1,'id':'two','trackId':'same-id','reference':{'private':'two'}}}
        for sources in [Sources([one,two]), Sources([two,one])]:
            source, ident, reference = sources.resolve(question)
            self.assertIs(source, two)
            self.assertEqual((ident,reference), ('same-id',{'private':'two'}))
        with self.assertRaises(Unavailable):
            Sources([one]).resolve(question)

    def test_registry_rejects_unknown_duplicate_and_non_clip_sources(self):
        with self.assertRaises(Unavailable):
            load_sources({'sources':[{'id':'x','type':'spotify'}]})
        with self.assertRaises(Unavailable):
            Sources([FixtureSource(),FixtureSource()])
        class CatalogOnly:
            source_id = 'metadata'
            def catalog(self): return []
        with self.assertRaises(Unavailable):
            Sources([CatalogOnly()])

    def test_legacy_mapping_is_explicit_with_multiple_jellyfin_instances(self):
        config = {'sources':[{'id':name,'type':'jellyfin','jellyfin_key_path':'/private/key'} for name in ['home','other']]}
        with self.assertRaises(Unavailable):
            load_sources(config).resolve({'path':'/music/a'})
        source, _, _ = load_sources({**config,'legacy_source_id':'home'}).resolve({'path':'/music/a'})
        self.assertEqual(source.source_id, 'home')

    def test_catalog_failure_is_not_silently_treated_as_an_empty_library(self):
        provider=FixtureSource()
        with patch.object(provider,'catalog',side_effect=RemoteError(503)):
            with self.assertRaises(RemoteError): Sources([provider]).catalog()

    def test_jellyfin_rechecks_root_for_resumed_audio_and_does_not_delete_original(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);music=root/'music';music.mkdir();original=music/'track.flac';original.write_bytes(b'original')
            source=JellyfinSource('jellyfin',{'jellyfin_key_path':'unused','media_root':str(music)})
            with source.audio_file('track',{'path':str(original)},root) as path:
                self.assertEqual(path,original.resolve())
            self.assertEqual(original.read_bytes(),b'original')
            outside=root/'outside';outside.write_bytes(b'private');(music/'link').symlink_to(outside)
            for path in [outside,music/'link']:
                with self.assertRaises(Unavailable):
                    with source.audio_file('track',{'path':str(path)},root): pass

    def test_jellyfin_pagination_fails_on_missing_or_duplicate_pages(self):
        with tempfile.TemporaryDirectory() as directory:
            key=Path(directory)/'key';key.write_text('fixture-secret');key.chmod(0o600)
            provider=JellyfinSource('jellyfin',{'jellyfin_key_path':str(key)})
            cases=[
                [{'TotalRecordCount':2,'Items':[{'Id':'one'}]},{'TotalRecordCount':2,'Items':[]}],
                [{'TotalRecordCount':2,'Items':[{'Id':'one'}]},{'TotalRecordCount':2,'Items':[{'Id':'one'}]}],
            ]
            for pages in cases:
                with patch('needle_music.jellyfin.request',side_effect=pages):
                    with self.assertRaises(Unavailable): provider.catalog()

    def test_new_adapter_needs_no_jellyfin_settings(self):
        def factory(source_id, settings): return FixtureSource(source_id)
        sources=load_sources({'sources':[{'id':'second','type':'fixture'}]}, {'fixture':factory})
        self.assertEqual(len(sources.catalog()),8)


class PipelineTests(unittest.TestCase):
    def test_invalid_saved_manifest_is_rejected_before_any_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory, 'job')
            folder.mkdir()
            save(folder / 'manifest.json', [None])
            calls = []
            with self.assertRaises(Unavailable):
                prepare_job({'id': 'job', 'count': 1, 'startSlot': 1, 'lease': 'lease'},
                            directory, Sources([FixtureSource()]), lambda *args: calls.append(args))
            self.assertEqual(calls, [])

    def test_unavailable_source_is_reported_without_exposing_its_path(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(Unavailable) as error:
                encode(Path(directory, 'missing-private-song'), 5, Path(directory, 'clip.mp3'))
            self.assertNotIn(directory, str(error.exception))
            self.assertNotIn('missing-private-song', str(error.exception))

    def test_prepare_and_resume_keep_payloads_private_and_identical(self):
        with tempfile.TemporaryDirectory() as directory:
            source=FixtureSource();sources=Sources([source]);uploads=[]
            job={'id':'job','count':2,'startSlot':23,'lease':'fixture-lease'}
            def api(path, body, *args, **kwargs): uploads.append((path,body));return {'ok':True}
            def encoded(path, offset, target):
                self.assertTrue(path.is_file());target.write_bytes(b'encoded'*200)
            with patch('needle_music.worker.encode',side_effect=encoded),patch('builtins.print'):
                prepare_job(job,directory,sources,api)
                original=Path(directory,'job','manifest.json').read_bytes()
                first=list(uploads);uploads.clear()
                prepare_job(job,directory,sources,api)
            self.assertEqual(uploads,first)
            self.assertEqual(source.catalog_calls,1)
            self.assertEqual(len(source.opened),2)
            self.assertEqual(len(source.closed),2)
            self.assertEqual(original,Path(directory,'job','manifest.json').read_bytes())
            for path,body in uploads:
                if path.endswith('/question'):
                    self.assertEqual(set(body),{'slot','correctOptionId','sha256','options'})
                    self.assertEqual(body['sha256'],hashlib.sha256(b'encoded'*200).hexdigest())
                    self.assertNotIn('privateId',json.dumps(body))
                    self.assertNotIn('reference',json.dumps(body))
            self.assertEqual(list(Path(directory,'job').glob('source-*')),[])

    def test_provider_artwork_uses_the_saved_reference(self):
        with tempfile.TemporaryDirectory() as directory:
            source=FixtureSource('other');sources=Sources([source]);folder=Path(directory,'job');folder.mkdir()
            questions=plan(sources.catalog(),random.Random(1),count=1)
            save(folder/'manifest.json',questions);uploads=[]
            def api(path,body,**kwargs):
                if path=='covers/pending':return {'covers':[{'id':'round','jobId':'job','slot':1}]}
                uploads.append((path,body,kwargs));return {'ok':True}
            self.assertEqual(sync_covers(sources,directory,api),{'ready':1,'missing':0})
            saved=questions[0]['source']
            self.assertEqual(source.artwork_calls,[(saved['trackId'],saved['reference'])])
            self.assertEqual(uploads[0][0],'covers/round')

    def test_legacy_manifest_resumes_without_reselection_or_rewrite(self):
        with tempfile.TemporaryDirectory() as directory:
            source=FixtureSource('legacy');sources=Sources([source],legacy_source_id='legacy')
            folder=Path(directory,'job');folder.mkdir()
            question={'slot':23,'path':'private-legacy-path','itemId':'legacy-track','albumId':None,
                      'offset':7,'correctOptionId':'a','options':[{'id':c,'title':c,'artist':'Artist'} for c in 'abcd']}
            save(folder/'manifest.json',[question]);original=(folder/'manifest.json').read_bytes()
            def encode_stub(path,offset,target): target.write_bytes(b'legacy'*200)
            with patch('needle_music.worker.encode',side_effect=encode_stub),patch('builtins.print'):
                prepare_job({'id':'job','count':1,'startSlot':23,'lease':'lease'},directory,sources,lambda *a,**k:{})
            self.assertEqual(source.catalog_calls,0)
            self.assertEqual(source.opened[0][0],'legacy-track')
            self.assertEqual(source.opened[0][1]['path'],'private-legacy-path')
            self.assertEqual((folder/'manifest.json').read_bytes(),original)

    def test_source_input_is_cleaned_even_when_encoding_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            source=FixtureSource();sources=Sources([source]);calls=[]
            with patch('needle_music.worker.encode',side_effect=Unavailable('Encoding failed')),patch('builtins.print'):
                with self.assertRaises(Unavailable):
                    prepare_job({'id':'job','count':1,'startSlot':1,'lease':'lease'},directory,sources,lambda *args:calls.append(args))
            self.assertEqual(len(source.closed),1)
            self.assertEqual(calls,[])
            self.assertEqual(list(Path(directory,'job').glob('source-*')),[])

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'FFmpeg tools not installed')
    def test_synthetic_audio_meets_existing_duration_size_and_metadata_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory,'source.wav');target=Path(directory,'clip.mp3')
            subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i',
                            'sine=frequency=440:duration=46','-metadata','title=Private fixture title',str(source)],
                           check=True,timeout=30,capture_output=True)
            original=hashlib.sha256(source.read_bytes()).hexdigest()
            encode(source,5,target)
            result=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration:format_tags','-of','json',str(target)]))
            self.assertTrue(29.8<=float(result['format']['duration'])<=30.3)
            self.assertTrue(1000<=target.stat().st_size<=2097152)
            self.assertTrue(all(key.lower()=='encoder' for key in result['format'].get('tags',{})))
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),original)


if __name__=='__main__': unittest.main()
