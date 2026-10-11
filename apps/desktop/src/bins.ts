// What the main process needs set before the core loads. main.ts imports this module before @frametell/core.
//   ffmpeg: the packaged app carries its own in Resources/bin (see scripts/package.mjs). The engine reads FFMPEG_PATH
//     once, when it loads; render processes inherit it from the environment.
//   node: page agents call `node engine/tools/…` from their shell, on a machine that may have no Node installed: a `node`
//     launcher that runs this executable as plain Node goes first on PATH. (The core's own tool processes run the
//     executable directly with ELECTRON_RUN_AS_NODE, see nodeEnv in @frametell/agent.)
import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (app.isPackaged && !process.env.FFMPEG_PATH) {
  process.env.FFMPEG_PATH = path.join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

try {
  const dir = path.join(os.tmpdir(), `frametell-node-${process.getuid?.() ?? 'user'}`);
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') fs.writeFileSync(path.join(dir, 'node.cmd'), `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" %*\r\n`);
  else {
    const f = path.join(dir, 'node');
    fs.writeFileSync(f, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "$@"\n`);
    fs.chmodSync(f, 0o755);
  }
  process.env.PATH = dir + path.delimiter + (process.env.PATH || '');
} catch {}
