// Where the external binaries come from. Studio passes explicit paths through the environment; standalone use falls
// back to the bundled ffmpeg-static / ffprobe-static and to a Chrome-family browser already installed on the machine.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const tryRequire = (id) => { try { return require(id); } catch { return null; } };

export const FFMPEG = process.env.FFMPEG_PATH || tryRequire('ffmpeg-static') || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH || tryRequire('ffprobe-static')?.path || 'ffprobe';

const CHROME_CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/local/bin/chromium', '/usr/bin/microsoft-edge'],
  win32: [
    path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
  ],
};

/** A Chrome-family executable: CHROME_PATH, else the first installed browser, else undefined (Playwright's own Chromium). */
export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  return (CHROME_CANDIDATES[process.platform] || []).find((p) => fs.existsSync(p));
}
