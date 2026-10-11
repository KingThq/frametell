/* 口播脚本（唯一真相源）：每页一组字幕句（cue），画面动画按 cue 序号卡点。
 * cue 可以是字符串，或 { t, hold }——hold 表示这句说完后再多留几秒给动画。
 * 每个 page.id 对应 pages/<id>.js；还没写画面的页会显示为一个大标题。 */
(function (root) {
  const META = {
    title: '__TITLE__',     // 口播脚本标题
    name: '__TITLE__',      // 成片文件名前缀
    libs: [],               // 三方库（engine_modules 下的路径，.css 或 UMD .js），如 'katex/dist/katex.min.js'
    gap: 0.5,               // 翻页间隔（秒），引擎默认 1.5
    extras: [],             // 本项目专用的组件文件（相对本目录），在页面之前加载
    publish: {              // 发布信息（npm run publish → out/发布信息.md）；章节 = 下面 PAGES 的 section，时间码自动算
      titles: {
        bilibili: '',       // ≤ 80 字
        youtube: '',        // ≤ 100 字
        douyin: '',         // ≤ 30 字
        shipinhao: '',      // 视频号短标题 ≤ 16 字
        xiaohongshu: '',    // ≤ 20 字
      },
      description: ``,      // 3–6 句：这期讲什么、看完能收获什么；章节列表会自动接在后面
      tags: [],
    },
  };
  const PAGES = [
    // ───────────────────────── 开场
    { id: 'p01', section: '开场', title: '__TITLE__', cues: [
      '大家好，这一篇我们来聊：',
      '__TITLE__。',
      { t: '先从一个问题说起。', hold: 0.6 },
    ] },
  ];
  root.SCRIPT = { META, PAGES };
})(typeof window !== 'undefined' ? window : globalThis);
