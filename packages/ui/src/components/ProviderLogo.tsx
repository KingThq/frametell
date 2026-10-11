import { useId } from 'react';
import claude from '../assets/providers/claude.svg';
import gemini from '../assets/providers/gemini.svg';
import deepseek from '../assets/providers/deepseek.svg';
import kimi from '../assets/providers/kimi.svg';
import zhipu from '../assets/providers/zhipu.svg';
import qwen from '../assets/providers/qwen.svg';
import minimax from '../assets/providers/minimax.svg';
import siliconflow from '../assets/providers/siliconflow.svg';
import doubao from '../assets/providers/doubao.svg';
import hunyuan from '../assets/providers/hunyuan.svg';
import volcengine from '../assets/providers/volcengine.svg';
import openai from '../assets/providers/openai.svg?raw';
import grok from '../assets/providers/grok.svg?raw';
import openrouter from '../assets/providers/openrouter.svg?raw';
import xiaomi from '../assets/providers/xiaomi.svg?raw';
import ollama from '../assets/providers/ollama.svg?raw';
import elevenlabs from '../assets/providers/elevenlabs.svg?raw';

// Each provider by its own mark (assets/providers, see NOTICE.md). Marks in colour are images; one-colour marks are
// drawn inline in the text colour, so they read on either theme. A provider without a mark gets its initial.

const COLOR: Record<string, string> = {
  anthropic: claude, google: gemini, deepseek, 'moonshotai-cn': kimi, zhipu, qwen, 'minimax-cn': minimax, siliconflow,
  'volcengine-ark': doubao, hunyuan, volcengine,
};
const MONO: Record<string, string> = { openai, xai: grok, openrouter, xiaomi, ollama, elevenlabs };

/** the Relay crest: a disc cut by a lightning stroke, ink half and caramel half */
function RelayMark({ size }: { size: number }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="2.5 2.5 27 27" fill="none" aria-hidden>
      <defs>
        <mask id={`fw-${uid}`} maskUnits="userSpaceOnUse" x="-5" y="-5" width="42" height="42">
          <circle cx="16" cy="16" r="13.5" fill="#fff" />
          <path d="M20.6 1.5L13.4 15.2L18.8 16.9L11.2 30.5" stroke="#000" strokeWidth="1.55" strokeLinejoin="miter" />
        </mask>
      </defs>
      <g mask={`url(#fw-${uid})`}>
        <path d="M0 0H20.9L13.4 15.2L18.8 16.9L10.9 32H0Z" style={{ fill: 'rgb(var(--fs-ink))' }} />
        <path d="M20.9 0H32V32H10.9L18.8 16.9L13.4 15.2Z" fill="#D4A574" />
      </g>
    </svg>
  );
}

export function ProviderLogo({ id, name, size = 20, className = '' }: { id: string; name?: string; size?: number; className?: string }) {
  const box = `inline-flex shrink-0 items-center justify-center ${className}`;
  if (id === 'relay') return <span className={box} style={{ width: size, height: size }}><RelayMark size={size} /></span>;
  if (COLOR[id]) return <img src={COLOR[id]} alt="" width={size} height={size} className={box} draggable={false} />;
  if (MONO[id]) return <span className={`${box} text-ink [&>svg]:h-full [&>svg]:w-full`} style={{ width: size, height: size }} aria-hidden dangerouslySetInnerHTML={{ __html: MONO[id] }} />;
  return (
    <span className={`${box} rounded-[6px] bg-ink/[0.08] font-medium text-ink-2`} style={{ width: size, height: size, fontSize: Math.round(size * 0.52) }} aria-hidden>
      {(name || id).slice(0, 1).toUpperCase()}
    </span>
  );
}
