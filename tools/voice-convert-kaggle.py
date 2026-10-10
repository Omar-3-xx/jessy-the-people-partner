"""Jessy's voice on Kaggle's GPU: the owner's Arabic takes, spoken again in a computer-made young woman's voice.

Keeps what is his in every take (the Egyptian accent, the timing, the rise and fall of each sentence)
and replaces the voice itself. Only raising his voice kept it "exactly like my voice" (his verdict,
2026-09-19). Seed-VC (GPL-3.0, github.com/Plachtaa/seed-vc) does the change. Its 44 kHz model follows
his pitch line and moves it into the new voice's range. The new voice is no person's.
Kokoro-82M (Apache-2.0) reads a short English passage in one of its made-up voices, and ffmpeg makes
that voice a small a young woman's size.

On Kaggle, run it with a GPU T4, internet on, and the private dataset of his takes attached
(ar-001.webm to ar-028.webm). The notebook's one cell, built by voice-convert-kaggle-build.mjs, writes
this file and runs it. It checks every take against the hashes below, then makes three voices. It
converts every take into each one, doing ar-001 and ar-014 first so a short run still leaves
something to hear. It checks every result (length, level, pitch) and zips them all as FLAC:

    voice-1/ar-001.flac ...   ->   python tools/build-voice.py (after he picks a voice)

Locally, `python voice-convert-kaggle.py check` with JESSY_INPUT set to the recording folder runs
only the checks and the decoding. It installs and downloads nothing.
"""
import contextlib
import glob
import hashlib
import io
import json
import math
import os
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
import wave
import zipfile

SEEDVC = '51383efd921027683c89e5348211d93ff12ac2a8'  # github.com/Plachtaa/seed-vc main, 2025-04-20
IN_ROOT = os.environ.get('JESSY_INPUT', '/kaggle/input')
OUT = os.environ.get('JESSY_OUT', '/kaggle/working')
WORK = os.environ.get('JESSY_WORK', '/tmp/jessy-vc')
ZIP = 'jessy-voices-seedvc.zip'
STEPS, CFG = 50, 0.7  # diffusion steps (Seed-VC's best-quality range starts at 50) and its guidance
FIRST = ['ar-001', 'ar-014']  # converted first in every voice

# What Kokoro reads to give each voice its sound: warm and friendly, like a colleague who explains calmly. Its words never reach
# the results. Every word Jessy says comes from the owner's takes.
TEXT = ("Hi, I'm so glad you stopped by. Let's take it one step at a time, and go through it together. Your question is a good one, and the answer is simpler than it sounds. Here is what the law says, and here is what it means for you.")

# kokoro: the made-up voice it starts from. raise: how much smaller its throat and higher its pitch
# become (1.0 leaves an adult woman's size alone). hz: the finished voice's usual pitch. A young
# woman speaks at about 200 to 250 Hz; her recorded voice measured 195 to 216 Hz.
VOICES = [
    {'key': 'voice-1', 'kokoro': 'af_heart', 'raise': 1.00, 'hz': 225},
    {'key': 'voice-2', 'kokoro': 'af_bella', 'raise': 1.04, 'hz': 240},
    {'key': 'voice-3', 'kokoro': 'bf_emma', 'raise': 1.00, 'hz': 215},
]

# The first 16 hex digits of each take's SHA-256, as recorded on 2026-10-10.
TAKES = {
    'ar-001': '0ee5f81f90f3e420', 'ar-002': '1f206134251e6744', 'ar-003': '7852336093b4fc3c',
    'ar-004': 'c724b48207ac640b', 'ar-005': '2313c44e1d8792c3', 'ar-006': 'd12fb04f9afd2d14',
    'ar-007': '9a89d0df4badfd27', 'ar-008': 'd5c88ee68283e54b', 'ar-009': '0c011d7fbe289e5c',
    'ar-010': '87048ac98a4df781', 'ar-011': 'b706faa921e72ba8', 'ar-012': '2c32c6f658447f2e',
    'ar-013': '7231c057b3213f68', 'ar-014': '3dd239dfb59f8d4c', 'ar-015': 'afcb560b71c2aa3e',
    'ar-016': '259573a81620a277', 'ar-017': '85d5cd1d6c7ad5f1', 'ar-018': 'aff1d3be51ed1374',
    'ar-019': 'd641ec91b1dae679', 'ar-020': 'e97bf8336c64a7bd', 'ar-021': 'd20c20ebd5fd09fa',
    'ar-022': '9c33b400fb8b07c7', 'ar-023': '33f76500e3323ba1', 'ar-024': 'e5fd358776c1db9f',
    'ar-025': 'd8ba52ab87ebc195', 'ar-026': '6e37ec1af4a11d84', 'ar-027': '908defbf5c3523b2',
    'ar-028': '1f23c9e04aa51d38',
}

