// The providers Studio offers, in the order it shows them. Most are built into Pi; the rest are OpenAI-compatible
// endpoints Studio registers itself. Every one takes a key (or, for a local server, nothing), an optional own base URL,
// and model ids the user adds by hand on top of the ones the provider lists.
import type { CustomProviderConfig } from './custom.js';

export type ProviderGroup = 'recommended' | 'global' | 'china' | 'local';

export interface ProviderSpec {
  id: string;
  name: string;
  group: ProviderGroup;
  /** one line under the name */
  blurb: string;
  /** where the key comes from */
  keyUrl?: string;
  keyHint?: string;
  /** a local server: no key, only a base URL */
  local?: boolean;
  /** the protocol of the endpoint: decides what a custom base URL looks like (Anthropic: no /v1) */
  protocol: 'openai' | 'anthropic' | 'google';
  /** the endpoint, shown as the default when the user leaves the base URL empty */
  baseUrl: string;
  /** an OpenAI-compatible endpoint Studio registers (not built into Pi); its models are listed from GET /models */
  compat?: boolean;
}

export const PROVIDERS: ProviderSpec[] = [
  { id: 'relay', name: 'Relay', group: 'recommended', blurb: '一个 key 用上 Claude、Gemini、GPT，人民币计价', keyUrl: 'https://relay.example.com', keyHint: 'sk-flash-…', protocol: 'anthropic', baseUrl: 'https://relay.example.com' },
  { id: 'anthropic', name: 'Claude', group: 'global', blurb: 'Anthropic 官方 API', keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { id: 'openai', name: 'OpenAI', group: 'global', blurb: 'GPT 系列，OpenAI 官方 API', keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…', protocol: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'google', name: 'Gemini', group: 'global', blurb: 'Google AI Studio', keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…', protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'xai', name: 'Grok', group: 'global', blurb: 'xAI 官方 API', keyUrl: 'https://console.x.ai', keyHint: 'xai-…', protocol: 'openai', baseUrl: 'https://api.x.ai/v1' },
  { id: 'openrouter', name: 'OpenRouter', group: 'global', blurb: '一个 key 接入几百个模型', keyUrl: 'https://openrouter.ai/keys', keyHint: 'sk-or-…', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'deepseek', name: 'DeepSeek', group: 'china', blurb: '深度求索官方 API', keyUrl: 'https://platform.deepseek.com/api_keys', keyHint: 'sk-…', protocol: 'openai', baseUrl: 'https://api.deepseek.com' },
  { id: 'moonshotai-cn', name: 'Kimi', group: 'china', blurb: '月之暗面开放平台', keyUrl: 'https://platform.moonshot.cn/console/api-keys', keyHint: 'sk-…', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'zhipu', name: '智谱 GLM', group: 'china', blurb: '智谱 AI 开放平台', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', keyHint: 'API Key', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', compat: true },
  { id: 'qwen', name: '通义千问', group: 'china', blurb: '阿里云百炼', keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1', keyHint: 'sk-…', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', compat: true },
  { id: 'minimax-cn', name: 'MiniMax', group: 'china', blurb: 'MiniMax 开放平台', keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key', keyHint: 'API Key', protocol: 'anthropic', baseUrl: 'https://api.minimaxi.com/anthropic' },
  { id: 'siliconflow', name: '硅基流动', group: 'china', blurb: '开源模型一站式 API', keyUrl: 'https://cloud.siliconflow.cn/account/ak', keyHint: 'sk-…', protocol: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', compat: true },
  { id: 'volcengine-ark', name: '豆包', group: 'china', blurb: '火山方舟', keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', keyHint: 'API Key', protocol: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', compat: true },
  { id: 'hunyuan', name: '腾讯混元', group: 'china', blurb: '腾讯云混元大模型', keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key', keyHint: 'sk-…', protocol: 'openai', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', compat: true },
  { id: 'xiaomi', name: '小米 MiMo', group: 'china', blurb: '小米 MiMo 开放平台', keyUrl: 'https://platform.xiaomimimo.com', keyHint: 'sk-…', protocol: 'openai', baseUrl: 'https://api.xiaomimimo.com/v1' },
  { id: 'ollama', name: 'Ollama', group: 'local', blurb: '本机运行的开源模型，不需要 key', local: true, protocol: 'openai', baseUrl: 'http://localhost:11434/v1', compat: true },
];

export const providerSpec = (id: string) => PROVIDERS.find((p) => p.id === id);

/** a compatible provider as a custom endpoint: its base URL (the user's own, if set) and the model ids the user added */
export function compatConfig(p: ProviderSpec, baseUrl: string | undefined, models: string[]): CustomProviderConfig {
  return { id: p.id, name: p.name, protocol: 'openai', baseUrl: (baseUrl || p.baseUrl).replace(/\/+$/, ''), models: models.map((id) => ({ id })), discover: true };
}
