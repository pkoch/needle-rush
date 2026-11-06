import random
import tempfile
import unittest
from pathlib import Path
from needle_music.quiz import plan
from needle_music.state import private_json,save
from needle_music.errors import Unavailable,RemoteError
from needle_music.http import request
from needle_music.worker import run
from needle_music.model import Track,SourcedTrack
from needle_music.sources import Sources,load_sources
from needle_music.jellyfin import JellyfinSource
from test_support import FixtureSource
from unittest.mock import patch
import urllib.error
import json
class BridgeTests(unittest.TestCase):
    def test_distinct_rounds_and_offsets(self):
        pool=[{'title':f'Song {i}','artist':f'Artist {i}','duration':45+i,'path':f'/music/{i}'} for i in range(80)]
        questions=plan([SourcedTrack('fixture',Track(str(i),p['title'],p['artist'],p['duration'],{'path':p['path']})) for i,p in enumerate(pool)],random.Random(12))
        answers=[]
        for q in questions:
            self.assertEqual(len(q['options']),4)
            self.assertEqual(len({o['id'] for o in q['options']}),4)
            self.assertEqual(len({(o['title'],o['artist']) for o in q['options']}),4)
            answer=next(o for o in q['options'] if o['id']==q['correctOptionId']);answers.append((answer['title'],answer['artist']))
            index=int(answer['title'].split()[-1]);self.assertGreaterEqual(q['offset'],5);self.assertLessEqual(q['offset'],pool[index]['duration']-35)
        self.assertEqual(len(set(answers)),22)
    def test_replacement_slots_are_bounded(self):
        pool=[{'title':f'Song {i}','artist':'Artist','duration':80,'path':f'/music/{i}'} for i in range(8)]
        questions=plan([SourcedTrack('fixture',Track(str(i),p['title'],p['artist'],p['duration'],{'path':p['path']})) for i,p in enumerate(pool)],random.Random(3),count=2,start_slot=23)
        self.assertEqual([q['slot'] for q in questions],[23,24])
        self.assertEqual(len(questions),2)
    def test_insufficient_pool_fails(self):
        with self.assertRaises(Unavailable):plan([])
    def test_outside_paths_and_duplicate_labels_excluded(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'music';root.mkdir();song=root/'track.flac';song.write_bytes(b'x')
            item={'Name':'Song','Artists':['Artist'],'RunTimeTicks':600000000,'Path':str(song)}
            outside={**item,'Name':'Outside','Path':'/etc/passwd'}
            short={**item,'Name':'Short','RunTimeTicks':100000000}
            invalid={**item,'RunTimeTicks':None}
            source=JellyfinSource('jellyfin',{'jellyfin_key_path':'fixture','media_root':str(root)})
            with patch.object(source,'_items',return_value=[item,item,outside,short,invalid]):
                self.assertEqual(len(source.catalog()),1)
    def test_private_manifest_round_trip_and_permission_rejection(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'manifest.json';save(p,{'private':'source mapping'})
            self.assertEqual(private_json(p),{'private':'source mapping'})
            p.chmod(0o644)
            with self.assertRaises(Unavailable):private_json(p)
    def test_request_errors_do_not_expose_authenticated_urls(self):
        with patch('needle_music.http.urllib.request.build_opener') as build:
            build.return_value.open.side_effect=urllib.error.HTTPError('https://example.invalid/?token=fixture-secret',503,'Unavailable',{},None)
            with self.assertRaises(RemoteError) as caught:request('https://example.invalid/?token=fixture-secret',{},b'{}')
            self.assertEqual(caught.exception.status,503)
            self.assertNotIn('fixture-secret',str(caught.exception))
    def test_transient_upload_retry_reuses_active_lease(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);config=root/'config.json';save(config,{'site_url':'https://example.invalid','connector_secret':'fixture','jellyfin_key_path':'fixture'})
            calls={'claims':0,'questions':0,'finish':0}
            def remote(url,headers,body=None,limit=None):
                if url.endswith('/covers/pending'):return {'covers':[]}
                if url.endswith('/cleanup'):return {'deleted':0}
                if url.endswith('/claim'):
                    calls['claims']+=1
                    return {'job':{'id':'job','roomId':'room','lease':'lease','count':2,'startSlot':23}}
                if url.endswith('/question'):
                    calls['questions']+=1
                    if calls['questions']==1:raise RemoteError(503)
                    return {'id':'question'}
                if '/clip/' in url:return {'ok':True}
                if url.endswith('/finish'):calls['finish']+=1;return {'ok':True}
                raise AssertionError('Unexpected request')
            pool=[{'title':str(i),'artist':'Artist','path':'fixture','duration':80} for i in range(4)]
            def encode(path,offset,target):target.write_bytes(b'fixture'*200)
            with patch('needle_music.site_client.request',side_effect=remote),patch('needle_music.worker.load_sources',return_value=Sources([FixtureSource()])),patch('needle_music.worker.encode',side_effect=encode),patch('needle_music.worker.time.sleep',side_effect=[None,StopIteration]),patch('builtins.print'):
                with self.assertRaises(StopIteration):run(config,root/'state')
            self.assertEqual(calls['claims'],1)
            self.assertEqual(calls['finish'],1)
            self.assertEqual(calls['questions'],3)
    def test_permanent_clip_failure_reports_failed_job(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);config=root/'config.json';save(config,{'site_url':'https://example.invalid','connector_secret':'fixture','jellyfin_key_path':'fixture'})
            failed=[]
            def remote(url,headers,body=None,limit=None):
                if url.endswith('/covers/pending'):return {'covers':[]}
                if url.endswith('/cleanup'):return {'deleted':0}
                if url.endswith('/claim'):return {'job':{'id':'job','roomId':'room','lease':'lease','count':2,'startSlot':23}}
                if url.endswith('/fail'):failed.append(True);return {'ok':True}
                raise AssertionError('Unexpected upload after failed decode')
            pool=[{'title':str(i),'artist':'Artist','path':'fixture','duration':80} for i in range(4)]
            with patch('needle_music.site_client.request',side_effect=remote),patch('needle_music.worker.load_sources',return_value=Sources([FixtureSource()])),patch('needle_music.worker.encode',side_effect=Unavailable('Decode unavailable')),patch('builtins.print'):
                run(config,root/'state',once=True)
            self.assertEqual(failed,[True])

class ArtworkTests(unittest.TestCase):
    def setup_files(self,directory,question):
        root=Path(directory);(root/'job').mkdir();save(root/'job'/'manifest.json',[question]);key=root/'key';key.write_text('fixture');key.chmod(0o600)
        return root,{'jellyfin_key_path':str(key),'media_root':str(root/'music')}
    def test_album_id_is_used_without_external_metadata(self):
        from needle_music.artwork import sync_covers
        with tempfile.TemporaryDirectory() as directory:
            root,config=self.setup_files(directory,{'slot':1,'itemId':'a'*32,'albumId':'b'*32});uploaded=[]
            def api(path,body,**kwargs):
                if path=='covers/pending':return {'covers':[{'id':'round','jobId':'job','slot':1}]}
                uploaded.append((path,body,kwargs));return {'ok':True}
            jpeg=b'\xff\xd8\xff'+b'fixture'*30
            with patch('needle_music.jellyfin.request',return_value=jpeg) as fetch,patch.object(JellyfinSource,'catalog',side_effect=AssertionError('Unexpected catalog lookup')):
                self.assertEqual(sync_covers(load_sources(config),root,api),{'ready':1,'missing':0})
                self.assertIn('/Items/'+('b'*32)+'/Images/Primary',fetch.call_args.args[0])
            self.assertEqual(uploaded[0],('covers/round',jpeg,{'binary':True,'content_type':'image/jpeg'}))
    def test_missing_manifest_uses_placeholder_without_guessing(self):
        from needle_music.artwork import sync_covers
        with tempfile.TemporaryDirectory() as directory:
            calls=[]
            def api(path,body,**kwargs):
                if path=='covers/pending':return {'covers':[{'id':'round','jobId':'missing','slot':1}]}
                calls.append((path,body));return {'ok':True}
            with patch('needle_music.jellyfin.request',side_effect=AssertionError('Artwork must not be guessed')):
                self.assertEqual(sync_covers(Sources([]),Path(directory),api),{'ready':0,'missing':1})
            self.assertEqual(calls,[('covers/round',{'missing':True})])
    def test_temporary_cover_error_remains_retryable(self):
        from needle_music.artwork import sync_covers
        with tempfile.TemporaryDirectory() as directory:
            root,config=self.setup_files(directory,{'slot':1,'albumId':'b'*32});calls=[]
            def api(path,body,**kwargs):
                if path=='covers/pending':return {'covers':[{'id':'round','jobId':'job','slot':1}]}
                calls.append(path);return {'ok':True}
            with patch('needle_music.jellyfin.request',side_effect=RemoteError(503)):
                with self.assertRaises(RemoteError):sync_covers(load_sources(config),root,api)
            self.assertEqual(calls,[])

if __name__ == "__main__": unittest.main()
