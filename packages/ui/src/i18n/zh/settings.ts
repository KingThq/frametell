// 设置
export default {
  title: '设置',
  close: '关闭设置',
  loading: '读取设置…',
  back: '返回',
  nav: { models: '模型服务', voice: '配音', general: '通用', network: '网络代理', machine: '这台电脑' },
  language: {
    title: '语言',
    desc: '界面的语言。',
    auto: '跟随系统',
    zh: '中文',
    en: 'English',
  },
  voice: {
    desc: '不连接也能出片，只是没有声音。Key 只保存在这台电脑上。',
    volcengine: '火山引擎',
    elevenlabs: 'ElevenLabs',
    volcengineBlurb: '豆包语音合成，中文音色',
    elevenlabsBlurb: '多语言音色，可以用你自己的音色库',
  },
  net: {
    title: '网络代理',
    desc: '连不上官方服务时填。模型、配音和 Agent 的请求都会走这个代理，本机地址不走。',
    proxy: 'HTTP 代理地址',
  },
  env: {
    title: '这台电脑',
    ok: '正常',
    fix: '需要处理',
    chrome: '浏览器（用于渲染）',
    ffmpeg: '视频编码',
    git: '版本记录（撤销）',
    node: 'Node.js',
    where: '设置保存在 ~/.frametell/config.json，仅本机用户可读。',
  },
};
