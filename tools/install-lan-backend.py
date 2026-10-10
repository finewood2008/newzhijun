"""Install the LAN advertisement overlay only on the reviewed WANX baseline."""
from pathlib import Path
import datetime
import hashlib
import json
import py_compile
import shutil
import sys

root = Path(__file__).resolve().parents[1]
source = root / "backend-overlay/lan"
target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / ".octop/portable/packages/octop"
manifest = json.loads((source / "manifest.json").read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
for rel, spec in manifest.items():
    current = sha(target / rel) if (target / rel).exists() else None
    if current not in (spec["before"], spec["after"]) and not (rel == "api/lan_discovery.py" and current is None):
        raise SystemExit("Target differs; merge before installing: " + rel)
    if sha(source / "octop" / rel) != spec["after"]:
        raise SystemExit("Overlay changed: " + rel)
    py_compile.compile(str(source / "octop" / rel), doraise=True)
backup = root / "verification" / ("lan-runtime-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
for rel in manifest:
    dest = target / rel
    if dest.exists():
        saved = backup / rel
        saved.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(dest, saved)
    dest.parent.mkdir(parents=True, exist_ok=True)
    temporary = dest.with_suffix(".py.new")
    shutil.copy2(source / "octop" / rel, temporary)
    temporary.replace(dest)
print("LAN overlay installed; backup:", backup)
