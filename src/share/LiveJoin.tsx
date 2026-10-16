import { useEffect, useState } from 'react';
import { attachMedia, unpackProject } from '../lib/bundle';
import { join } from '../lib/p2p';
import type { Peer } from '../lib/p2p';
import { newProjectId, putMedia } from '../lib/projects';
import { QrCode } from '../ui/Qr';
import { Logo } from '../ui/Logo';
import type { VideoProject } from '../video/types';
import { CopyCode } from './PhoneLink';

/**
 * Opened from a "live editing" link: answers the invitation, receives the project
 * with its media, then opens it in the editor connected to the other device.
 */
export function LiveJoin({ code, onOpen, onCancel }: { code: string; onOpen: (project: VideoProject, projectId: string, peer: Peer) => void; onCancel: () => void }) {
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState('Getting ready…');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancel = () => {};
    join(code).then(
      (j) => {
        cancel = j.cancel;
        setAnswer(j.answer);
        setStatus('Send this code back to the person who invited you.');
        j.peer.then(
          (peer) => {
            setStatus('Connected ✓ Receiving the project…');
            peer.onReceiving((_name, f) => setStatus(`Connected ✓ Receiving the project… ${Math.round(f * 100)}%`));
            const stop = peer.onFile(async (file, meta) => {
              if (meta.kind !== 'bundle') return;
              stop();
              try {
                const { project, files } = await unpackProject(file);
                for (const [id, blob] of files) await putMedia(id, blob).catch(() => {});
                cancel = () => {};
                onOpen(attachMedia(project, files), newProjectId(), peer);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not open the project');
              }
            });
          },
          (e) => setError(e.message),
        );
      },
      () => setError('This link is not a valid invitation. Ask for a new one.'),
    );
    return () => cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <div className="phone-link">
      <header>
        <Logo height={20} />
      </header>
      <section>
        <h1>Join live editing</h1>
        {error ? <p className="ai-message">{error}</p> : <p>{status}</p>}
        {answer && !error && (
          <>
            <QrCode text={answer} label="Answer code" size={260} />
            <CopyCode code={answer} label="Answer code" />
          </>
        )}
      </section>
      <button className="link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
