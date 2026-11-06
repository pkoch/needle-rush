"""Owner-private, atomic preparation state; existing JSON manifests stay readable."""
import json
import os
from pathlib import Path
import stat
import tempfile

from .errors import Unavailable


def private_file(path):
    path = Path(path)
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o600):
        raise Unavailable('Configuration requires an owner-only regular file')
    return path


def private_json(path):
    return json.loads(private_file(path).read_text())


def save(path, value):
    path = Path(path)
    descriptor, name = tempfile.mkstemp(prefix=path.name + '.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(value, stream, ensure_ascii=False, allow_nan=False)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)
