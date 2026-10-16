import { useEffect, useState } from 'react';
import { join } from '../lib/p2p';
import type { Peer } from '../lib/p2p';
import { QrCode } from '../ui/Qr';
import { Icon } from '../ui/Icon';
import { Logo } from '../ui/Logo';

interface Sent {
  name: string;
  progress: number;
}

/** CopyField: a read-only code with a Copy / Share button. */
export function CopyCode({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const share = typeof navigator.share === 'function';
  return (
    <div className="copy-code">
      <input readOnly value={code} aria-label={label} onFocus={(e) => e.target.select()} />
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            alert('Copy is blocked here. Select the code and copy it by hand.');
          }
        }}
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
      {share && <button onClick={() => void navigator.share({ text: code }).catch(() => {})}>Share</button>}
    </div>
  );
}

/**
 * Opened on a phone from the computer's QR code: connects straight to the computer
 * and sends videos and photos to it, with no upload and no account.
 */
export function PhoneLink({ code, onDone }: { code: string; onDone: () => void }) {
  const [answer, setAnswer] = useState('');
  const [peer, setPeer] = useState<Peer | null>(null);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<Sent[]>([]);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let cancel = () => {};
    join(code).then(
      (j) => {
        cancel = j.cancel;
        setAnswer(j.answer);
        j.peer.then(
          (p) => {
            setPeer(p);
            p.onClose(() => setClosed(true));
          },
          (e) => setError(e.message),
        );
      },
      () => setError('This link is not a valid connection code. Make a new one on your computer.'),
    );
    return () => cancel();
  }, [code]);

  const send = async (files: FileList | null) => {
    if (!peer || !files) return;
    for (const f of Array.from(files)) {
      const i = sent.length;
      setSent((s) => [...s, { name: f.name, progress: 0 }]);
      await peer.sendFile(f, f.name, { kind: 'import' }, (progress) => setSent((s) => s.map((x, k) => (k === i ? { ...x, progress } : x))));
    }
  };

  return (
    <div className="phone-link">
      <header>
        <Logo height={20} />
      </header>
      {error && <p className="ai-message">{error}</p>}
      {!peer && !error && (
        <section>
          <h1>Connect to your computer</h1>
          {!answer ? (
            <p className="hint">Getting ready…</p>
          ) : (
            <>
              <p>Hold this up to your computer's camera (in B-E Motion, press “Scan the phone's code”).</p>
              <QrCode text={answer} label="Answer code" size={300} />
              <p className="hint">No camera on the computer? Copy this code and paste it there:</p>
              <CopyCode code={answer} label="Answer code" />
            </>
          )}
        </section>
      )}
      {peer && (
        <section>
          <h1>{closed ? 'Disconnected' : 'Connected ✓'}</h1>
          <p>{closed ? 'The computer closed the connection.' : 'Pick videos or photos. They go straight to your computer — nothing is uploaded.'}</p>
          {!closed && (
            <div className="phone-actions">
              <label className="button primary block">
                <Icon name="image" /> Choose videos & photos
                <input type="file" accept="video/*,image/*,audio/*" multiple hidden onChange={(e) => void send(e.target.files)} aria-label="Choose files to send" />
              </label>
              <label className="button block">
                <Icon name="film" /> Record a video
                <input type="file" accept="video/*" capture="environment" hidden onChange={(e) => void send(e.target.files)} />
              </label>
            </div>
          )}
          <ul className="phone-sent">
            {sent.map((s, i) => (
              <li key={i}>
                <span>{s.name}</span>
                <span>{s.progress >= 1 ? 'Sent ✓' : `${Math.round(s.progress * 100)}%`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <button className="link" onClick={onDone}>
        Open B-E Motion on this phone instead
      </button>
    </div>
  );
}
