"""Messages safe to log without revealing private source URLs or credentials."""


class Unavailable(Exception):
    pass


class RemoteError(Unavailable):
    def __init__(self, status):
        self.status = status
        super().__init__(f'Connector request unavailable (HTTP {status})')
