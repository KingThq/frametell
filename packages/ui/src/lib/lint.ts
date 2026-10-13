import { getLocale } from '../i18n';

// A page check's finding as the person reads it. The engine words its findings in English for the page agents, who fix
// them; in a Chinese panel they are said in Chinese. A finding no rule knows is shown as the engine wrote it.
// A page agent that gives up on a finding writes why (FLAGGED: …): that is a note to us, in the model's words and often
// in English, and is not shown at all (seen: a paragraph about the "sparse" measure under a finished film's page).

const q = (s: string) => `「${s}」`;

const ZH: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^text-dominated page: text covers (\d+)% of the content area/, (m) => `文字偏多：文字占了画面的 ${m[1]}%，可以让画里的东西来讲，文字只留标签和数字`],
  [/^sparse page: the drawing spans (\d+)% of the content area/, (m) => `画面偏空：画只占了画面的 ${m[1]}%`],
  [/^empty opening:/, () => '开头是空的：翻到这一页时，画面上还什么都没有'],
  [/^empty ending:/, () => '结尾是空的：这一页还没翻走，画面就先清空了'],
  [/^not deterministic: ([\d.]+)% of this frame differs/, (m) => `画面不稳定：从不同的位置开始播放，这一帧有 ${m[1]}% 不一样`],
  [/^raw markup on screen: "([^"]*)"/, (m) => `画面上露出了排版代码${q(m[1])}`],
  [/^off-canvas\/edge: "([^"]*)"/, (m) => `文字${q(m[1])}超出了画面边缘`],
  [/^subtitle band \(y>905\): "([^"]*)"/, (m) => `文字${q(m[1])}压到了字幕的位置`],
  [/^small text \((\d+)px < (\d+)px\): "([^"]*)"/, (m) => `字太小：${q(m[3])}只有 ${m[1]} 像素，至少要 ${m[2]}`],
  [/^text overlap: "([^"]*)" × "([^"]*)"/, (m) => `文字重叠：${q(m[1])}和${q(m[2])}叠在了一起`],
  [/^(runtime error|unknown API|wrong API use)\b/, () => '这一页的代码出错了'],
  [/^(这次没有改上|The change was not made)/, () => '这次没有改上：页面和改之前一样'],
];

/** one finding, as the page reports it ("18.4s：text-dominated page: …"), in the panel's language */
export function issueText(issue: string): string {
  if (getLocale() !== 'zh') return issue;
  const m = /^([\d.]+)s[：:]\s*(.*)$/s.exec(issue);
  const [at, msg] = m ? [m[1], m[2]] : [undefined, issue];
  for (const [re, say] of ZH) {
    const hit = msg.match(re);
    if (hit) return (at ? `${at} 秒 · ` : '') + say(hit);
  }
  return issue;
}

/** the findings worth showing: those the rules know, in the panel's language; an agent's own note is left out */
export function shownIssues(issues: string[]): string[] {
  return issues.filter((issue) => {
    const msg = issue.replace(/^[\d.]+s[：:]\s*/, '');
    return ZH.some(([re]) => re.test(msg));
  }).map(issueText);
}
