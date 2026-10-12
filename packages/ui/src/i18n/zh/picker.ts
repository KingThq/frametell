// 模型与音色选择器
export default {
  none: '选一个模型',
  search: '搜索',
  searchHint: '搜索模型，或直接输入模型 ID',
  voiceSearch: '搜索音色',
  voiceHint: '点左边的按钮试听，不会选中',
  recommended: '推荐',
  noVision: '不能看图',
  useTyped: '使用输入的模型 ID',
  useOn: (v: { id: string; provider: string }) => `在 ${v.provider} 上使用「${v.id}」`,
  noMatch: '没有匹配的',
  noProvider: '还没有连接服务商',
  providers: '服务商',
  manage: '管理服务商与模型',
};
