"""Exercise the production SQL and migrations, including concurrent claims."""
import contextlib
import concurrent.futures
import pathlib
import re
import sqlite3
import tempfile
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'app/api/[...path]/route.ts').read_text()
QUERIES=re.findall(r'db\.prepare\("([^"\n]+)"\)',SOURCE)
def query(prefix):
    return next(q for q in QUERIES if q.startswith(prefix))
class RoomConstraints(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=str(pathlib.Path(self.temp.name)/'db.sqlite')
        with self.connect() as db:
            for migration in sorted((ROOT/'drizzle').glob('*.sql')):db.executescript(migration.read_text())
            db.execute("INSERT INTO rooms(id,code,owner_id,phase,active_key,revision,scored_rounds,last_activity,expires_at,created_at) VALUES('r','ABC234','owner','LOBBY',1,0,0,1,9999999999999,1)")
    @contextlib.contextmanager
    def connect(self):
        db=sqlite3.connect(self.path,timeout=10);db.execute('PRAGMA foreign_keys=ON')
        try:
            with db:yield db
        finally:db.close()
    def tearDown(self):self.temp.cleanup()
    def test_concurrent_join_capacity(self):
        sql=query('INSERT INTO players')
        def join(i):
            with self.connect() as db:
                return db.execute(sql,(str(i),'r',f'Player {i}',f'player {i}',1,'r','r')).rowcount
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:created=list(pool.map(join,range(20)))
        self.assertEqual(sum(created),16)
    def test_duplicate_name_and_late_join(self):
        sql=query('INSERT INTO players')
        with self.connect() as db:
            db.execute(sql,('a','r','Jane','jane',1,'r','r'))
            with self.assertRaises(sqlite3.IntegrityError):db.execute(sql,('b','r','JANE','jane',1,'r','r'))
            db.execute("UPDATE rooms SET phase='PLAYING' WHERE id='r'")
            self.assertEqual(db.execute(sql,('c','r','Sam','sam',1,'r','r')).rowcount,0)
    def test_pair_claim_consumed_once(self):
        update=query('UPDATE display_pairs SET consumed_at=')
        insert=query('INSERT INTO sessions(token_hash,room_id,role,expires_at)')
        with self.connect() as db:db.execute("INSERT INTO display_pairs VALUES('code','r',100,NULL)")
        def pair(i):
            with self.connect() as db:
                db.execute(update,(10,'code',10));db.execute(insert,(str(i),'r',100));return db.execute('SELECT count(*) FROM sessions WHERE token_hash=?',(str(i),)).fetchone()[0]
        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:claimed=list(pool.map(pair,range(16)))
        self.assertEqual(sum(claimed),1)
    def test_only_one_active_room(self):
        with self.connect() as db:
            with self.assertRaises(sqlite3.IntegrityError):db.execute("INSERT INTO rooms(id,code,owner_id,active_key,last_activity,expires_at,created_at) VALUES('r2','DEF234','owner',1,1,100,1)")
if __name__=='__main__':unittest.main()
