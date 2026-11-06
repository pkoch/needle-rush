#!/usr/bin/env python3
"""Outbound music worker entrypoint. Existing service arguments remain unchanged."""
import argparse
import os

from needle_music.worker import run


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--state', required=True)
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--covers-only', action='store_true')
    args = parser.parse_args()
    run(args.config, args.state, args.once, args.covers_only)


if __name__ == '__main__':
    main()
