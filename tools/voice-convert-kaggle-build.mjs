#!/usr/bin/env node
/*
 * Packs tools/voice-convert-kaggle.py into a one-cell Kaggle notebook, for File -> Import Notebook:
 *
 *   node tools/voice-convert-kaggle-build.mjs --to FILE.ipynb
 *
 * The cell carries the script compressed, checks it against its SHA-256, writes it out and runs it,
 * relaying its log line by line. Kaggle keeps what it leaves in /kaggle/working: the zip, report.json
 * and log.txt.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

export const SCRIPT = fileURLToPath(new URL('./voice-convert-kaggle.py', import.meta.url));

export function notebook(code) {
  const want = createHash('sha256').update(code, 'utf8').digest('hex');
  const packed = deflateSync(Buffer.from(code, 'utf8'), { level: 9 }).toString('base64');
  const cell = [
    "# Jessy's voice change on Kaggle's GPU: tools/voice-convert-kaggle.py (jessy-the-people-partner), packed.",
    "# Needs: Accelerator GPU T4, Internet on, and the private dataset of the owner's takes attached.",
    'import base64, hashlib, os, subprocess, sys, zlib',
    `WANT = '${want}'`,
    `CODE = zlib.decompress(base64.b64decode('${packed}')).decode('utf-8')`,
    "assert hashlib.sha256(CODE.encode('utf-8')).hexdigest() == WANT, 'the packed script is damaged'",
    "os.makedirs('/tmp/jessy-vc', exist_ok=True)",
    "path = '/tmp/jessy-vc/voice-convert-kaggle.py'",
    "with open(path, 'w', encoding='utf-8') as f:",
    '    f.write(CODE)',
    "p = subprocess.Popen([sys.executable, '-u', path, 'run'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,",
    "                     text=True, errors='replace')",
    'for line in p.stdout:',
    "    print(line, end='', flush=True)",
    'if p.wait():',
    "    raise RuntimeError(f'the voice change stopped (exit {p.returncode}); the lines above say why')",
  ];
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' },
      language_info: { name: 'python' },
      kaggle: { accelerator: 'nvidiaTeslaT4', isGpuEnabled: true, isInternetEnabled: true, language: 'python', sourceType: 'notebook' },
    },
    cells: [
      {
        cell_type: 'code',
        id: 'jessy-voice-change',
        metadata: {},
        execution_count: null,
        outputs: [],
        source: cell.map((line, i) => (i < cell.length - 1 ? `${line}\n` : line)),
      },
    ],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const at = process.argv.indexOf('--to');
  if (at < 0 || !process.argv[at + 1]) {
    console.error('Usage: node tools/voice-convert-kaggle-build.mjs --to FILE.ipynb');
    process.exit(1);
  }
  const to = resolve(process.argv[at + 1]);
  const code = readFileSync(SCRIPT, 'utf8');
  const text = `${JSON.stringify(notebook(code), null, 1)}\n`;
  writeFileSync(to, text);
  console.log(`${to}: ${(text.length / 1024).toFixed(1)} KB, script sha256 ${createHash('sha256').update(code, 'utf8').digest('hex').slice(0, 16)}`);
}
