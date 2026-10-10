#!/usr/bin/env python3
"""Compile the pinned SDK face models for a device host; never changes model policy."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("output", type=Path, help="New directory for embedder.mlmodelc and detector.mlmodelc")
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
manifest = root / "ThirdParty/FaceMatching/import-manifest.json"
models = root / "ThirdParty/PulseFaceMatching/Models"
output = args.output.absolute()
if output.exists() or output.is_symlink():
    parser.error("Choose a new output directory")
if not output.parent.is_dir():
    parser.error("Output parent directory must exist")
entries = [entry for entry in json.loads(manifest.read_text())["files"]
           if entry["destination"].startswith("ThirdParty/PulseFaceMatching/Models/")]
actual = {path.relative_to(root).as_posix() for path in models.rglob("*") if path.is_file()}
if len(entries) != 6 or actual != {entry["destination"] for entry in entries}:
    raise SystemExit("Model inventory differs from the pinned import")
for entry in entries:
    data = (root / entry["destination"]).read_bytes()
    if len(data) != entry["destinationBytes"] or hashlib.sha256(data).hexdigest() != entry["destinationSHA256"]:
        raise SystemExit("Model hash mismatch: " + entry["destination"])
with tempfile.TemporaryDirectory(prefix="face-models-", dir=output.parent) as temporary:
    stage = Path(temporary)
    for source, target in [("PulseFaceEmbedder", "embedder"), ("PulseFaceDetector", "detector")]:
        subprocess.run(["xcrun", "coremlcompiler", "compile", str(models / (source + ".mlpackage")),
                        str(stage), "--platform", "iOS", "--deployment-target", "18.0"], check=True)
        (stage / (source + ".mlmodelc")).rename(stage / (target + ".mlmodelc"))
    hashes = {path.relative_to(stage).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
              for path in sorted(stage.rglob("*")) if path.is_file()}
    (stage / "face-resources.json").write_text(json.dumps({
        "sourceManifestSHA256": hashlib.sha256(manifest.read_bytes()).hexdigest(),
        "sourceFiles": {entry["destination"]: entry["destinationSHA256"] for entry in entries},
        "compiledFiles": hashes,
        "scope": "Device integration; existing model licensing and assurance limitations still apply."
    }, indent=2) + "\n")
    shutil.copytree(stage, output)
print("Compiled and inventoried face resources:", output)
