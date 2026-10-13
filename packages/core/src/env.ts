// Environment check for the settings page: what Studio needs on this machine and whether it is there.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { FFMPEG, findChrome } from '@frametell/engine/tools/bins.mjs';

import type { EnvCheck as Check } from './types.js';
import { tr } from './i18n.js';

export function checkEnv(): Check[] {
  const chrome = findChrome();
  const ff = spawnSync(FFMPEG, ['-version'], { encoding: 'utf8' });
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  const [major, minor] = process.versions.node.split('.').map(Number);
  return [
    { id: 'chrome', ok: !!chrome && fs.existsSync(chrome), detail: chrome || tr('没有找到 Chrome / Edge', 'Chrome / Edge not found'), fix: tr('安装 Google Chrome，或设置 CHROME_PATH 指向一个 Chromium 内核浏览器', 'Install Google Chrome, or point CHROME_PATH at a Chromium-based browser') },
    { id: 'ffmpeg', ok: ff.status === 0, detail: ff.status === 0 ? ff.stdout.split('\n')[0] : tr('内置 ffmpeg 不可用', 'The bundled ffmpeg does not run'), fix: tr('重新安装帧言，或设置 FFMPEG_PATH', 'Reinstall Frametell, or set FFMPEG_PATH') },
    { id: 'git', ok: git.status === 0, detail: git.status === 0 ? git.stdout.trim() : tr('没有找到 git（撤销功能需要它）', 'git not found (undo needs it)'), fix: tr('安装 git：https://git-scm.com', 'Install git: https://git-scm.com') },
    { id: 'node', ok: major > 22 || (major === 22 && minor >= 19), detail: `Node ${process.versions.node}`, fix: tr('升级到 Node 22.19 或更新版本', 'Upgrade to Node 22.19 or later') },
  ];
}
