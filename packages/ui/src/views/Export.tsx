import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { client, type ProjectView } from '../lib/client';
import { useNow } from '../lib/hooks';
import { clock, film, isWorking, relPath, type RunView } from '../lib/run';
import { useT } from '../i18n';

// The live preview is the film; an mp4 is made only when asked for. One control for it wherever it appears.

/** export the finished film to mp4: the button, its progress, or the file once it is done */
export function ExportControls({ run, project, size = '' }: { run: RunView; project: ProjectView; size?: string }) {
  const { t } = useT();
  const now = useNow(!!run.exporting);
  const [asking, setAsking] = useState(false);
  const cut = film(run);
  if (cut) return <a className={`fs-btn fs-btn-secondary ${size}`} href={client.fileUrl(project, relPath(cut.path, project.id))} download><Download size={14} aria-hidden /> {t('common.export.download')}</a>;
  if (run.exporting) return <span className={`fs-btn fs-btn-secondary pointer-events-none ${size}`} role="status"><Loader2 size={14} className="animate-spin" aria-hidden /> {t('common.export.exporting', { time: clock(now - run.exporting) })}</span>;
  return (
    <button className={`fs-btn fs-btn-secondary ${size}`} disabled={asking || isWorking(run)} onClick={async () => { setAsking(true); try { await client.export(project.id); } finally { setAsking(false); } }}
      title={run.stale ? t('common.export.staleTitle') : t('common.export.title')}>
      <Download size={14} aria-hidden /> {run.stale ? t('common.export.exportLatest') : t('common.export.exportMp4')}
    </button>
  );
}
