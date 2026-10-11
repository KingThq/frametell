// Storyboard check before any page is written (no model, no browser). Rules adapted for 1–10 minute explainers from
// huashu-art-motion's storyboard_lint.py (MIT, github.com/alchaincyf/huashu-art-motion).
//
// node engine/tools/storyboard-lint.mjs [storyboard.json] [--source materials/] [--json]
//   --source: files or dirs whose text grounds the numbers shown on screen (defaults to materials/ and script.js)
// Exit code: 1 with any red issue, 0 otherwise, 2 when the storyboard can't be read.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const args = process.argv.slice(2);
const flag = (k) => args.includes('--' + k);
const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--source') || 'storyboard.json';
const STYLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles');

// ── vocabulary ────────────────────────────────────────────────────────────────
// layout words: an object made only of these is a slide element, not a thing in the world
const LAYOUT = `标题 副标题 小标题 大标题 主标题 要点 文字 文本 大字 字 列表 清单 标签 字幕 卡片 字卡 背景 底色 白底 黑底 纯色 画面 图标 icon
  空镜 空景 空画面 黑场 黑屏 白屏 留白 渐变底 渐变 关键词 金句 口号 标语 总结 结论 概念 内容 信息 元素 东西 示意图 示意 图片 图 页面 版面 动画 效果
  文案 段落 句子 bullet 圆点 符号 编号 序号 箭头 线条 形状 方块 色块 光斑 粒子 装饰 框 文本框 表格 图表 柱状图 饼图 折线图`.split(/\s+/).filter(Boolean)
  .sort((a, b) => b.length - a.length);
