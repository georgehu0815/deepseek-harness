"""Package verified clips and exact embedded audio, retaining the six original references."""
import base64
import hashlib
import json
from pathlib import Path
import zipfile

root=Path(__file__).resolve().parents[2]
artifacts=root/'artifacts'
out=artifacts/'microduck-dances-v2'
audio_dir=artifacts/'microduck-dance-audio'
original=artifacts/'microduck-dances'
def load(path):
    return json.loads(path.read_text())
def digest(data):
    return hashlib.sha256(data).hexdigest()

v2=load(out/'manifest.json')['clips']
old=load(original/'manifest.json')['clips']
kinematics=load(out/'kinematic-verification.json')['results']
browser=load(out/'browser-verification.json')
tracks=load(audio_dir/'manifest.json')['tracks']
summary=load(out/'verification-summary.json')
assert len(v2)==6 and len(old)==6 and len(tracks)==12 and len(browser['results'])==12
assert browser['pageErrors']==[]
assert digest((root/'packages/client/ui-robot-lab/lib/client.js').read_bytes())==summary['guiBundleSha256']
for row in old+v2:
    revised='id' in row and row['id'].endswith('_v2')
    identifier=row['id'] if revised else row['dance']
    folder=out if revised else original
    raw=(folder/row['clipFile']).read_bytes()
    assert digest(raw)==row['clipSha256']
    observed=next(r for r in browser['results'] if r['id']==identifier)
    assert observed['clipSha256']==row['clipSha256'] and observed['exactJsonExport']
    asset=load(root/f'packages/client/ui-robot-lab/src/client/dance-clips/{identifier}.json')
    assert (asset['clip'] if revised else asset['sequence']['clip'])==json.loads(raw)
    if revised:
        assert next(r for r in kinematics if r['dance']==row['dance'])['clipSha256']==row['clipSha256']
        for frame in ['step','turn']:
            assert (out/f'{identifier}-{frame}-audio.png').is_file()
    track=next(t for t in tracks if t['id']==identifier)
    encoded=(audio_dir/track['file']).read_bytes()
    embedded=load(root/f'packages/client/ui-robot-lab/src/client/dance-audio/{identifier}.json')
    assert base64.b64decode(embedded['src'].split(',')[1])==encoded
    assert digest(encoded)==track['sha256']==observed['audioSha256']
    assert embedded['bpm']==row['bpm'] and embedded['duration']==row['duration']

files=[]
for folder in [out,audio_dir]:
    files.extend(p for p in folder.rglob('*') if p.is_file() and p.name not in ['probe.json','browser-failure.png'] and '__pycache__' not in p.parts)
for row in old:
    files.extend(original/f"{row['dance']}_microduck{suffix}" for suffix in ['.clip.json','.sequence.json','.guide.json'])
files.extend(original/name for name in ['manifest.json','model.json','kinematic-verification.json','regenerate.mjs','verify-kinematics.py'])
archive=artifacts/'microduck-dances-v2-with-audio.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for path in sorted(files):
        z.write(path,path.relative_to(artifacts))
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert len([p for p in z.namelist() if p.endswith('_v2.clip.json')])==6
    assert len([p for p in z.namelist() if p.endswith('.ogg')])==12
print(json.dumps({'archive':str(archive.relative_to(root)),'files':len(files),'bytes':archive.stat().st_size,
                  'sha256':digest(archive.read_bytes()),'clipAndAudioBindingsVerified':12}))