SELF = os.path.abspath(__file__)
T0 = time.time()
LOG = []


def log(*parts):
    line = f'{time.time() - T0:7.1f}s  ' + ' '.join(str(p) for p in parts)
    LOG.append(line)
    print(line, flush=True)


def run(cmd, cwd=None, env=None, quiet=False, say=True):
    """Runs a command and relays its output to the log (only its last lines, if quiet and it fails).
    Stops the job if it fails."""
    if say:
        log('$', ' '.join([os.path.basename(cmd[0])] + cmd[1:])[:240])
    p = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, errors='replace')
    tail = []
    for raw in p.stdout:
        line = raw.rstrip()
        if not line:
            continue
        tail = (tail + [line])[-80:]
        if not quiet:
            log('  |', line[:400])
    if p.wait() != 0:
        if quiet:
            for line in tail:
                log('  |', line[:400])
        raise SystemExit(f'STOPPED: {os.path.basename(cmd[0])} {cmd[1] if len(cmd) > 1 else ""} '
                         f'failed with exit code {p.returncode}.')


def child_env():
    env = dict(os.environ, HF_HOME=f'{WORK}/hf', HF_HUB_DISABLE_PROGRESS_BARS='1', TQDM_DISABLE='1',
               USE_TF='0', TOKENIZERS_PARALLELISM='false', PYTHONUNBUFFERED='1', PYTHONWARNINGS='ignore',
               # Seed-VC's checkpoints are older than torch's weights-only default.
               TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD='1')
    env.pop('HF_TOKEN', None)  # every file used is public: no key is needed, so none is sent
    return env


def sha16(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()[:16]


def find_takes():
    found, other = {}, 0
    for path in sorted(glob.glob(os.path.join(IN_ROOT, '**', 'ar-[0-9][0-9][0-9].webm'), recursive=True)):
        name = os.path.basename(path)[:-len('.webm')]
        if name in found:
            continue
        if TAKES.get(name) == sha16(path):
            found[name] = path
        else:
            other += 1
    missing = [name for name in TAKES if name not in found]
    log(f'takes: {len(found)} of {len(TAKES)} found and matched'
        + (f', {other} other files left out' if other else ''))
    if missing:
        raise SystemExit(f'STOPPED: {len(missing)} takes are missing or changed ({", ".join(missing[:8])}'
                         f'{"..." if len(missing) > 8 else ""}). Attach the dataset of his takes.')
    return found


def need_gpu():
    try:
        out = subprocess.run(['nvidia-smi', '-L'], capture_output=True, text=True).stdout.strip()
    except FileNotFoundError:
        out = ''
    if 'GPU' not in out:
        raise SystemExit('STOPPED: no GPU. In the notebook settings choose Accelerator: GPU T4, then run again.')
    log('gpu:', out.splitlines()[0])


def need_ffmpeg():
    if shutil.which('ffmpeg'):
        return
    run(['apt-get', 'update', '-qq'], quiet=True)
    run(['apt-get', 'install', '-y', '-qq', 'ffmpeg'], quiet=True)


def seconds(path):
    with wave.open(path) as w:
        return w.getnframes() / w.getframerate()


def decode(takes):
    os.makedirs(f'{WORK}/src', exist_ok=True)
    total, longest = 0.0, (0.0, '')
    for name, path in sorted(takes.items()):
        dst = f'{WORK}/src/{name}.wav'
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-ac', '1', '-ar', '44100',
             '-c:a', 'pcm_s16le', dst], quiet=True, say=False)
        s = seconds(dst)
        if s < 0.3:
            raise SystemExit(f'STOPPED: {name} decoded to {s:.2f} s of sound.')
        total += s
        longest = max(longest, (s, name))
    log(f'decoded: {len(takes)} takes, {total / 60:.1f} min in all, the longest {longest[1]} at {longest[0]:.1f} s')


