#!/usr/bin/env python3
"""Refuse a host whose bundled bridge cannot satisfy its runtime's private C imports."""
import argparse
from pathlib import Path
import re
import subprocess

SYMBOL = re.compile(r'^_IEOpenCV[A-Za-z0-9_]+$')


def symbols(binary: Path, flags: str, architecture: str) -> set[str]:
    """Inspect one actual Mach-O slice; never infer ABI support from filenames or headers."""
    if not binary.is_file():
        raise ValueError('Missing framework binary: ' + str(binary))
    output = subprocess.check_output(
        ['xcrun', 'nm', '-arch', architecture, flags, str(binary)],
        text=True, stderr=subprocess.PIPE)
    return {line.strip() for line in output.splitlines() if SYMBOL.fullmatch(line.strip())}


def verify(runtime: Path, bridge: Path, architecture: str = 'arm64') -> set[str]:
    imports = symbols(runtime, '-uj', architecture)
    exports = symbols(bridge, '-gUj', architecture)
    # An empty match generally means a wrong/stale product or an unexpected linkage
    # change. This host intentionally uses a separate bridge; fail closed for review.
    if not imports:
        raise ValueError('Runtime has no private C bridge imports for ' + architecture)
    if not exports:
        raise ValueError('Bridge has no private C exports for ' + architecture)
    missing = imports - exports
    if missing:
        raise ValueError('Bundled bridge is missing runtime imports: ' + ', '.join(sorted(missing)))
    return imports


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('runtime', type=Path, help='Runtime Mach-O binary, not the framework directory')
    parser.add_argument('bridge', type=Path, help='Bundled bridge Mach-O binary')
    parser.add_argument('--architecture', default='arm64')
    args = parser.parse_args()
    try:
        imports = verify(args.runtime, args.bridge, args.architecture)
    except (ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, 'Host bridge verification failed: ' + str(error) + '\n')
    print(f'Host bridge ABI verified: {len(imports)} runtime imports satisfied on {args.architecture}')


if __name__ == '__main__':
    main()
