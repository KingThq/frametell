import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { client, type ProjectView } from '../lib/client';
import { useNow } from '../lib/hooks';
import { clock, film, isWorking, relPath, type RunView } from '../lib/run';

// The live preview is the film; an mp4 is made only when asked for. One control for it wherever it appears.

/** export the finished film to mp4: the button, its progress, or the file once it is done */
export function ExportControls({ run, project, size = '' }: { run: RunView; project: ProjectView; size?: string }) {
  const now = useNow(!!run.exporting);
  const [asking, setAsking] = useState(false);
  const cut = film(run);
  if (cut) return <a className={`fs-btn fs-btn-secondary ${size}`} href={client.fileUrl(project, relPath(cut.path, project.id))} download><Download size={14} aria-hidden /> 下载 mp4</a>;
  if (run.exporting) return <span className={`fs-btn fs-btn-secondary pointer-events-none ${size}`} role="status"><Loader2 size={14} className="animate-spin" aria-hidden /> 正在导出 · {clock(now - run.exporting)}</span>;
  return (
    <button className={`fs-btn fs-btn-secondary ${size}`} disabled={asking || isWorking(run)} onClick={async () => { setAsking(true); try { await client.export(project.id); } finally { setAsking(false); } }}
      title={run.stale ? '片子改过了，导出最新的一版' : '把片子导出成 mp4（带字幕和不带字幕两版）'}>
      <Download size={14} aria-hidden /> {run.stale ? '导出最新版' : '导出 mp4'}
    </button>
  );
}
