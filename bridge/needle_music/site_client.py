"""The existing Sites wire protocol, separate from music provider requests."""
import hashlib
import json
import urllib.parse

from .errors import Unavailable
from .http import request


class SiteClient:
    def __init__(self, config):
        self.site = config['site_url'].rstrip('/')
        parsed = urllib.parse.urlparse(self.site)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise Unavailable('Sites connection requires an HTTPS origin')
        self.headers = {'Authorization': 'Bearer ' + config['connector_secret']}

    def __call__(self, path, body, lease=None, binary=False, content_type=None):
        headers = {**self.headers, 'Content-Type': content_type or ('audio/mpeg' if binary else 'application/json')}
        if lease:
            headers['X-Job-Lease'] = lease
        if content_type == 'image/jpeg':
            headers['X-Content-SHA256'] = hashlib.sha256(body).hexdigest()
        return request(self.site + '/api/connector/' + path, headers,
                       body if binary else json.dumps(body).encode())
