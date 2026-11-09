"""Install pinned speech assets locally. No uploads; Python standard library only."""
from pathlib import Path
import base64,hashlib,json,subprocess,sys,tarfile,tempfile,urllib.request
from patch_vosk_csp import patch_vosk
ROOT=Path(__file__).resolve().parents[1]
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def valid(path,expected):return path.is_file() and sha(path)==expected
def download(url,path):
    if not url.startswith(('https://registry.npmjs.org/','https://alphacephei.com/vosk/models/')):raise ValueError('Unexpected source')
    print('Downloading',url,flush=True)
    with urllib.request.urlopen(url,timeout=120) as response,path.open('wb') as output:
        while chunk:=response.read(1024*1024):output.write(chunk)
with tempfile.TemporaryDirectory(prefix='think-voice-') as temporary:
    temp=Path(temporary)
    for i,package in enumerate(json.loads((ROOT/'scripts/voice-lock.json').read_text())):
        if all(valid(ROOT/f['path'],f.get('installedSha256',f['sha256'])) for f in package['files'].values()):continue
        archive=temp/f'package-{i}.tgz';download(package['url'],archive)
        algorithm,expected=package['integrity'].split('-',1)
        if base64.b64encode(hashlib.new(algorithm,archive.read_bytes()).digest()).decode()!=expected:raise ValueError('Package integrity mismatch')
        with tarfile.open(archive) as tar:
            for member,file in package['files'].items():
                data=tar.extractfile(member).read()
                if hashlib.sha256(data).hexdigest()!=file['sha256']:raise ValueError('Runtime integrity mismatch')
                if file.get('patch')=='vosk-csp':data=patch_vosk(data)
                if hashlib.sha256(data).hexdigest()!=file.get('installedSha256',file['sha256']):raise ValueError('Installed runtime integrity mismatch')
                target=ROOT/file['path'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    models=json.loads((ROOT/'src/models/manifest.json').read_text())
    if not all(valid(ROOT/'.cache/voice'/m['url'],m['sha256']) for m in models.values()):
        archives=[]
        for lang in ['it-IT','en-US']:
            model=models[lang];archive=temp/(model['id']+'.zip');download(model['source'],archive)
            if sha(archive)!=model['sourceSha256']:raise ValueError('Model integrity mismatch')
            archives.append(str(archive))
        subprocess.run([sys.executable,str(ROOT/'scripts/pack-models.py'),'--cache-only',*archives],check=True)
        for model in models.values():
            if not valid(ROOT/'.cache/voice'/model['url'],model['sha256']):raise ValueError('Repacked model differs from pinned output')
print('Local speech verified: Italian, English, ASR, and synthesis. No downloads required during offline use.')
