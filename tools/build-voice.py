# -*- coding: utf-8 -*-
"""Her recorded Arabic lines, from the raw browser recordings to what the site serves.

The recorder page (public/record/recorder.html) saves one WebM/Opus file per line,
named with the line's number. Those masters are kept in voice/raw/ because they
cannot be made again; this turns them into what the browser plays:

  trim    the silence before the first word and after the last one, found by
          level rather than by hand
  level   loudnorm in two passes to -16 LUFS, because every master came back
          between -31 and -35 dB mean: the browser recorded quietly, not badly
  encode  AAC in an .m4a, which every phone and desktop browser plays; Opus in
          WebM is smaller but silent on an iPhone before 17.5

It then writes src/lib/talk/clips.ts, the map the site reads: knowledge-base id
to file and length. Nothing here runs at build time or in CI — it is run by hand
when a line is re-recorded, and its output is committed.

  python tools/build-voice.py            # voice/raw -> public/voice + clips.ts
  python tools/build-voice.py <dir>      # from somewhere else, e.g. a fresh download
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "voice", "raw")
OUT = os.path.join(ROOT, "public", "voice")
MANIFEST = os.path.join(ROOT, "src", "lib", "talk", "clips.ts")

# Loud enough to sit beside a podcast, with headroom left for the phone's own limiter.
LUFS, PEAK = -16.0, -1.5
# Quieter than this for this long is the room, not a word.
FLOOR, GAP = "-38dB", 0.45


def ffmpeg(args):
    return subprocess.run(["ffmpeg", "-hide_banner", "-y"] + args,
                          capture_output=True, text=True, errors="replace").stderr


def ids_in_order():
    """The knowledge base's ids, in the order kb-data.ts lists them: ar-001 is the first."""
    src = open(os.path.join(ROOT, "src", "lib", "kb-data.ts"), encoding="utf-8").read()
    found = re.findall(r"^\s*id: '([^']+)',", src, re.M)
    # FALLBACK is declared first in the file but read last; the recorder numbered it last too.
    rest = [i for i in found if i != "fallback"]
    return rest + ["fallback"]


def speech_span(path):
    """Where the first word starts and the last one ends, in seconds."""
    log = ffmpeg(["-i", path, "-af", "silencedetect=n=%s:d=%s" % (FLOOR, GAP), "-f", "null", "-"])
    dur = re.search(r"Duration: (\d+):(\d+):([\d.]+)", log)
    total = int(dur.group(1)) * 3600 + int(dur.group(2)) * 60 + float(dur.group(3))
    starts = [float(m) for m in re.findall(r"silence_start: ([\d.-]+)", log)]
    ends = [float(m) for m in re.findall(r"silence_end: ([\d.-]+)", log)]
    begin = ends[0] if starts and starts[0] < 0.5 and ends else 0.0
    finish = starts[-1] if starts and (total - starts[-1]) < 2.0 else total
    # A breath's worth of air either side, so no word is clipped by the trim itself.
    return max(0.0, begin - 0.12), min(total, finish + 0.22)


def measured(path, start, end):
    """loudnorm's first pass: what this clip actually measures, so the second can be exact."""
    log = ffmpeg(["-ss", "%.3f" % start, "-to", "%.3f" % end, "-i", path,
                  "-af", "highpass=f=85,loudnorm=I=%s:TP=%s:print_format=json" % (LUFS, PEAK),
                  "-f", "null", "-"])
    block = re.search(r"\{[^{}]*input_i[^{}]*\}", log, re.S)
    return json.loads(block.group(0)) if block else None


def length(path):
    log = ffmpeg(["-i", path, "-f", "null", "-"])
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", log)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def main():
    order = ids_in_order()
    rows = []
    for n, kb in enumerate(order, 1):
        clip = "ar-%03d" % n
        src = os.path.join(RAW, clip + ".webm")
        if not os.path.exists(src):
            print("%-9s %-22s no recording yet" % (clip, kb))
            continue
        start, end = speech_span(src)
        m = measured(src, start, end)
        second = "highpass=f=85,"
        if m:
            second += ("loudnorm=I=%s:TP=%s:linear=true:measured_I=%s:measured_TP=%s"
                       ":measured_LRA=%s:measured_thresh=%s:offset=%s"
                       % (LUFS, PEAK, m["input_i"], m["input_tp"], m["input_lra"],
                          m["input_thresh"], m["target_offset"]))
        else:
            second += "loudnorm=I=%s:TP=%s" % (LUFS, PEAK)
        dst = os.path.join(OUT, clip + ".m4a")
        ffmpeg(["-ss", "%.3f" % start, "-to", "%.3f" % end, "-i", src, "-vn",
                "-af", second, "-ac", "1", "-ar", "44100",
                "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", dst])
        if not os.path.exists(dst):
            raise SystemExit("ffmpeg wrote nothing for " + clip)
        out_len = length(dst)
        rows.append((kb, clip, out_len))
        print("%-9s %-22s %5.1fs -> %5.1fs  %6.0f kB  in %s LUFS" %
              (clip, kb, end - start, out_len, os.path.getsize(dst) / 1000.0,
               m["input_i"] if m else "?"))

    body = "".join("  '%s': { file: '%s', seconds: %.2f },\n" % (kb, clip, secs)
                   for kb, clip, secs in rows)
    open(MANIFEST, "w", encoding="utf-8", newline="\n").write(HEADER + body + FOOTER)
    print("\n%d clips, %.1f MB, %s" % (len(rows),
          sum(os.path.getsize(os.path.join(OUT, c + ".m4a")) for _k, c, _s in rows) / 1e6, MANIFEST))


HEADER = '''/*
 * Her own voice, one recording per knowledge-base answer.
 *
 * She reads the law from a fixed list of answers, so every one of them could be
 * read aloud by a person once and played ever after. What a model says cannot
 * be, and falls back to the browser's own voice.
 *
 * WRITTEN BY tools/build-voice.py — do not edit.
 */

export interface Clip {
  /** The recording's name, which is also its number: /voice/<file>.m4a. */
  file: string;
  /** Its real length, which paces her mouth before the file has loaded. */
  seconds: number;
}

export const CLIPS: Readonly<Record<string, Clip>> = {
'''

FOOTER = '''};

/** Where the recording of an answer lives, or null when that answer has none. */
export function clipFor(id: string | undefined): { src: string; seconds: number } | null {
  const clip = id ? CLIPS[id] : undefined;
  return clip ? { src: `/voice/${clip.file}.m4a`, seconds: clip.seconds } : null;
}
'''

main()