def install():
    from importlib import metadata
    keep = []
    for name in ('torch', 'torchaudio', 'torchvision', 'numpy'):
        try:
            keep.append(f'{name}=={metadata.version(name)}')
        except metadata.PackageNotFoundError:
            pass
    with open(f'{WORK}/keep.txt', 'w') as f:
        f.write('\n'.join(keep) + '\n')
    log('python', sys.version.split()[0], '| kept as installed:', ', '.join(keep))
    extra = ['--ignore-requires-python'] if sys.version_info >= (3, 13) else []
    pip = [sys.executable, '-m', 'pip', 'install', '-q', '--disable-pip-version-check', '--no-input']
    run(pip + ['-c', f'{WORK}/keep.txt', *extra,
               # what kokoro and misaki[en] need. NOT spacy-curated-transformers: it wants thinc 9 (a dev
               # build with no wheel, so pip tries to compile it and stops on Kaggle's Python 3.13), and the
               # English phonemizer only uses spacy itself.
               'spacy', 'loguru', 'addict', 'regex', 'num2words', 'phonemizer-fork', 'espeakng-loader',
               'transformers==4.46.3', 'munch==4.0.0', 'einops==0.8.0',
               # BigVGAN's loader still takes the arguments huggingface_hub 1.0 dropped
               'huggingface-hub>=0.28.1,<1.0',
               'hydra-core==1.3.2', 'soundfile', 'librosa',
               # what descript-audio-codec needs to import, without its pin of an old protobuf
               'argbind>=0.3.7', 'julius', 'flatten-dict', 'randomname', 'markdown2', 'ffmpy', 'pyloudnorm',
               'pystoi', 'torch-stoi', 'importlib-resources'], quiet=True)
    # both say Python <3.13 in their metadata and work on it; their other needs are listed above
    run(pip + ['--no-deps', '--ignore-requires-python', 'kokoro==0.9.4', 'misaki==0.9.4'], quiet=True)
    run(pip + ['--no-deps', 'descript-audio-codec==1.0.0', 'descript-audiotools==0.7.2'], quiet=True)


def fetch_seedvc():
    dst = f'{WORK}/seed-vc'
    if not os.path.exists(f'{dst}/inference.py'):
        tgz = f'{WORK}/seed-vc.tar.gz'
        urllib.request.urlretrieve(f'https://codeload.github.com/Plachtaa/seed-vc/tar.gz/{SEEDVC}', tgz)
        with tarfile.open(tgz) as t:
            try:
                t.extractall(WORK, filter='data')
            except TypeError:
                t.extractall(WORK)
        os.rename(f'{WORK}/seed-vc-{SEEDVC}', dst)
        log(f'seed-vc: {SEEDVC[:7]}, {os.path.getsize(tgz) / 1e6:.0f} MB')
    return dst


def make_voices():
    os.makedirs(f'{WORK}/refs', exist_ok=True)
    cfg = f'{WORK}/refs.json'
    with open(cfg, 'w') as f:
        json.dump({'text': TEXT, 'jobs': [[v['kokoro'], f'{WORK}/refs/kokoro-{v["kokoro"]}.wav'] for v in VOICES]}, f)
    run([sys.executable, '-u', SELF, 'refs', cfg], env=child_env())
    for v in VOICES:
        k = v['raise']
        dst = f'{WORK}/refs/{v["key"]}.wav'
        # Played faster (everything higher: pitch and throat), then stretched back to its length.
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', f'{WORK}/refs/kokoro-{v["kokoro"]}.wav',
             '-af', f'asetrate={round(24000 * k)},aresample=24000,atempo={1 / k:.6f}', '-ac', '1',
             '-c:a', 'pcm_s16le', dst], quiet=True, say=False)
        log(f'{v["key"]}: Kokoro {v["kokoro"]} raised x{k}, {seconds(dst):.1f} s')


def pack():
    if not os.path.isdir(OUT):
        return
    zpath = f'{OUT}/{ZIP}'
    report = f'{WORK}/report.json'
    names = sorted(glob.glob(f'{WORK}/out/*/*.flac'))
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
        for path in names:
            z.write(path, os.path.relpath(path, f'{WORK}/out').replace(os.sep, '/'))
        for path in sorted(glob.glob(f'{WORK}/refs/*.wav')):
            z.write(path, 'voices/' + os.path.basename(path))
        if os.path.exists(report):
            z.write(report, 'report.json')
            shutil.copy(report, f'{OUT}/report.json')
        z.writestr('log.txt', '\n'.join(LOG) + '\n')
    with open(f'{OUT}/log.txt', 'w') as f:
        f.write('\n'.join(LOG) + '\n')
    md5 = hashlib.md5(open(zpath, 'rb').read()).hexdigest()
    log(f'zip: {ZIP}, {len(names)} voice files, {os.path.getsize(zpath) / 1e6:.1f} MB, md5 {md5}')


