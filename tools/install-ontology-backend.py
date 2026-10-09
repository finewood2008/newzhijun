"""Install the reviewed local backend overlay; retain exact originals for rollback."""
from pathlib import Path
import hashlib,json,shutil,sys,datetime,py_compile
root=Path(__file__).resolve().parents[1]
source=root/'backend-overlay'/'octop'
target=Path(sys.argv[1]) if len(sys.argv)>1 else Path.home()/'.octop/portable/packages/octop'
files=list(source.rglob('*.py'))
manifest_path=root/'backend-overlay/manifest.json'
spec=json.loads(manifest_path.read_text())
sha=lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
for rel,expected in spec['dependencies'].items():
 p=target/rel
 if not p.exists() or sha(p)!=expected:raise SystemExit('Dependency differs; review before installation: '+rel)
for path in files:
 rel=str(path.relative_to(source));dest=target/rel;expected=spec['files'][rel]
 if sha(path)!=expected['after_sha256']:raise SystemExit('Overlay source changed; refresh manifest after review: '+rel)
 actual=sha(dest) if dest.exists() else None
 if actual not in {expected['before_sha256'],expected['after_sha256']}:raise SystemExit('Target changed; merge rather than overwrite: '+rel)
for path in files:py_compile.compile(str(path),doraise=True)
backup=root/'verification'/('ontology-runtime-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
manifest=[]
for path in files:
 rel=path.relative_to(source);dest=target/rel
 if dest.exists():
  original=backup/rel;original.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(dest,original)
 dest.parent.mkdir(parents=True,exist_ok=True)
 new=dest.with_suffix('.py.new');shutil.copy2(path,new);new.replace(dest)
 manifest.append({'path':str(rel),'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()})
backup.mkdir(parents=True,exist_ok=True);(backup/'installed.json').write_text(json.dumps(manifest,indent=2))
print(f'Installed {len(files)} files; backup: {backup}')
