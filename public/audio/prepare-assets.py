"""Rebuild PaperPilot audio assets. Requires Python 3 + macOS afconvert.
Only this maintainer script uses a remote URL; application playback is local.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import array
import hashlib
import json
import math
import random
import subprocess
import tempfile
import urllib.request
import wave

ROOT = Path(__file__).resolve().parent
RATE = 24000
NOTES = ['C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6']


def write_wave(path, samples):
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = array.array('h', (round(max(-1, min(1, x)) * 32767) for x in samples))
    with wave.open(str(path), 'wb') as output:
        output.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        output.writeframes(pcm.tobytes())


def piano(note):
    url = f'https://tonejs.github.io/audio/salamander/{note}.mp3'
    with tempfile.TemporaryDirectory(prefix='paperpilot-audio-') as folder:
        source = Path(folder) / f'{note}.mp3'
        decoded = Path(folder) / 'decoded.wav'
        urllib.request.urlretrieve(url, source)
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        subprocess.run(['afconvert', '-f', 'WAVE', '-d', f'LEI16@{RATE}', '-c', '1', '-m', '0', str(source), str(decoded)], check=True)
        with wave.open(str(decoded)) as input_file:
            samples = array.array('h', input_file.readframes(input_file.getnframes()))
    peak = max(abs(x) for x in samples)
    onset = next((i for i, x in enumerate(samples) if abs(x) > peak * 0.005), 0)
    start = max(0, onset - round(RATE * 0.002))
    samples = samples[start:start + 7 * RATE]
    prepared = [x * 0.74 / peak for x in samples]
    fade = int(RATE * 0.2)
    for i in range(fade):
        prepared[len(prepared) - fade + i] *= 1 - i / fade
    write_wave(ROOT / 'piano' / f'{note}.wav', prepared)
    return {'file': f'piano/{note}.wav', 'source': url, 'source_sha256': digest, 'leading_trim_ms': round(start / RATE * 1000, 3), 'duration': len(prepared) / RATE}


def one_shots():
    rng = random.Random(8686)
    sin = math.sin
    exp = math.exp
    tau = math.tau
    def render(name, duration, sample):
        data = [sample(i / RATE, i) for i in range(round(duration * RATE))]
        peak = max(abs(x) for x in data) or 1
        data = [x * 0.78 / peak for x in data]
        fade = min(120, len(data))
        for i in range(fade):
            data[-fade+i] *= 1 - i / fade
        write_wave(ROOT / 'oneshots' / f'{name}.wav', data)
    render('kick', 0.6, lambda t, i: sin(tau * (48*t + 5*(1-exp(-t*45)))) * exp(-t*9) + (rng.random()*2-1)*exp(-t*220)*0.1)
    render('snare', 0.38, lambda t, i: ((rng.random()*2-1)*0.72 + sin(tau*180*t)*0.28)*exp(-t*17)*(1-exp(-t*2000)))
    last = [0]
    def hat(t, i):
        noise = rng.random()*2-1
        high = noise - last[0]
        last[0] = noise
        return high*exp(-t*45)*(1-exp(-t*4000))
    render('hat', 0.18, hat)
    def clap(t, i):
        env = sum(exp(-(t-start)*70) for start in [0, 0.011, 0.023, 0.037] if t>=start)
        return (rng.random()*2-1)*env
    render('clap', 0.4, clap)
    def bloom(t, i):
        return sum(sin(tau*freq*t + sin(tau*.4*t)*.4) for freq in [261.626,329.628,391.995,523.251])/4*(1-exp(-t*10))*exp(-t*1.9)
    render('bloom', 2.7, bloom)
    def chime(t, i):
        return sum(sin(tau*freq*t)*exp(-t*(1.7+j*.6)) for j,freq in enumerate([784,1176,1568,2352]))/4*(1-exp(-t*700))
    render('chime', 2.6, chime)
    render('orbit', 2.4, lambda t,i: sin(tau*(210*t+75*t*t)+sin(tau*4*t)*1.5)*(1-exp(-t*30))*exp(-t*1.8)*.7)
    def pulse(t, i):
        step = int(t/.16)
        if step >= 8: return 0
        pitch = [261.626,329.628,391.995,523.251,391.995,329.628,293.665,261.626][step]
        local = t-step*.16
        return (sin(tau*pitch*local)+.25*sin(tau*pitch*2*local))*exp(-local*22)*(1-exp(-local*1000))*exp(-t*.5)
    render('pulse', 1.5, pulse)


if __name__ == '__main__':
    (ROOT / 'piano').mkdir(parents=True, exist_ok=True)
    manifest = list(ThreadPoolExecutor(max_workers=4).map(piano, NOTES))
    (ROOT / 'piano' / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    urllib.request.urlretrieve('https://raw.githubusercontent.com/Tonejs/audio/master/salamander/README', ROOT / 'piano' / 'SOURCE-README.txt')
    one_shots()
    print(f'Prepared {len(manifest)} piano anchors and 8 original one-shots.')