def main(check_only):
    log(f'Jessy voice change | Seed-VC {SEEDVC[:7]} | {len(VOICES)} voices x {len(TAKES)} takes | {STEPS} steps')
    os.makedirs(WORK, exist_ok=True)
    takes = find_takes()
    if not check_only:
        need_gpu()
        need_ffmpeg()
    decode(takes)
    if check_only:
        log('check: done. Nothing was installed or downloaded.')
        return
    os.makedirs(OUT, exist_ok=True)
    try:
        install()
        seedvc = fetch_seedvc()
        make_voices()
        cfg = f'{WORK}/convert.json'
        with open(cfg, 'w') as f:
            json.dump({'work': WORK, 'steps': STEPS, 'cfg': CFG, 'first': FIRST, 'takes': sorted(takes),
                       'voices': VOICES}, f)
        run([sys.executable, '-u', SELF, 'convert', cfg], cwd=seedvc, env=child_env())
        log(f'done in {(time.time() - T0) / 60:.1f} min')
    finally:
        pack()


def refs_worker(cfg_path):
    """Kokoro reads TEXT in each made-up voice (runs in its own Python, after the installs)."""
    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline
    with open(cfg_path) as f:
        cfg = json.load(f)
    pipes = {}
    for voice, path in cfg['jobs']:
        lang = voice[0]  # a: American English, b: British
        if lang not in pipes:
            first = next(iter(pipes.values()), None)
            pipes[lang] = KPipeline(lang_code=lang, repo_id='hexgrad/Kokoro-82M',
                                    model=first.model if first else True)
        parts = []
        for _, _, audio in pipes[lang](cfg['text'], voice=voice, speed=1.0):
            if audio is not None:
                parts.append(audio.detach().cpu().numpy() if hasattr(audio, 'detach') else np.asarray(audio))
        wav = np.concatenate(parts).astype('float32')
        sf.write(path, wav, 24000)
        print(f'{voice}: {len(wav) / 24000:.1f} s', flush=True)


