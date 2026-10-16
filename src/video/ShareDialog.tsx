import { useEffect, useRef, useState } from 'react';
import { packProject } from '../lib/bundle';
import { downloadBlob } from '../lib/download';
import { host, inviteLink } from '../lib/p2p';
import type { Peer } from '../lib/p2p';
import { CopyCode } from '../share/PhoneLink';
import { Icon } from '../ui/Icon';
import { QrCode, QrScanner } from '../ui/Qr';
import type { VideoProject } from './types';

type Mode = 'menu' | 'phone' | 'live';

/**
 * Send from a phone, edit together live, or save the whole project as one file.
 * Devices connect directly (WebRTC); the codes are swapped by QR code or copy-paste.
 */
export function ShareDialog({
  project,
  liveActive,
  onImport,
  onLive,
  onClose,
}: {
  project: VideoProject;
  liveActive: boolean;
  onImport: (files: File[]) => void;
  onLive: (peer: Peer) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>('menu');
  const [invite, setInvite] = useState<{ code: string; accept: (a: string) => Promise<Peer>; cancel: () => void } | null>(null);
  const [answer, setAnswer] = useState('');
  const [scan, setScan] = useState(false);
  const [error, setError] = useState('');
  const [phone, setPhone] = useState<Peer | null>(null);
  const [got, setGot] = useState<{ name: string; progress: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const local = /^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const keepRef = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Close an unused invitation when the dialog closes.
  useEffect(() => () => void (!keepRef.current && invite?.cancel()), [invite]);

  const start = async (m: Mode) => {
    setMode(m);
    setError('');
    setAnswer('');
    setInvite(null);
    try {
      setInvite(await host());
    } catch {
      setError('This browser cannot make direct connections.');
    }
  };

  const connect = async (code: string) => {
    if (!invite || !code.trim()) return;
    setBusy(true);
    setError('');
    try {
      const peer = await invite.accept(code);
      keepRef.current = true;
      if (mode === 'phone') {
        setPhone(peer);
        peer.onReceiving((name, progress) =>
          setGot((g) => {
            const i = g.findIndex((x) => x.name === name && x.progress < 1);
            return i >= 0 ? g.map((x, k) => (k === i ? { ...x, progress } : x)) : [...g, { name, progress }];
          }),
        );
        peer.onFile((file, meta) => {
          if (meta.kind !== 'import') return;
          setGot((g) => g.map((x) => (x.name === file.name ? { ...x, progress: 1 } : x)));
          onImport([file]);
        });
      } else {
        onLive(peer);
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect. Make a new code and try again.');
    } finally {
      setBusy(false);
    }
  };

  const link = invite ? inviteLink(invite.code, mode === 'phone' ? 'pair' : 'live') : '';
  return (
    <div className="modal-backdrop" data-modal onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal share-modal" role="dialog" aria-label="Share and connect">
        <div className="look-head">
          <h3>{mode === 'phone' ? 'Send from your phone' : mode === 'live' ? 'Edit together, live' : 'Share & connect'}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>
        {mode === 'menu' && (
          <div className="share-menu">
            <button onClick={() => void start('phone')}>
              <Icon name="image" size={22} />
              <strong>Send from your phone</strong>
              <small>Scan a QR code and send clips straight from your phone. No upload, no account, no cable.</small>
            </button>
            <button onClick={() => void start('live')} disabled={liveActive}>
              <Icon name="layers" size={22} />
              <strong>{liveActive ? 'Live editing is on' : 'Edit together, live'}</strong>
              <small>Another computer or phone opens your project and every change shows on both screens.</small>
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  downloadBlob(await packProject(project), `${(project.name || 'project').replace(/[^\w\- ]+/g, '').trim() || 'project'}.bemotion`);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="download" size={22} />
              <strong>Download project file</strong>
              <small>The whole project with its media in one .bemotion file. Open it on any device from the home screen.</small>
            </button>
          </div>
        )}
        {mode !== 'menu' && (
          <>
            <button className="link" onClick={() => (invite?.cancel(), setMode('menu'), setPhone(null))}>
              ← Back
            </button>
            {!phone && (
              <>
                <ol className="share-steps">
                  <li>
                    {mode === 'phone' ? 'Scan this with your phone camera:' : 'Open this link on the other device (scan it, or send it):'}
                    {invite ? (
                      <>
                        <QrCode text={link} label="Invitation code" size={230} />
                        <CopyCode code={link} label="Invitation link" />
                      </>
                    ) : (
                      <p className="hint">Making a code…</p>
                    )}
                    {local && <p className="hint">This page runs on this computer only. For a phone to open the link, use the online version of B-E Motion.</p>}
                  </li>
                  <li>
                    The other device shows a code. {scan ? 'Hold it up to this camera:' : 'Scan it, or paste it here:'}
                    {scan ? (
                      <QrScanner onResult={(text) => (setScan(false), void connect(text))} onError={() => setScan(false)} />
                    ) : (
                      <div className="row">
                        <button onClick={() => setScan(true)} disabled={!invite}>
                          <Icon name="zoomIn" size={15} /> Scan the phone's code
                        </button>
                      </div>
                    )}
                    <div className="row">
                      <input className="grow" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Paste the code" aria-label="Answer code" />
                      <button className="primary" onClick={() => void connect(answer)} disabled={!invite || !answer.trim() || busy}>
                        Connect
                      </button>
                    </div>
                  </li>
                </ol>
                {error && <p className="ai-message">{error}</p>}
              </>
            )}
            {phone && (
              <div className="share-connected">
                <p>
                  <strong>Phone connected ✓</strong> Pick videos or photos on your phone; they land in your media library.
                </p>
                <ul className="phone-sent">
                  {got.map((g, i) => (
                    <li key={i}>
                      <span>{g.name}</span>
                      <span>{g.progress >= 1 ? 'Added ✓' : `${Math.round(g.progress * 100)}%`}</span>
                    </li>
                  ))}
                </ul>
                <button onClick={() => (phone.close(), onClose())}>Disconnect</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
