"""Build credited 32-beat excerpts from the named SoundHelix MP3 downloads.

Requires ffmpeg. Pass the directory containing song-17.mp3, song-8.mp3 and
song-1.mp3. Source BPM/offsets are onset-grid estimates; phrase downbeats are
not verified. atempo normalizes the excerpts to 120 BPM without shifting pitch.
"""
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import sys

TRACKS = (
    (17, "The Stationary Ark — Low pH Arktic Clubmix", 141, 20.4103),
    (8, "Spy vs. Spy — Chill-out Acid Squeeze Mix", 144, 20.0434),
    (1, "SoundHelix Song 1", 135, 21.3796),
)


def main():
    source_root = Path(sys.argv[1])
    output_root = Path(__file__).resolve().parents[1] / 'src/client/dance-audio'
    for number, title, bpm, offset in TRACKS:
        source = source_root / f'song-{number}.mp3'
        seconds = 32 * 60 / bpm
        audio = subprocess.check_output([
            'ffmpeg', '-v', 'error', '-ss', str(offset), '-i', str(source),
            '-af', f'atrim=duration={seconds},asetpts=PTS-STARTPTS,atempo={120 / bpm},apad,atrim=duration=16,afade=t=in:d=0.01,afade=t=out:st=15.99:d=0.01',
            '-ar', '48000', '-ac', '2', '-c:a', 'libopus', '-b:a', '96k', '-f', 'ogg', '-',
        ])
        record = {
            'duration': 16, 'bpm': 120, 'beats': 32, 'sourceBpmEstimate': bpm,
            'sourceOffsetSeconds': offset, 'title': title, 'artist': 'T. Schürger / SoundHelix',
            'source': f'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-{number}.mp3',
            'licenseUrl': 'https://www.soundhelix.com/audio-examples',
            'license': 'You may use these audio examples in any way you like, but you must give credit to SoundHelix and the artist of the respective song.',
            'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'audioSha256': hashlib.sha256(audio).hexdigest(),
            'src': 'data:audio/ogg;base64,' + base64.b64encode(audio).decode('ascii'),
        }
        target = output_root / f'soundhelix-{number}.json'
        target.write_text(json.dumps(record, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
        print(f'{target.name}: {len(audio)} audio bytes, 32 beats / 16 seconds at 120 BPM')


if __name__ == '__main__':
    main()
