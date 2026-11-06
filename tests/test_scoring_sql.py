import concurrent.futures
import re
import sqlite3
import unittest
import test_room_sql as rooms
ROOT=rooms.ROOT
GAME=(ROOT/'lib/game.ts').read_text()
ANSWER=re.search(r'ANSWER_SQL="([^"]+)"',GAME).group(1)
WIN=re.search(r'db.prepare\("(UPDATE rounds SET winner_id=[^"]+)"',GAME).group(1)
class Scoring(unittest.TestCase):
    connect=rooms.RoomConstraints.connect
    tearDown=rooms.RoomConstraints.tearDown
    def setUp(self):
        rooms.RoomConstraints.setUp(self)
        with self.connect() as db:
            for i in range(16):db.execute('INSERT INTO players VALUES(?,?,?,?,?)',(str(i),'r',f'P{i}',f'p{i}',1))
            db.execute("INSERT INTO rounds(id,room_id,number,status,options_json,correct_option_id,clip_key,opens_at,closes_at,winner_id) VALUES('round','r',1,'OPEN','[]','yes','opaque',100,1000,NULL)")
            db.execute("UPDATE rooms SET phase='PLAYING',current_round_id='round',display_last_seen=500,display_audio_ready=1 WHERE id='r'")
    def guess(self,i,option='yes',stamp=500):
        attempt='attempt'+str(i)
        with self.connect() as db:
            db.execute(ANSWER,(attempt,option,option,stamp,'round',str(i),stamp,stamp))
            db.execute(WIN,(str(i),'round',attempt))
    def test_reveal_and_countdown_are_anchored_to_closure(self):
        queries=re.findall(r'prepare\("([^"\n]+)"',GAME)
        reveal=next(q for q in queries if q.startswith("UPDATE rooms SET phase='REVEAL'"))
        open_next=next(q for q in queries if q.startswith("UPDATE rounds SET status='OPEN',opens_at=(SELECT deadline"))
        with self.connect() as db:
            db.execute("UPDATE rounds SET status='CLOSED',closes_at=1000")
            db.execute("INSERT INTO rounds(id,room_id,number,status,options_json,correct_option_id,clip_key,preloaded) VALUES('next','r',2,'READY','[]','yes','opaque',1)")
            db.execute(reveal,('r',));db.execute(reveal,('r',))
            self.assertEqual(db.execute("SELECT phase,deadline,scored_rounds FROM rooms").fetchone(),('REVEAL',2500,1))
            db.execute(open_next,('r','r','r',2499,10))
            self.assertEqual(db.execute("SELECT status FROM rounds WHERE id='next'").fetchone()[0],'READY')
            db.execute(open_next,('r','r','r',2500,10))
            self.assertEqual(db.execute("SELECT status,opens_at FROM rounds WHERE id='next'").fetchone(),('OPEN',5500))
    def test_tenth_round_finishes_without_opening_an_eleventh(self):
        queries=re.findall(r'prepare\("([^"\n]+)"',GAME)
        finish=next(q for q in queries if q.startswith("UPDATE rooms SET phase='FINISHED'"))
        with self.connect() as db:
            db.execute("UPDATE rooms SET phase='REVEAL',scored_rounds=10,deadline=4000")
            db.execute(finish,(86404000,'r',3999,10))
            self.assertEqual(db.execute("SELECT phase FROM rooms").fetchone()[0],'REVEAL')
            db.execute(finish,(86404000,'r',4000,10))
            self.assertEqual(db.execute("SELECT phase,active_key FROM rooms").fetchone(),('FINISHED',None))
    def test_simultaneous_correct(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:list(pool.map(self.guess,range(16)))
        with self.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0],16)
            self.assertIsNotNone(db.execute("SELECT winner_id FROM rounds WHERE id='round'").fetchone()[0])
    def test_later_guesses_remain_open(self):
        self.guess(0,'wrong');self.guess(1);self.guess(2,'wrong')
        with self.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0],3)
            self.assertEqual(db.execute("SELECT winner_id FROM rounds WHERE id='round'").fetchone()[0],'1')
            self.assertEqual(db.execute("SELECT correct FROM attempts WHERE player_id='0'").fetchone()[0],0)
    def test_duplicate_cannot_change_choice(self):
        self.guess(0,'wrong');self.guess(0,'yes')
        with self.connect() as db:self.assertEqual(db.execute("SELECT option_id FROM attempts WHERE player_id='0'").fetchone()[0],'wrong')
    def test_no_answer_deadline_and_open_boundary(self):
        self.guess(0,stamp=99)
        with self.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0],0)
        self.guess(2,stamp=100);self.guess(1,stamp=1000)
        with self.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0],2)
    def test_void_round_rejects_answer(self):
        with self.connect() as db:db.execute("UPDATE rounds SET status='VOID'")
        self.guess(0)
        with self.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0],0)
    def test_scores_wait_for_reveal_and_void_reversal(self):
        self.guess(0,'wrong')
        sql=re.search(r'database\(\).prepare\("(SELECT p.id[^"\n]+)"',GAME).group(1)
        with self.connect() as db:
            rows=db.execute(sql,('r',)).fetchall()
            self.assertEqual(next(row[2] for row in rows if row[0]=='0'),0)
            db.execute("UPDATE rounds SET status='CLOSED'")
            self.assertEqual(next(row[2] for row in db.execute(sql,('r',)).fetchall() if row[0]=='0'),-3)
            db.execute("UPDATE rounds SET status='VOID'")
            self.assertTrue(all(row[2]==0 for row in db.execute(sql,('r',)).fetchall()))
    def test_failed_preload_voids_without_consuming_round(self):
        statements=re.findall(r'prepare\("([^"\n]+)"',GAME)
        void=next(q for q in statements if q.startswith("UPDATE rounds SET status='VOID' WHERE id=? AND status IN"))
        pause=next(q for q in statements if q.startswith("UPDATE rooms SET phase='PAUSED',display_audio_ready=0"))
        with self.connect() as db:
            db.execute("UPDATE rooms SET phase='PREPARING'")
            db.execute("UPDATE rounds SET status='READY'")
            db.execute(void,('round','r'));db.execute(pause,('r',))
            self.assertEqual(db.execute("SELECT status FROM rounds").fetchone()[0],'VOID')
            self.assertEqual(db.execute("SELECT phase,scored_rounds FROM rooms").fetchone(),('PAUSED',0))
    def test_first_and_later_correct_scoring(self):
        self.guess(0);self.guess(1);self.guess(2,'wrong');self.guess(3,'__skip__')
        sql=re.search(r'database\(\).prepare\("(SELECT p.id[^"\n]+)"',GAME).group(1)
        with self.connect() as db:
            db.execute("UPDATE rounds SET status='CLOSED'")
            points={row[0]:row[2] for row in db.execute(sql,('r',))}
            self.assertEqual((points['0'],points['1'],points['2'],points['3']),(3,1,-3,-1))
    def test_skip_is_final_and_all_skips_close_the_round(self):
        close=next(q for q in re.findall(r'prepare\("([^"\n]+)"',GAME) if q.startswith("UPDATE rounds SET status='CLOSED',closes_at="))
        self.guess(0,'__skip__');self.guess(0,'yes')
        with self.connect() as db:
            db.execute(close,(500,'round','round','r'))
            self.assertEqual(db.execute("SELECT status FROM rounds").fetchone()[0],'OPEN')
            self.assertEqual(db.execute("SELECT option_id FROM attempts WHERE player_id='0'").fetchone()[0],'__skip__')
        for i in range(1,16):self.guess(i,'__skip__')
        with self.connect() as db:
            db.execute(close,(500,'round','round','r'))
            self.assertEqual(db.execute("SELECT status,winner_id FROM rounds").fetchone(),('CLOSED',None))
            score=re.search(r'database\(\).prepare\("(SELECT p.id[^"\n]+)"',GAME).group(1)
            self.assertTrue(all(row[2]==-1 for row in db.execute(score,('r',))))
    def test_stale_heartbeat_does_not_block_a_valid_answer(self):
        with self.connect() as db:db.execute("UPDATE rooms SET display_last_seen=NULL,display_audio_ready=0")
        self.guess(0,stamp=1000000)
        with self.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0],1)
    def test_resume_invalidates_preload_and_keeps_completed_score(self):
        queries=re.findall(r'prepare\("([^"\n]+)"',GAME)
        reset=next(q for q in queries if q.startswith('UPDATE rounds SET preloaded=0'))
        resume=next(q for q in queries if q.startswith("UPDATE rooms SET pause_requested=0,phase='PREPARING'"))
        with self.connect() as db:
            db.execute("UPDATE rounds SET status='VOID'")
            db.execute("INSERT INTO rounds(id,room_id,number,status,options_json,correct_option_id,clip_key,preloaded) VALUES('next','r',2,'READY','[]','yes','opaque',1)")
            db.execute("UPDATE rooms SET phase='PAUSED',pause_requested=1,scored_rounds=1")
            db.execute(reset,('r',));db.execute(resume,('next','r'))
            self.assertEqual(db.execute("SELECT phase,current_round_id,pause_requested,scored_rounds FROM rooms").fetchone(),('PREPARING','next',0,1))
            self.assertEqual(db.execute("SELECT preloaded FROM rounds WHERE id='next'").fetchone()[0],0)
if __name__=='__main__':unittest.main()
