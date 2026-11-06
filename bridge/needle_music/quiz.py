"""Quiz planning knows track metadata and stable source IDs, never provider APIs."""
import random
import uuid

from .errors import Unavailable


def plan(pool, rng=None, count=22, start_slot=1):
    rng = rng or random.SystemRandom()
    if type(count) is not int or count < 1 or type(start_slot) is not int or start_slot < 1:
        raise Unavailable('Invalid preparation range')
    if len(pool) < max(4, count):
        raise Unavailable('Not enough eligible distinct songs for this preparation')
    chosen = rng.sample(range(len(pool)), count)
    questions = []
    for slot, index in enumerate(chosen, start_slot):
        selected = pool[index]
        correct = selected.track
        others = rng.sample([i for i in range(len(pool)) if i != index], 3)
        options = [{'id': uuid.uuid4().hex, 'title': pool[i].track.title,
                    'artist': pool[i].track.artist} for i in [index] + others]
        correct_id = options[0]['id']
        rng.shuffle(options)
        questions.append({
            'slot': slot, 'offset': rng.uniform(5, correct.duration - 35),
            'options': options, 'correctOptionId': correct_id,
            'source': {'version': 1, 'id': selected.source_id, 'trackId': correct.track_id,
                       'reference': dict(correct.reference)},
        })
    return questions


def public_question(question, sha256):
    """Only these fields cross into Sites, regardless of a provider's private data."""
    return {
        'slot': question['slot'], 'correctOptionId': question['correctOptionId'], 'sha256': sha256,
        'options': [{key: option[key] for key in ('id', 'title', 'artist')}
                    for option in question['options']],
    }
