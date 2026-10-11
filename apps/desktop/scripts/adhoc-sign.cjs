// electron-builder afterPack: sign the macOS app ad hoc, before it goes into the dmg.
// Without a Developer ID the build is left with Electron's own signature, which no longer matches the renamed and
// filled bundle. Apple silicon refuses such an app once it has been downloaded: 「已损坏，无法打开」, with no way past it.
// Signed ad hoc, macOS only says it can't verify the developer, and the app opens after 「仍要打开」.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
