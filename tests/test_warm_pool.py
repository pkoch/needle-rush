"""Production SQL: bounded private preparation and atomic one-game allocation."""
import concurrent.futures
import re
import unittest
import test_room_sql as rooms
from pathlib import Path
SOURCE=(Path(__file__).resolve().parents[1]/'lib/warm.ts').read_text()
SQL=re.findall(r'prepare\("([^"\n]+)"',SOURCE)
INSERT=next(q for q in SQL if q.startswith('INSERT INTO rooms'))
JOB=next(q for q in SQL if q.startswith('INSERT INTO jobs'))
CLAIM=next(q for q in SQL if q.startswith('UPDATE rooms'))
class WarmPool(unittest.TestCase):
    connect=rooms.RoomConstraints.connect
    tearDown=rooms.RoomConstraints.tearDown
    def setUp(self):
        rooms.RoomConstraints.setUp(self)
        with self.connect() as db:db.execute('DELETE FROM rooms')
    def add(self,i,phase='WARMING',stamp=1000):
        ident=f'w{i}'
        with self.connect() as db:
            db.execute(INSERT,(ident,f'W{i:05d}',stamp,stamp+86400000,stamp,stamp,2))
            db.execute(JOB,(f'j{i}',ident,stamp,12,ident))
            if phase!='WARMING':db.execute('UPDATE rooms SET phase=? WHERE id=?',(phase,ident))
    def test_concurrent_replenishment_cannot_exceed_two_packs(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:list(pool.map(self.add,range(16)))
        with self.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM rooms').fetchone()[0],2)
            self.assertEqual(db.execute('SELECT count(*) FROM jobs').fetchone()[0],2)
            self.assertEqual(db.execute('SELECT count(*) FROM rooms WHERE active_key=1').fetchone()[0],0)
    def test_ready_pack_priority_and_no_double_assignment(self):
        self.add(0);self.add(1,'WARM_READY')
        with self.connect() as db:
            row=db.execute(CLAIM,('owner','ABC234',2000,7202000,2000)).fetchone()
            self.assertEqual(row,('ABC234',))
            self.assertEqual(db.execute("SELECT phase,owner_id,active_key FROM rooms WHERE id='w1'").fetchone(),('LOBBY','owner',1))
            self.assertIsNone(db.execute(CLAIM,('owner','DEF234',2000,7202000,2000)).fetchone())
            self.assertEqual(db.execute("SELECT phase FROM rooms WHERE id='w0'").fetchone()[0],'WARMING')
    def test_partial_warm_pack_can_finish_in_assigned_room(self):
        self.add(0)
        with self.connect() as db:
            self.assertEqual(db.execute(CLAIM,('owner','ABC234',2000,7202000,2000)).fetchone(),('ABC234',))
            self.assertEqual(db.execute("SELECT room_id,status FROM jobs WHERE id='j0'").fetchone(),('w0','PENDING'))
    def test_expired_pack_is_never_assigned(self):
        self.add(0,'WARM_READY',stamp=0)
        with self.connect() as db:self.assertIsNone(db.execute(CLAIM,('owner','ABC234',86400001,93600001,86400001)).fetchone())
if __name__=='__main__':unittest.main()
