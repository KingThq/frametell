import { useId } from 'react';

/** The Relay crest (家纹): a disc split by a lightning cut — ink half for your tools, caramel half for the models. */
const LEFT = 'M0 0H20.9L13.4 15.2L18.8 16.9L10.9 32H0Z';
const RIGHT = 'M20.9 0H32V32H10.9L18.8 16.9L13.4 15.2Z';
const CUT = 'M20.6 1.5L13.4 15.2L18.8 16.9L11.2 30.5';

export function Crest({ size = 26, className = '' }: { size?: number; className?: string }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="2.5 2.5 27 27" fill="none" className={`shrink-0 ${className}`} aria-hidden>
      <defs>
        <mask id={`cut-${uid}`} maskUnits="userSpaceOnUse" x="-5" y="-5" width="42" height="42">
          <circle cx="16" cy="16" r="13.5" fill="#fff" />
          <path d={CUT} stroke="#000" strokeWidth="1.55" strokeLinejoin="miter" />
        </mask>
      </defs>
      <g mask={`url(#cut-${uid})`}>
        <path d={LEFT} style={{ fill: 'rgb(var(--fs-ink))' }} />
        <path d={RIGHT} fill="#D4A574" />
      </g>
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Crest size={24} />
      <span className="flex items-baseline gap-1.5 leading-none">
        {!compact && <span className="text-[14px] font-semibold tracking-[-0.01em] text-ink">Relay</span>}
        <span className="font-display text-[17px] italic tracking-[-0.02em] text-accent-ink">Studio</span>
      </span>
    </span>
  );
}
