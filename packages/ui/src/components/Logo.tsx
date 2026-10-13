import { useT } from '../i18n';

/** The 帧言 · Frametell mark: 「」 corners — Chinese quotation marks and a viewfinder at once — around a recording dot.
 *  Below 24px the small cut is used: heavier corners, a larger dot. */
export function Crest({ size = 24, className = '' }: { size?: number; className?: string }) {
  const small = size <= 24;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={`shrink-0 ${className}`} aria-hidden>
      {small ? (
        <>
          <path d="M6 6H32V15H15V32H6Z" style={{ fill: 'rgb(var(--fs-ink))' }} />
          <path d="M58 58H32V49H49V32H58Z" style={{ fill: 'rgb(var(--fs-ink))' }} />
          <circle cx="32" cy="32" r="9" style={{ fill: 'rgb(var(--fs-accent))' }} />
        </>
      ) : (
        <>
          <path d="M8 8H31V14.5H14.5V31H8Z" style={{ fill: 'rgb(var(--fs-ink))' }} />
          <path d="M56 56H33V49.5H49.5V33H56Z" style={{ fill: 'rgb(var(--fs-ink))' }} />
          <circle cx="32" cy="32" r="7.5" style={{ fill: 'rgb(var(--fs-accent))' }} />
        </>
      )}
    </svg>
  );
}

/** mark + name in the interface language: 帧言 in Chinese, Frametell otherwise (never in capitals) */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  const { locale } = useT();
  return (
    <span className="inline-flex items-center gap-2">
      <Crest size={20} />
      {!compact && (locale === 'zh'
        ? <span className="font-display text-[17px] font-bold leading-none tracking-[0.06em] text-ink">帧言</span>
        : <span className="text-[15px] font-semibold leading-none tracking-[-0.01em] text-ink">Frametell</span>)}
    </span>
  );
}
