"""Repack upstream ZIPs as deterministic tar.gz files for vosk-browser.
Usage: python scripts/pack-models.py /tmp/think-vosk-it.zip /tmp/think-vosk-en.zip
Directory records are required by the WASM tar reader, unlike Python tarfile.
"""
import pathlib,zipfile,tarfile,gzip,hashlib,json,io,sys
root=pathlib.Path(__file__).resolve().parents[1]
manifest={}
for source,lang,version in zip([arg for arg in sys.argv[1:] if arg!='--cache-only'],['it-IT','en-US'],['vosk-model-small-it-0.22','vosk-model-small-en-us-0.15']):
    archive=pathlib.Path(source);dest=root/'.cache/voice/models'/f'{version}.tar.gz'
    dest.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(archive) as z,gzip.GzipFile(filename=str(dest),mode='wb',mtime=0) as gz,tarfile.open(fileobj=gz,mode='w',format=tarfile.USTAR_FORMAT) as tar:
        directories=set()
        for info in sorted(z.infolist(),key=lambda i:i.filename):
            if info.is_dir():continue
            name='model/'+info.filename.split('/',1)[1]
            parts=pathlib.PurePosixPath(name).parts
            if '..' in parts:raise ValueError('Unsafe model path')
            for i in range(1,len(parts)):
                directory='/'.join(parts[:i])
                if directory not in directories:
                    t=tarfile.TarInfo(directory+'/');t.type=tarfile.DIRTYPE;t.mode=0o755;t.mtime=0;tar.addfile(t);directories.add(directory)
            data=z.read(info);t=tarfile.TarInfo(name);t.size=len(data);t.mode=0o644;t.mtime=0;tar.addfile(t,io.BytesIO(data))
    manifest[lang]={'id':version,'url':'./models/'+dest.name,'bytes':dest.stat().st_size,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'source':'https://alphacephei.com/vosk/models/'+version+'.zip','sourceSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'license':'Apache-2.0'}
if '--cache-only' not in sys.argv:
    (root/'src/models/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    p=root/'src/js/voice-config.js';s=p.read_text();s=s[s.index('export const RUNTIME'):];p.write_text('export const MODELS = '+json.dumps(manifest,indent=2)+';\n'+s)
print('Models prepared with explicit directories.')
