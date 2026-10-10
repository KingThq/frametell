import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintStoryboard } from '../tools/storyboard-lint.mjs';

const beat = (object, action, text = '', camera = '') => ({ at: 'c0', object, action, text, camera });
const good = () => ({
  style: 'warm-story', cast: 'hands',
  pages: [
    { id: 'p01', say: '每月存一千元，三十年后有多少？', beats: [beat('一个储蓄罐', '硬币一枚枚落进去', '每月 1000', '跟拍'), beat('储蓄罐', '慢慢鼓起来', '', '推近')] },
    { id: 'p02', say: '复利让雪球越滚越大。', beats: [beat('一颗雪球', '从坡顶滚下，越滚越大', '30 年', '横移'), beat('雪球', '撞上山脚的树停住', '×17', '砸入')] },
    { id: 'p03', say: '时间比本金重要。', beats: [beat('一棵树苗', '长高并结出果子', '', '推近'), beat('一只手', '摘下果子放进罐里', '', '跟拍')] },
  ],
});
const source = '每月存 1000 元，坚持三十年，本金翻了十七倍。';
const msgs = (sb, opts = { source }) => lintStoryboard(sb, opts).map((i) => `${i.level} ${i.page ?? ''} ${i.msg}`);
const reds = (sb, opts) => msgs(sb, opts).filter((m) => m.startsWith('red'));

test('a well-formed storyboard passes', () => {
  assert.deepEqual(reds(good()), []);
});

test('each red rule fires on a deliberately bad storyboard', () => {
  const cases = [
    ['物只是版面词', (sb) => { sb.pages[1].beats[0].object = '三个卡片'; }, /版面词/],
    ['空的物', (sb) => { sb.pages[1].beats[0].object = ''; }, /「物」是空的/],
    ['万能动作', (sb) => { sb.pages[1].beats[0].action = '依次出现'; }, /万能词/],
    ['屏上字超长', (sb) => { sb.pages[1].beats[0].text = '复利是世界第八大奇迹啊'; }, /个字/],
    ['首页文字主导', (sb) => { sb.pages[0].beats = [beat('大标题', '写出来', '为什么要存钱'), beat('要点列表', '滑入')]; }, /第一页是文字主导/],
    ['尾页金句卡', (sb) => { sb.pages[2].beats[1] = beat('金句', '浮现', '时间是朋友'); }, /最后一个拍点是文字|最后一页是文字主导/],
    ['数字无出处', (sb) => { sb.pages[1].beats[1].text = '×25'; sb.pages[1].beats[0].text = '40 年'; }, /找不到出处/],
    ['只有一个拍点', (sb) => { sb.pages[1].beats.pop(); }, /至少要有 2 个/],
    ['画脸的角色', (sb) => { sb.pages[1].beats[0].object = '一个Q版小人'; }, /画脸的角色/],
    ['缺风格', (sb) => { delete sb.style; }, /缺少 style/],
    ['风格不存在', (sb) => { sb.style = 'neon-cyber'; }, /不存在/],
    ['缺 cast', (sb) => { delete sb.cast; }, /缺少 cast/],
  ];
  for (const [name, mutate, re] of cases) {
    const sb = good(); mutate(sb);
    assert.ok(reds(sb).some((m) => re.test(m)), `${name}: expected ${re}, got ${JSON.stringify(msgs(sb))}`);
  }
});

test('text-dominated share above 30% is red', () => {
  const sb = good();
  sb.pages[1].beats = [beat('关键词', '写出', '复利'), beat('标题', '弹出', '时间')];
  sb.pages[2].beats.unshift(beat('文字', '淡入', '本金'));
  assert.ok(reds(sb).some((m) => /文字主导的拍点占/.test(m)));
});

test('Chinese numerals in the source ground arabic numbers on screen', () => {
  const sb = good();
  sb.pages[1].beats[0].text = '60%';
  assert.ok(reds(sb, { source: source + '大约百分之六十的人' }).every((m) => !/出处/.test(m)));
  sb.pages[1].beats[0].text = '2025 年';
  assert.ok(reds(sb, { source: source + '二零二五年' }).every((m) => !/出处/.test(m)));
  sb.pages[1].beats[0].text = '3万';
  assert.ok(reds(sb, { source: source + '三万元' }).every((m) => !/出处/.test(m)));
});

test('three identical cameras in a row is a yellow', () => {
  const sb = good();
  for (const p of sb.pages) for (const b of p.beats) b.camera = '推近';
  assert.ok(msgs(sb).some((m) => m.startsWith('yellow') && /连续三个拍点/.test(m)));
});
