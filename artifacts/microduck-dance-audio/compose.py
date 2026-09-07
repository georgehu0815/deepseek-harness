"""Compose original genre-style instrumentals, not recordings or transcriptions of commercial songs."""
import base64
import hashlib
import json
import subprocess
import tempfile
import wave
from pathlib import Path
import numpy as np

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent
assets = root / 'packages/client/ui-robot-lab/src/client/dance-audio'
assets.mkdir(parents=True, exist_ok=True)
rate = 24000
styles = ['bachata', 'breakdance', 'cumbia', 'martial_arts', 'robot', 'salsa']
original = json.loads((root / 'artifacts/microduck-dances/manifest.json').read_text())['clips']
v2 = json.loads((root / 'artifacts/microduck-dances-v2/manifest.json').read_text())['clips']
reports = []
for revision, rows in [('', original), ('_v2', v2)]:
    for row in rows:
        style = row['dance']
        clip_root = root / ('artifacts/microduck-dances-v2' if revision else 'artifacts/microduck-dances')
        clip = json.loads((clip_root / row['clipFile']).read_text())
        bpm = row['bpm']
        duration = clip['duration']
        beat = 60 / bpm
        rng = np.random.default_rng(7101 + styles.index(style))
        audio = np.zeros(round(duration * rate))
        def hit(at, kind, gain=1, note=110):
            lengths = {'kick': .36, 'snare': .2, 'hat': .065, 'shaker': .10, 'conga': .18,
                       'clave': .06, 'guiro': .25, 'bass': .36, 'chord': .42, 'gong': 1.3}
            length = lengths[kind]
            t = np.arange(round(length * rate)) / rate
            noise = rng.uniform(-1, 1, len(t))
            hp = noise - np.roll(noise, 1)
            if kind == 'kick':
                signal = np.sin(2*np.pi*(47*t+60*.025*(1-np.exp(-t/.025)))) * np.exp(-t*13) * .65
            elif kind == 'snare':
                signal = (hp*.12 + np.sin(2*np.pi*180*t)*.09)*np.exp(-t*22)
            elif kind in ['hat', 'shaker']:
                signal = hp * np.exp(-t*(55 if kind == 'hat' else 30)) * .08
            elif kind == 'conga':
                signal = (np.sin(2*np.pi*note*t)*.22 + noise*.03)*np.exp(-t*20)
            elif kind == 'clave':
                signal = np.sin(2*np.pi*1850*t)*np.exp(-t*100)*.17
            elif kind == 'guiro':
                signal = hp * (.25+.75*np.sin(2*np.pi*38*t)**8)*np.exp(-t*9)*.10
            elif kind == 'bass':
                signal = (np.sin(2*np.pi*note*t)+.2*np.sin(4*np.pi*note*t))*np.exp(-t*6)*.20
            elif kind == 'chord':
                signal = sum(np.sin(2*np.pi*note*2**(semitone/12)*t) for semitone in [0,3,7,12])/4*np.exp(-t*11)*.20
            else:
                signal = (np.sin(2*np.pi*95*t)+.4*np.sin(2*np.pi*147.2*t)+.2*np.sin(2*np.pi*211*t))*np.exp(-t*3)*.24
            signal *= np.minimum(1,t/.003)*gain
            start = round(at*rate)
            end = min(len(audio),start+len(signal))
            if 0 <= start < len(audio):
                audio[start:end] += signal[:end-start]
        for bar in range(int(np.ceil(duration / (4*beat)))):
            start = bar*4*beat
            root_note = [55, 65.4064, 73.4162, 49][(bar//2)%4]
            if style == 'bachata':
                for q in [0,1,2,3]: hit(start+q*beat,'conga',.75,210 if q%2 else 330)
                for q in np.arange(0,4,.5): hit(start+q*beat,'guiro',.65)
                for q in [0,1.5,2,3.5]: hit(start+q*beat,'bass',1,root_note)
                for q in [.5,1.5,2.5,3.5]: hit(start+q*beat,'chord',1,root_note*4)
            elif style == 'breakdance':
                for q in [0,1.5,2,2.75]: hit(start+q*beat,'kick',.9)
                for q in [1,3]: hit(start+q*beat,'snare',1.5)
                for q in np.arange(0,4,.5): hit(start+q*beat,'hat',1)
                for q in [0,.75,2,3.5]: hit(start+q*beat,'bass',1,root_note)
                hit(start+1.5*beat,'chord',.8,root_note*4)
            elif style == 'cumbia':
                for q in [0,2]: hit(start+q*beat,'kick',.65); hit(start+q*beat,'bass',1,root_note)
                for q in [1,1.75,3,3.75]: hit(start+q*beat,'conga',.9,270)
                for q in np.arange(0,4,.5): hit(start+q*beat,'guiro',.9)
                for q in [.5,2.5]: hit(start+q*beat,'chord',1,root_note*4)
            elif style == 'martial_arts':
                for q in [0,2]: hit(start+q*beat,'kick',1)
                for q in [1,3]: hit(start+q*beat,'conga',1,150)
                for q in [.5,1.5,2.5,3.5]: hit(start+q*beat,'clave',.6)
                if bar%2==0: hit(start,'gong',.8)
                hit(start,'bass',.5,root_note)
            elif style == 'robot':
                for q in [0,1,2,3]: hit(start+q*beat,'kick',.8)
                for q in [1,3]: hit(start+q*beat,'snare',1.1)
                for q in np.arange(0,4,.5): hit(start+q*beat,'hat',1)
                for i,q in enumerate(np.arange(0,4,.5)): hit(start+q*beat,'bass',.8,root_note*(2 if i%3==2 else 1))
                for q in [.75,2.75]: hit(start+q*beat,'chord',1,root_note*4)
            else:
                for q in ([0,1.5,3] if bar%2==0 else [1,2]): hit(start+q*beat,'clave',.95)
                for q in [.5,1.5,2.75,3.5]: hit(start+q*beat,'conga',1,220 if q==2.75 else 360)
                for q in np.arange(0,4,.5): hit(start+q*beat,'shaker',.9)
                for q in [1.5,3]: hit(start+q*beat,'bass',1,root_note)
                for q in [.5,1.5,2.5,3.5]: hit(start+q*beat,'chord',1,root_note*4)
        fade = min(round(.025*rate),len(audio)//2)
        audio[:fade] *= np.linspace(0,1,fade)
        audio[-fade:] *= np.linspace(1,0,fade)
        audio *= .72/max(.72,float(np.max(np.abs(audio))))
        ident=style+revision
        filename=style+'_microduck'+revision+'.ogg'
        with tempfile.TemporaryDirectory(prefix='microduck-music-') as temporary:
            wav=Path(temporary)/'render.wav'
            with wave.open(str(wav),'wb') as output:
                output.setnchannels(1); output.setsampwidth(2); output.setframerate(rate)
                output.writeframes((audio*32767).astype('<i2').tobytes())
            subprocess.run(['/opt/homebrew/bin/ffmpeg','-v','error','-y','-i',str(wav),'-c:a','libopus','-b:a','32k',str(out/filename)],check=True)
        binary=(out/filename).read_bytes()
        asset={'duration':duration,'bpm':bpm,'src':'data:audio/ogg;base64,'+base64.b64encode(binary).decode('ascii')}
        (assets/(ident+'.json')).write_text(json.dumps(asset,separators=(',',':'))+'\n')
        report={'id':ident,'file':filename,'duration':duration,'bpm':bpm,'bytes':len(binary),
                'sha256':hashlib.sha256(binary).hexdigest(),'rms':float(np.sqrt(np.mean(audio**2))),
                'peak':float(np.max(np.abs(audio))),'originalComposition':True}
        reports.append(report)
        print(json.dumps(report),flush=True)
(out/'manifest.json').write_text(json.dumps({'description':'Original synthesized genre rhythm arrangements; no sampled commercial recordings or copied song melodies.', 'sampleRate':rate,'tracks':reports},indent=2)+'\n')
