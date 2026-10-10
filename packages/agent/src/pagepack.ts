// The page agent's reference pack: everything it would otherwise dig out of engine/ with ls / grep / sed. Measured on
// a real run, a quarter of all tokens went to that digging; handing it over up front cuts it out.
//   - the style's components, as signatures with their doc comments (generated from the lib source)
//   - one complete page from the style's benchmark project, as a worked example of the grammar
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE_DIR } from '@frametell/engine/tools/project.mjs';

/** "P.name(args)" + its doc comment, for every `B.name = function (args)` in a component file */
export function componentDocs(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /\/\*\*([\s\S]*?)\*\/\s*B\.(\w+)\s*=\s*function\s*\(([^)]*)\)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const doc = m[1].split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean).join(' ');
    out.push(`- \`P.${m[2]}(${m[3].trim()})\` — ${doc.replace(/^\w+\([^)]*\):?\s*/, '')}`);
  }
  return out;
}

/** a short benchmark page for the style (the most beats in the fewest lines), or undefined */
function examplePage(style: string): { id: string; code: string } | undefined {
  const dir = path.join(ENGINE_DIR, 'styles', style, 'example', 'pages');
  if (!fs.existsSync(dir)) return undefined;
  const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => ({ id: f.replace(/\.js$/, ''), code: fs.readFileSync(path.join(dir, f), 'utf8') }));
  return pages.filter((p) => p.code.split('\n').length <= 30).sort((a, b) => (b.code.match(/P\.c\w?\(/g)?.length ?? 0) - (a.code.match(/P\.c\w?\(/g)?.length ?? 0))[0];
}

export function pagePack(style: string, extras: string[]): string {
  const parts: string[] = ['# 本片的组件与范例（已经为你准备好）', '下面这些组件已经登记在 `META.extras` 里，页面里直接 `P.xxx(...)` 调用，**不要**再运行 use-extra 登记它们，也不用去 engine/ 里找源码。'];
  for (const e of extras) {
    const f = path.join(ENGINE_DIR, e.replace(/^engine\//, ''));
    if (!fs.existsSync(f)) continue;
    const docs = componentDocs(f);
    if (docs.length) parts.push(`## ${path.basename(e)}`, ...docs);
  }
  const ex = examplePage(style);
  if (ex) parts.push(`## 范例：标杆片的 ${ex.id}`, '一页完整的代码，照这个写法组织你的页面（物、动作、卡点、镜头、数字落在物上），不要照抄内容。', '```js', ex.code.trim(), '```');
  return parts.join('\n');
}
