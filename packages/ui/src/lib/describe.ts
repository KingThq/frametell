// Tool calls in plain words. The runtimes report a tool name and a (possibly truncated) JSON summary of its arguments;
// a knowledge creator should read「读资料《番茄工作法》」, not {"path":"materials/番茄工作法.md"}.
const pageNo = (id: string) => { const n = /p0*(\d+)/.exec(id); return n ? `第 ${n[1]} 页` : id; };
const base = (p: string) => p.split('/').pop()!.replace(/\.(md|markdown|txt)$/i, '');

function arg(summary: string, key: string): string | undefined {
  try { const v = JSON.parse(summary)[key]; if (typeof v === 'string') return v; } catch {}
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(summary);   // truncated JSON: take what is there
  return m ? m[1].replace(/\\"/g, '"').replace(/…$/, '') : undefined;
}

function aboutPath(p: string, verb: '读' | '写' | '改'): string {
  if (!p) return verb === '读' ? '读文件' : verb === '写' ? '写文件' : '修改文件';
  if (p.startsWith('materials/')) return verb === '读' ? `读资料《${base(p)}》` : `整理资料《${base(p)}》`;
  if (/(^|\/)storyboard\.json$/.test(p)) return verb === '读' ? '看分镜' : verb === '写' ? '写分镜' : '修改分镜';
  if (/(^|\/)script\.js$/.test(p)) return verb === '读' ? '看口播稿' : verb === '写' ? '写口播稿' : '修改口播稿';
  if (p === 'pages/p.js') return verb === '读' ? '看画面' : '修改画面';
  const page = /pages\/(p\d+)\.js$/.exec(p);
  if (page) return verb === '读' ? `看${pageNo(page[1])}的画面` : verb === '写' ? `画${pageNo(page[1])}` : `修改${pageNo(page[1])}`;
  if (/out\/snap\//.test(p)) return '看检查截图';
  if (/revision\.json$/.test(p)) return '写修改计划';
  if (/^engine\//.test(p)) return '查阅画面说明';
  if (/voice\.js$/.test(p)) return '看配音时间';
  return `${verb === '读' ? '读' : verb === '写' ? '写' : '修改'} ${p.split('/').pop()}`;
}

function aboutCommand(c: string): string {
  if (/storyboard-lint/.test(c)) return '检查分镜';
  if (/script\.mjs/.test(c)) return '估算口播时长';
  if (/lint\.mjs/.test(c)) return '检查版面';
  if (/snap\.mjs/.test(c)) return '截图看效果';
  if (/use-extra/.test(c)) return '加载画面组件';
  if (/logos\.mjs/.test(c)) return '准备品牌标志';
  if (/pages\.mjs|times\.mjs/.test(c)) return '看时间轴';
  if (/^\s*(ls|find|grep|rg|cat|sed|head|tail|wc)\b/.test(c)) return '查找文件';
  return '运行一条命令';
}

/** an edit whose path was cut off (older logs put the replaced text first): tell the file from the text it changes */
function guessPath(summary: string): string {
  const codex = /^(?:update|add|delete) (\S+)/.exec(summary);   // Codex: "update pages/p01.js"
  if (codex) return codex[1];
  if (/\\?"(say|object|action|beats|camera)\\?"\s*:/.test(summary)) return 'storyboard.json';
  if (/\bcues\b|section:|PAGES|META/.test(summary)) return 'script.js';
  if (/\bP\.\w+\(|\bs\(\\?'|Math\.|renderAt/.test(summary)) return 'pages/p.js';
  return '';
}

/** a short sentence for one tool call */
export function describeTool(name: string, summary: string): string {
  const n = name.toLowerCase();
  if (n === 'read') return aboutPath(arg(summary, 'path') || arg(summary, 'file_path') || '', '读');
  if (n === 'write') return aboutPath(arg(summary, 'path') || arg(summary, 'file_path') || '', '写');
  if (n === 'edit') return aboutPath(arg(summary, 'path') || arg(summary, 'file_path') || guessPath(summary), '改');
  if (n === 'bash') return aboutCommand(arg(summary, 'command') || summary);
  if (n === 'glob' || n === 'grep') return '查找文件';
  return name;
}

/** collapse runs of the same description: 「读资料《A》、写分镜、检查分镜 2 次」 */
export function summarizeTools(calls: { name: string; summary: string }[]): { text: string; count: number }[] {
  const out: { text: string; count: number }[] = [];
  for (const c of calls) {
    const text = describeTool(c.name, c.summary);
    const last = out[out.length - 1];
    if (last && last.text === text) last.count++; else out.push({ text, count: 1 });
  }
  return out;
}

export const pageName = pageNo;

/** one step with its repeats, in words: 「修改口播稿 2 次」 */
export const stepText = (s: { text: string; count: number }) => (s.count > 1 ? `${s.text} ${s.count} 次` : s.text);