def convert_worker(cfg_path):
    """Loads Seed-VC once and converts every take into every voice (runs inside the seed-vc folder)."""
    import types
    import librosa
    import numpy as np
    import soundfile as sf
    import torch
    import torchaudio
    import transformers
    with open(cfg_path) as f:
        cfg = json.load(f)
    work = cfg['work']
    t0 = time.time()

    def say(*parts):
        print(f'[{time.time() - t0:7.1f}s]', *parts, flush=True)

    say('python', sys.version.split()[0], '| torch', torch.__version__, '| torchaudio', torchaudio.__version__,
        '| transformers', transformers.__version__, '| librosa', librosa.__version__, '| numpy', np.__version__)
    sys.path.insert(0, os.getcwd())
    import inference as I  # Seed-VC's own inference.py

    def args(src=None, ref=None, semi=0.0, fp16=True):
        return types.SimpleNamespace(
            source=src, target=ref, output=f'{work}/scratch', diffusion_steps=cfg['steps'], length_adjust=1.0,
            inference_cfg_rate=cfg['cfg'], f0_condition=True, auto_f0_adjust=True, semi_tone_shift=semi,
            checkpoint=None, config=None, fp16=fp16)

    # Its main() loads every model for every file: load them once and hand main() the same ones.
    models = I.load_models(args())
    say('models loaded on', I.device)

    def cached(a):
        I.fp16 = a.fp16
        return models

    I.load_models = cached
    f0_fn = models[2]
    got = {}

    def keep(path, wav, sr, *rest, **kw):  # main() ends by saving; keep the sound instead
        got['wav'] = wav.detach().float().cpu().numpy().reshape(-1)
        got['sr'] = sr

    I.torchaudio.save = keep

    def usual_hz(wav, sr):
        w16 = librosa.resample(np.asarray(wav, dtype='float32'), orig_sr=sr, target_sr=16000)
        f0 = np.asarray(f0_fn(torch.from_numpy(w16).to(I.device), thred=0.03))
        voiced = f0[f0 > 1]
        return float(np.median(voiced)) if len(voiced) else 0.0

    voices = {}
    for v in cfg['voices']:
        ref = f'{work}/refs/{v["key"]}.wav'
        wav, _ = librosa.load(ref, sr=44100)
        base = usual_hz(wav[:44100 * 25], 44100)  # main() measures the same first 25 s
        semi = 12 * math.log2(v['hz'] / base)
        voices[v['key']] = {'ref': ref, 'semi': semi, 'hz': v['hz']}
        say(f'{v["key"]}: its own pitch {base:.0f} Hz, so {semi:+.2f} semitones to reach {v["hz"]} Hz')

    first = [t for t in cfg['first'] if t in cfg['takes']]
    order = [(k, t) for t in first for k in voices] + [(k, t) for k in voices for t in cfg['takes'] if t not in first]
    report, his_hz, failed_in_a_row = [], {}, 0
    for i, (key, take) in enumerate(order, 1):
        v = voices[key]
        src = f'{work}/src/{take}.wav'
        dst = f'{work}/out/{key}/{take}.flac'
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        row = {'voice': key, 'take': take, 'ok': False}
        t1 = time.time()
        try:
            src_wav, _ = librosa.load(src, sr=44100)
            row['src_s'] = round(len(src_wav) / 44100, 2)
            if take not in his_hz:
                his_hz[take] = usual_hz(src_wav, 44100)
            row['src_hz'] = round(his_hz[take])
            out = None
            for fp16 in (True, False):
                got.clear()
                with contextlib.redirect_stdout(io.StringIO()):  # main() prints a speed line per file
                    I.main(args(src, v['ref'], v['semi'], fp16))
                out = got.get('wav')
                if out is not None and np.isfinite(out).all() and np.abs(out).max() > 0.01:
                    row['fp16'] = fp16
                    break
                say(f'{key} {take}: no usable sound in {"fp16, trying fp32" if fp16 else "fp32 either"}')
                out = None
            if out is None:
                raise RuntimeError('no usable sound in fp16 or fp32')
            out24 = librosa.resample(out, orig_sr=got['sr'], target_sr=24000)
            peak = float(np.abs(out24).max())
            if peak > 0.99:
                out24 = out24 * (0.99 / peak)
            sf.write(dst, out24, 24000, subtype='PCM_16', format='FLAC')
            row['out_s'] = round(len(out24) / 24000, 2)
            row['out_hz'] = round(usual_hz(out, got['sr']))
            stretch = row['out_s'] / row['src_s']
            if 0.95 <= stretch <= 1.05:
                row['ok'] = True
            else:
                row['why'] = f'its length changed x{stretch:.2f}'
            if not row['out_hz'] or abs(math.log2(row['out_hz'] / v['hz'])) > 0.2:
                row['note'] = f'pitch {row["out_hz"]} Hz, not about {v["hz"]}'
        except Exception as e:  # one bad take must not cost the others
            row['why'] = f'{type(e).__name__}: {e}'[:300]
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        row['secs'] = round(time.time() - t1, 1)
        report.append(row)
        with open(f'{work}/report.json', 'w') as f:
            json.dump(report, f, indent=1)
        say(f'{i:3}/{len(order)} {key} {take}: '
            + (f'{row["src_s"]} s, him {row["src_hz"]} Hz -> {row["out_hz"]} Hz'
               + ('' if row.get('fp16', True) else ', fp32') if 'out_hz' in row else 'FAILED')
            + (f' | {row["why"]}' if 'why' in row else '') + (f' | {row["note"]}' if 'note' in row else '')
            + f' | {row["secs"]} s')
        failed_in_a_row = 0 if row['ok'] else failed_in_a_row + 1
        if failed_in_a_row >= 6:
            say('STOPPED: 6 failures in a row. The lines above say why.')
            sys.exit(2)
    ok = sum(r['ok'] for r in report)
    say(f'converted: {ok} of {len(report)} ok'
        + ('' if ok == len(report) else ' | failed: ' + ', '.join(f'{r["voice"]} {r["take"]}' for r in report if not r['ok'])))
    if not ok:
        sys.exit(3)


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'run'
    if mode == 'refs':
        refs_worker(sys.argv[2])
    elif mode == 'convert':
        convert_worker(sys.argv[2])
    elif mode in ('run', 'check'):
        main(mode == 'check')
    else:
        raise SystemExit(f'unknown mode {mode!r}: run, check, refs or convert')
