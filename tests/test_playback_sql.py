import re
import unittest
import test_room_sql as rooms
SOURCE=(rooms.ROOT/'lib/postgame-playback.ts').read_text()
def query(name):return re.search(name+r'="([^"]+)"',SOURCE).group(1)
RECORD=query('RECORD_PLAYBACK_SQL');STOP=query('STOP_PLAYBACK_SQL');CURRENT=query('CURRENT_PLAYBACK_SQL')
class PlaybackState(unittest.TestCase):
    connect=rooms.RoomConstraints.connect
    tearDown=rooms.RoomConstraints.tearDown
    def setUp(self):
        rooms.RoomConstraints.setUp(self)
        with self.connect() as db:
            db.execute("UPDATE rooms SET phase='FINISHED',active_key=NULL,scored_rounds=10")
            for i,status in enumerate(('CLOSED','CLOSED','READY')):
                db.execute("INSERT INTO rounds(id,room_id,number,status,options_json,correct_option_id,clip_key) VALUES(?,'r',?,?,'[]','a','opaque')",('t'+str(i),i+1,status))
    def test_heartbeats_keep_start_time_and_expire(self):
        with self.connect() as db:
            db.execute(RECORD,(1000,1000,'r','t0'));db.execute(RECORD,(2000,2000,'r','t0'))
            self.assertEqual(db.execute(CURRENT,('r',1999)).fetchone(),('t0',1000))
            self.assertIsNone(db.execute(CURRENT,('r',2000)).fetchone())
    def test_old_messages_cannot_rewind_or_restart_stopped_music(self):
        with self.connect() as db:
            db.execute(RECORD,(1000,1000,'r','t0'));db.execute(RECORD,(2000,2000,'r','t1'));db.execute(RECORD,(1500,1500,'r','t0'))
            self.assertEqual(db.execute(CURRENT,('r',0)).fetchone(),('t1',2000))
            db.execute(STOP,(3000,3000,'r'));db.execute(RECORD,(2500,2500,'r','t1'))
            self.assertIsNone(db.execute(CURRENT,('r',0)).fetchone())
    def test_reserves_and_nonfinished_games_cannot_be_marked_playing(self):
        with self.connect() as db:
            db.execute(RECORD,(1000,1000,'r','t2'))
            self.assertEqual(db.execute('SELECT count(*) FROM postgame_playback').fetchone()[0],0)
            db.execute("UPDATE rooms SET phase='PLAYING'");db.execute(RECORD,(1000,1000,'r','t0'))
            self.assertEqual(db.execute('SELECT count(*) FROM postgame_playback').fetchone()[0],0)
    def test_room_cleanup_cascades_playback_state(self):
        with self.connect() as db:
            db.execute(RECORD,(1000,1000,'r','t0'));db.execute('DELETE FROM rounds');db.execute('DELETE FROM rooms')
            self.assertEqual(db.execute('SELECT count(*) FROM postgame_playback').fetchone()[0],0)
