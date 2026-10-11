// 全局：产品名、顶栏、导出、风格名、通用按钮
export default {
  product: '画说',
  home: '画说首页',
  toLight: '切换为浅色',
  toDark: '切换为深色',
  light: '浅色',
  dark: '深色',
  settings: '设置',
  signOut: '退出登录',
  requestFailed: '请求失败（{status}）',
  styles: {
    'warm-story': '暖调叙事插画', study: '安静书房', whiteboard: '白板手绘', chalkboard: '黑板', 'tech-dark': '科技深色',
  },
  /** 内置风格的一句话说明；不在这里的风格用服务端给的说明 */
  styleSummaries: {
    'warm-story': '温暖的扁平插画，一个比喻物贯穿全片，适合投资、生活、心理类知识',
    study: '纸面手绘，墨线与淡彩，适合读书、历史、方法论',
    whiteboard: '白板上马克笔边讲边画，适合概念拆解、商业模式、方法论和流程',
    chalkboard: '墨绿黑板上的粉笔板书，适合数学、物理、历史等一步步推导的课堂式讲解',
    'tech-dark': '石墨深色底上的干净架构图与代码，适合软件、AI、系统原理等工程类讲解',
  },
  export: {
    revealMac: '在访达中显示',
    revealWin: '在资源管理器中显示',
    revealOther: '打开所在文件夹',
    where: '文件位置',
    pathHint: '导出的文件在这里，复制路径后可以在访达里用「前往文件夹」打开（⇧⌘G）。',
    copy: '复制',
    copied: '已复制',
    download: '下载 mp4',
    exporting: '正在导出 · {time}',
    staleTitle: '片子改过了，导出最新的一版',
    title: '把片子导出成 mp4（带字幕和不带字幕两版）',
    exportLatest: '导出最新版',
    exportMp4: '导出 mp4',
  },
};
