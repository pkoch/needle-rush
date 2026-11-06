import re
import unittest
import test_room_sql as rooms
CONNECTOR=(rooms.ROOT/'lib/connector.ts').read_text()
CLEANUP=next(q for q in re.findall(r'prepare\("([^"\n]+)"',CONNECTOR) if q.startswith('SELECT id FROM rooms WHERE (expires_at'))
class AfterpartyRetention(unittest.TestCase):
    connect=rooms.RoomConstraints.connect
    setUp=rooms.RoomConstraints.setUp
    tearDown=rooms.RoomConstraints.tearDown
    def test_finished_clips_survive_until_expiry_but_cancelled_clips_can_be_cleaned(self):
        with self.connect() as db:
            db.execute("UPDATE rooms SET phase='FINISHED',active_key=NULL,expires_at=2000")
            db.execute("INSERT INTO jobs(id,room_id,status,created_at) VALUES('job','r','COMPLETE',0)")
            self.assertEqual(db.execute(CLEANUP,(1000,)).fetchall(),[])
            self.assertEqual(db.execute(CLEANUP,(2000,)).fetchall(),[('r',)])
            db.execute("UPDATE rooms SET phase='CANCELLED'")
            self.assertEqual(db.execute(CLEANUP,(1000,)).fetchall(),[('r',)])
