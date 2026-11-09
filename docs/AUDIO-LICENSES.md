# Bundled audio and attribution

## Piano

**Salamander Grand Piano — Alexander Holm**, licensed under
[Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/).
The author does not endorse PaperPilot.

The 13 recordings in `public/audio/piano` are a compact derivative of the
[Tone.js Salamander MP3 distribution](https://github.com/Tonejs/audio/tree/master/salamander).
Its [original README and license notice](https://github.com/Tonejs/audio/blob/master/salamander/README)
are preserved in `public/audio/piano/SOURCE-README.txt`.
The [original instrument archive](https://archive.org/details/SalamanderGrandPianoV3)
and [maintained instrument repository](https://github.com/sfzinstruments/SalamanderGrandPiano)
provide the full instrument. This project does not bundle Tone.js code.

Downloaded November 8, 2026. Each source URL and SHA-256 are recorded in
`public/audio/piano/manifest.json`. Prepared anchor pitches are C3, D♯3, F♯3,
A3, C4, D♯4, F♯4, A4, C5, D♯5, F♯5, A5, and C6. Nearby notes are repitched.

Changes made for this app:

- Decoded and resampled to 24 kHz, 16-bit mono PCM WAV using macOS `afconvert`.
- Kept the left microphone channel, avoiding phase cancellation from summing
  the original stereo microphones.
- Trimmed leading silence to two milliseconds before the first sample above
  0.5% of the recording's peak.
- Normalized each anchor to 0.74 peak amplitude for fixed-velocity playback.
- Limited each anchor to seven seconds, with a 200 ms fade at the end.
- Applied small attack/release envelopes and optional filtering/reverb during
  playback. The “Felt piano” preset is a filtered variant of these same samples,
  not a separately recorded felt piano.

Keep this attribution and the original license notice when redistributing the
samples or the app. The sample license is separate from any software license.

## Drums and soundboard

`public/audio/oneshots/{kick,snare,hat,clap,bloom,chime,orbit,pulse}.wav` are original
procedurally generated sounds created for PaperPilot. They contain no third-party
recordings. The synthesis is reproduced by `public/audio/prepare-assets.py` with
a deterministic random seed. These generated assets are provided under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

Kick, snare, hat, and clap are synthesized percussion. Bloom is a soft chord,
Chime a bell-like tone, Orbit a rising electronic effect, and Pulse a short
arpeggio. They are not recordings of real-world instruments or licensed songs.

## Runtime behavior

All 21 WAV files are bundled locally and decoded before the instrument is
armed. Playback never contacts a remote host. The only network download code
is in the optional maintainer preparation script, which is not used by the app.

The sampler uses a single fixed velocity layer, up to 48 simultaneous voices,
and at most seven seconds of recorded decay per anchor. Octave transposition
changes sample duration. Sustain delays note release; it does not loop samples
indefinitely. If the piano bank fails to load completely, the engine explicitly
reports “Synth fallback · piano samples unavailable” and uses a local triangle
oscillator instead. Missing one-shots are reported in `assetError`.

`getDiagnostics()` reports browser base/output latency in seconds. These are
not physical-contact-to-sound measurements and exclude camera and input delay.
