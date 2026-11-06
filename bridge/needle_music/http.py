"""Bounded requests shared by source adapters and the outbound Sites client."""
import json
import urllib.error
import urllib.request

from .errors import RemoteError, Unavailable


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request(url, headers, body=None, limit=8 * 1024 * 1024, raw=False):
    req = urllib.request.Request(
        url, data=body, headers={'User-Agent': 'NeedleRushConnector/1.0', **headers},
        method='POST' if body is not None else 'GET',
    )
    # Redirects must never forward source credentials to another destination.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(req, timeout=60) as response:
            data = response.read(limit + 1)
            if len(data) > limit:
                raise Unavailable('Response exceeded bound')
            return data if raw else json.loads(data)
    except urllib.error.HTTPError as error:
        error.close()
        raise RemoteError(error.code) from None
    except Unavailable:
        raise
    except Exception:
        raise RemoteError(0) from None
