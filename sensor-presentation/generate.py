"""Deterministically copy SensorHost presentation resources; run from any directory."""
import json
import re
from pathlib import Path
root = Path(__file__).resolve().parents[3]
source = root / 'Hosts/SensorHost/Sources'
out = Path(__file__).parent

def jsonc(path):
    text = re.sub(r'"(?:\\.|[^"\\])*"|//[^\n]*|/\*[\s\S]*?\*/', lambda m: m[0] if m[0].startswith('"') else '', path.read_text())
    return json.loads(re.sub(r',\s*([}\]])', r'\1', text))

copy = {}
for key, value in re.findall(r'String\(localized: "([^"\\]+)", defaultValue: "((?:\\.|[^"\\])*)"', (source / 'SensorHostCopy.swift').read_text()):
    if '\\(' not in value:
        copy[key] = json.loads('"' + value + '"')
for key, entry in json.loads((source / 'Localizable.xcstrings').read_text())['strings'].items():
    value = entry.get('localizations', {}).get('en', {}).get('stringUnit', {}).get('value')
    if value:
        copy[key] = value
for name, value in [('copy', copy), ('config', jsonc(source / 'SensorHostConfig.jsonc')), ('pages', jsonc(source / 'SensorPages.jsonc'))]:
    (out / (name + '.json')).write_text(json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + '\n')
