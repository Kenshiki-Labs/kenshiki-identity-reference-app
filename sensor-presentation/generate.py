"""Deterministically generate the sensor presentation resources; run from any directory.

`--check` writes nothing and exits 1 when a committed resource differs from what `source/`
produces. The boundary gate runs it, because the React Native host's sensor screens read
their words and layout numbers from these files rather than from locales/ and ui/.
"""
import argparse
import json
import re
import sys
from pathlib import Path
out = Path(__file__).parent
source = out / 'source'

def jsonc(path):
    text = re.sub(r'"(?:\\.|[^"\\])*"|//[^\n]*|/\*[\s\S]*?\*/', lambda m: m[0] if m[0].startswith('"') else '', path.read_text())
    return json.loads(re.sub(r',\s*([}\]])', r'\1', text))

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check', action='store_true', help='fail if a committed resource is stale')
arguments = parser.parse_args()
copy = {}
for key, value in re.findall(r'String\(localized: "([^"\\]+)", defaultValue: "((?:\\.|[^"\\])*)"', (source / 'SensorHostCopy.swift').read_text()):
    if '\\(' not in value:
        copy[key] = json.loads('"' + value + '"')
for key, entry in json.loads((source / 'Localizable.xcstrings').read_text())['strings'].items():
    value = entry.get('localizations', {}).get('en', {}).get('stringUnit', {}).get('value')
    if value:
        copy[key] = value
outputs = {out / (name + '.json'): json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + '\n'
           for name, value in [('copy', copy), ('config', jsonc(source / 'SensorHostConfig.jsonc')),
                               ('pages', jsonc(source / 'SensorPages.jsonc'))]}
if arguments.check:
    stale = [path for path, text in outputs.items()
             if not path.exists() or path.read_text(encoding='utf-8') != text]
    for path in stale:
        print(f'stale: sensor-presentation/{path.name}', file=sys.stderr)
    sys.exit(1 if stale else 0)
for path, text in outputs.items():
    path.write_text(text, encoding='utf-8')