const FILLER = /[\d一二三四五六七八九十两几个条张行句段组页块排些堆串的和与及跟或上下左右中里边侧旁内外前后大小新白黑红蓝绿黄灰橙紫色底空、，,。.;；:：/／+＋&＆\s（）()[\]【】「」『』“”"'‘’\-—–~～·…|]/g;
const TEXTY = /标题|文字|文本|要点|列表|清单|字幕|大字|关键词|金句|口号|标语|字卡|bullet|表格|^字|字$/;
// catch-all verbs: an action made only of these says nothing about motion
const WEAK = `出现 显示 展示 呈现 浮现 淡入 淡出 渐显 弹出 出来 列出 亮起 停留 停住 静止 不动 保持 摆着 放着 存在 显现 罗列 排列 介绍 说明 讲解
  解释 强调 标注 写出 打出 入场 出场 高亮 变色 切换 过渡 展开 收起`.split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
const ACT_FILLER = /[\d一二三四五六七八九十两几个条张行句段组页块排些堆串的地着了过和与及跟或也都再又并、，,。.;；:：/／+＋\s（）()「」“”"'\-—–~～…|]|逐条|依次|一一|逐个|逐一|逐渐|渐渐|慢慢|缓缓|然后|开始|同时|接着|陆续|一起|一下|画面|屏幕|上/g;
const FACES = /小人|火柴人|机器人|吉祥物|卡通人|卡通形象|人脸|笑脸|表情|Q版|q版/;

// the same three lists for a storyboard written in English (words matched whole, any case, with a plural s)
const LAYOUT_EN = `title subtitle heading headline text words word label caption card background backdrop icon bullet list slide banner
  keyword keywords quote slogan tagline summary conclusion concept content info information element thing diagram image picture page
  layout animation effect paragraph sentence symbol arrow line shape box block frame textbox table chart graph pie bar gradient
  screen blank particle particles decoration`.split(/\s+/).filter(Boolean);
const FILLER_EN = /\b(a|an|the|of|with|and|or|on|in|at|to|for|big|small|large|tiny|new|main|white|black|red|blue|green|yellow|grey|gray|orange|purple|colored|coloured|empty|plain|simple|centered|centred|some|few|several|one|two|three|four|five|six|seven|eight|nine|ten|top|bottom|left|right|middle)\b|[\d\s,.;:/+&()[\]"'’\-—–~·…|!?]/gi;
const WEAK_EN = `appear appears appearing show shows showing display displays present presents fade fades fading pop pops list lists
  highlight highlights stay stays remain remains sit sits exist exists introduce introduces explain explains emphasize emphasizes
  reveal reveals enter enters exit exits switch switches transition transitions expand expands collapse collapses change changes
  become becomes animate animates move moves`.split(/\s+/).filter(Boolean);
const ACT_FILLER_EN = /\b(in|out|up|down|on|onto|into|off|away|over|by|one|after|another|each|then|slowly|gradually|quickly|softly|start|starts|begin|begins|again|together|screen|color|colour|it|its|they|them|all|the|a|an|and|to|of|with|is|are)\b|[\d\s,.;:/+&()"'’\-—–~…|!?]/gi;
const TEXTY_EN = /\b(title|text|words?|bullets?|list|captions?|keywords?|quote|slogan|headline|table)\b/i;
const FACES_EN = /\b(stick ?figure|cartoon (?:man|woman|person|character)|mascot|smiley|face|emoji|robot)\b/i;
const residueEn = (s, words, filler) => { let r = String(s || '').toLowerCase(); for (const w of words) r = r.replace(new RegExp(`\\b${w}s?\\b`, 'g'), ''); return r.replace(filler, ''); };
/** a storyboard is English when it says so (lang: "en"), or when no page or beat has a CJK character in it */
const isEnglish = (sb) => (sb.lang ? sb.lang === 'en' : !/[㐀-鿿]/.test(JSON.stringify(sb.pages)));

const residue = (s, words, filler) => { let r = String(s || ''); for (const w of words) r = r.split(w).join(''); return r.replace(filler, ''); };
/** on-screen length: a CJK character counts 1, a run of latin letters or digits counts 1 */
const wordsIn = (t) => (String(t || '').match(/[A-Za-z]+(?:['’-][A-Za-z]+)*|\d+(?:[.,]\d+)*%?/g) || []).length;
const textUnits = (t) => (String(t || '').match(/[㐀-鿿]|[A-Za-z]+|\d+(?:[.,]\d+)*%?/g) || []).length;
const textParts = (t) => String(t || '').split(/\s*[\/／|｜]\s*/).filter((x) => x.trim());

// ── numbers: "60%", "30 年", "¥1000" on screen must be grounded in the source text (Chinese numerals count too) ──
const CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT = { 十: 10, 百: 100, 千: 1000 };
function cnInt(s) {
  let total = 0, section = 0, num = null;
  for (const ch of s) {
    if (ch in CN) num = CN[ch];
    else if (ch in CN_UNIT) { section += (num ?? 1) * CN_UNIT[ch]; num = null; }
    else if (ch === '万' || ch === '亿') { total += (section + (num ?? 0)) * (ch === '万' ? 1e4 : 1e8); section = 0; num = null; }
  }
  return total + section + (num ?? 0);
}
function sourceNumbers(text) {
  const out = new Set();
  for (const m of text.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)) out.add(+m[0].replace(/,/g, ''));
  for (const m of text.matchAll(/[零〇一二两三四五六七八九十百千万亿]+(?:点[零〇一二三四五六七八九]+)?/g)) {
    const [i, d] = m[0].split('点');
    const year = /^[零〇一二三四五六七八九]{4}$/.test(i) ? +[...i].map((c) => CN[c]).join('') : null;   // 二零二五 → 2025
    out.add(year ?? cnInt(i) + (d ? +('0.' + [...d].map((c) => CN[c]).join('')) : 0));
  }
  for (const v of [...out]) { out.add(v * 1e4); out.add(v * 1e8); out.add(v / 100); }   // 3万 = 30000, 百分之六十 ≈ 0.6
  return out;
}
const screenNumbers = (t) => [...String(t || '').matchAll(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(%|万|亿|k|K|w|W)?/g)]
  .map((m) => ({ raw: m[0].trim(), v: +m[1].replace(/,/g, ''), unit: m[2] }))
  .filter((n) => !(n.v < 10 && !n.unit && !/\./.test(n.raw)));   // single digits (steps, 3 个) are not facts to check
function grounded(n, have) {
  const cands = [n.v];
  if (n.unit === '万' || n.unit === 'w' || n.unit === 'W') cands.push(n.v * 1e4);
  if (n.unit === '亿') cands.push(n.v * 1e8);
  if (n.unit === 'k' || n.unit === 'K') cands.push(n.v * 1e3);
  if (n.unit === '%') cands.push(n.v / 100);
  return cands.some((c) => [...have].some((h) => Math.abs(h - c) <= Math.max(1e-9, Math.abs(c) * 1e-6)));
}
function readSource(paths) {
  let text = '';
  const walk = (p) => {
    if (!fs.existsSync(p)) return;
    if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f));
    else if (/\.(md|txt|js|json|csv)$/i.test(p)) text += '\n' + fs.readFileSync(p, 'utf8');
  };
  paths.forEach(walk);
  return text;
}

// ── checks ────────────────────────────────────────────────────────────────────
export function lintStoryboard(sb, { source = '' } = {}) {
  const issues = [];
  const add = (level, where, msg) => issues.push({ level, ...where, msg });
  if (!sb || !Array.isArray(sb.pages) || !sb.pages.length) { add('red', {}, '分镜里没有 pages'); return issues; }

  // style lock
  if (!sb.style) add('red', {}, '缺少 style（全片只用一种风格）');
  else if (!fs.existsSync(path.join(STYLES_DIR, sb.style))) add('red', {}, `风格 "${sb.style}" 不存在`);
  const cast = String(sb.cast || '');
  if (!cast) add('red', {}, '缺少 cast（none / hands / silhouette）：没有插画素材时人物不出脸');

  const en = isEnglish(sb), MAX_TEXT = en ? 5 : 8, unit = en ? '个单词' : '个字';
  const units = en ? wordsIn : textUnits;
  const layoutOnly = (o) => (en ? !/[a-z]/.test(residueEn(o, LAYOUT_EN, FILLER_EN)) : !residue(o, LAYOUT, FILLER));
  const weakOnly = (a) => (en ? !/[a-z]/.test(residueEn(a, WEAK_EN, ACT_FILLER_EN)) : !residue(a, WEAK, ACT_FILLER));
  const texty = (o) => (en ? TEXTY_EN : TEXTY).test(o);
  const faces = (o) => (en ? FACES_EN : FACES).test(o);
  const have = source ? sourceNumbers(source + '\n' + sb.pages.map((p) => p.say || '').join('\n')) : null;
  const all = [];
  sb.pages.forEach((p, pi) => {
    const beats = Array.isArray(p.beats) ? p.beats : [];
    if (beats.length < 2) add('red', { page: p.id }, `只有 ${beats.length} 个拍点：一页至少要有 2 个看得见的变化`);
    beats.forEach((b, bi) => {
      const where = { page: p.id, beat: bi };
      const obj = String(b.object || '').trim(), act = String(b.action || '').trim();
      if (!obj) add('red', where, '「物」是空的');
      else if (layoutOnly(obj)) add('red', where, `「物」只是版面词："${obj}"。写画面里具体的东西（雪球、储蓄罐、一条山路）`);
      if (!act) add('red', where, '「动作」是空的');
      else if (weakOnly(act)) add('red', where, `「动作」只是万能词："${act}"。写它怎么动（滚下、长高、落进、裂开）`);
      for (const part of textParts(b.text)) {
        const n = units(part);
        if (n > MAX_TEXT) add('red', where, `屏上字 "${part}" 有 ${n} ${unit}（每个元素 ≤ ${MAX_TEXT}）`);
      }
      if (faces(obj) && !/^frames?:/.test(cast)) add('red', where, `「物」里有画脸的角色（"${obj}"）：只画手、背影、剪影，或让物当主角`);
      if (have) for (const n of screenNumbers(b.text)) if (!grounded(n, have)) add('red', where, `屏上数字 "${n.raw}" 在素材里找不到出处`);
      all.push({ page: p.id, pi, bi, texty: texty(obj) || units(b.text) >= (en ? 5 : 7), cam: String(b.camera || '').trim() });
    });
  });

  // text-dominated beats: first and last page must be led by an object, and at most 30% overall
  const pageTexty = (pi) => { const bs = all.filter((b) => b.pi === pi); return bs.length && bs.filter((b) => b.texty).length * 2 > bs.length; };
  if (pageTexty(0)) add('red', { page: sb.pages[0].id }, '第一页是文字主导：开场要先给一个物和一个问题');
  const last = sb.pages.length - 1;
  if (pageTexty(last)) add('red', { page: sb.pages[last].id }, '最后一页是文字主导：结尾落在主物的一个动作上，不收在金句卡上');
  const lastBeat = all.filter((b) => b.pi === last).pop();
  if (lastBeat?.texty && !pageTexty(last)) add('red', { page: sb.pages[last].id, beat: lastBeat.bi }, '最后一个拍点是文字：让主物完成一个动作收尾');
  const share = all.length ? all.filter((b) => b.texty).length / all.length : 0;
  if (share > 0.3) add('red', {}, `文字主导的拍点占 ${Math.round(share * 100)}%（≤ 30%）`);

  for (let i = 2; i < all.length; i++) {
    const [a, b, c] = [all[i - 2], all[i - 1], all[i]];
    if (a.cam && a.cam === b.cam && b.cam === c.cam) add('yellow', { page: c.page, beat: c.bi }, `连续三个拍点都是「${c.cam}」镜头`);
  }
  return issues;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
// run as a CLI (also through the project's engine/ link)
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  let sb;
  try { sb = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`读不了 ${file}: ${e.message}`); process.exit(2); }
  const src = opt('source') ? [opt('source')] : ['materials', 'script.js'];
  const issues = lintStoryboard(sb, { source: readSource(src.map((p) => path.resolve(p))) });
  const reds = issues.filter((i) => i.level === 'red').length;
  if (flag('json')) console.log(JSON.stringify(issues));
  else if (!issues.length) console.log('storyboard: OK');
  else {
    console.log(`storyboard: ${reds} red, ${issues.length - reds} yellow`);
    for (const i of issues) console.log(`  ${i.level === 'red' ? '✗' : '!'} ${i.page ?? '全片'}${i.beat != null ? ` 拍点${i.beat + 1}` : ''}: ${i.msg}`);
  }
  process.exit(reds ? 1 : 0);
}
