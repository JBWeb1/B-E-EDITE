/**
 * Screen recorder (like Loom): record the screen or a window, with your voice and,
 * if you like, your camera in a corner bubble. The screen goes on the main track and
 * the camera on a layer above it, so each can still be moved and trimmed.
 */
import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../lib/download';
import { Icon } from '../ui/Icon';

const pickType = () => ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';

function recordStream(stream: MediaStream) {
  const mimeType = pickType();
  const rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<Blob>((resolve) => (rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || 'video/webm' }))));
  rec.start(500);
  return { rec, done };
}

export const canRecordScreen = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined';

export function ScreenRecorder({ onDone, onClose }: { onDone: (screen: File, camera: File | null) => void; onClose: () => void }) {
  const [camera, setCamera] = useState(false);
  const [mic, setMic] = useState(true);
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'saving'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const session = useRef<{ streams: MediaStream[]; screen: ReturnType<typeof recordStream>; cam: ReturnType<typeof recordStream> | null; ctx: AudioContext | null } | null>(null);
  const preview = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (state !== 'recording') return;
    const started = Date.now();
    const t = setInterval(() => setSeconds((Date.now() - started) / 1000), 250);
    return () => clearInterval(t);
  }, [state]);

  // Never leave the camera or screen sharing on when the dialog goes away.
  useEffect(() => () => session.current?.streams.forEach((s) => s.getTracks().forEach((t) => t.stop())), []);

  const start = async () => {
    setError('');
    setState('starting');
    const streams: MediaStream[] = [];
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      streams.push(display);
      const user = camera || mic ? await navigator.mediaDevices.getUserMedia({ audio: mic, video: camera ? { width: 640, height: 640 } : false }) : null;
      if (user) streams.push(user);
      // Screen sound and the microphone are mixed into one sound track.
      let ctx: AudioContext | null = null;
      const audioIn = [display, user].filter((s): s is MediaStream => !!s && s.getAudioTracks().length > 0);
      let audioTracks: MediaStreamTrack[] = [];
      if (audioIn.length > 1) {
        ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        for (const s of audioIn) ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest);
        audioTracks = dest.stream.getAudioTracks();
      } else if (audioIn.length === 1) audioTracks = audioIn[0].getAudioTracks();
      const screen = recordStream(new MediaStream([...display.getVideoTracks(), ...audioTracks]));
      const camTrack = user?.getVideoTracks()[0];
      const cam = camTrack ? recordStream(new MediaStream([camTrack])) : null;
      if (preview.current) preview.current.srcObject = camTrack ? new MediaStream([camTrack]) : display;
      // Pressing the browser's own "Stop sharing" ends the recording too.
      display.getVideoTracks()[0]?.addEventListener('ended', () => void stop());
      session.current = { streams, screen, cam, ctx };
      setSeconds(0);
      setState('recording');
    } catch (err) {
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      setState('idle');
      setError(err instanceof DOMException && err.name === 'NotAllowedError' ? 'Recording was not allowed. Pick a screen or window to share.' : `Could not start recording${err instanceof Error ? `: ${err.message}` : ''}.`);
    }
  };

  const stop = async () => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    setState('saving');
    s.screen.rec.state !== 'inactive' && s.screen.rec.stop();
    s.cam && s.cam.rec.state !== 'inactive' && s.cam.rec.stop();
    const [screenBlob, camBlob] = await Promise.all([s.screen.done, s.cam?.done ?? Promise.resolve(null)]);
    s.streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
    void s.ctx?.close();
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).replace(':', '.');
    const ext = screenBlob.type.includes('mp4') ? 'mp4' : 'webm';
    onDone(new File([screenBlob], `Screen recording ${stamp}.${ext}`, { type: screenBlob.type }), camBlob ? new File([camBlob], `Camera ${stamp}.${ext}`, { type: camBlob.type }) : null);
  };

  return (
    <div className="modal-backdrop" data-modal onPointerDown={(e) => e.target === e.currentTarget && state === 'idle' && onClose()}>
      <div className="modal screen-rec-modal" role="dialog" aria-label="Record screen">
        <div className="look-head">
          <h3>
            <Icon name="video" /> Record your screen
          </h3>
          {state === 'idle' && (
            <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close">
              <Icon name="x" />
            </button>
          )}
        </div>
        {state === 'idle' || state === 'starting' ? (
          <>
            <p className="hint">Great for tutorials and demos. You'll pick a screen, window or tab next.</p>
            <label className="check">
              <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} />
              Record my voice (microphone)
            </label>
            <label className="check">
              <input type="checkbox" checked={camera} onChange={(e) => setCamera(e.target.checked)} />
              Show my camera in a corner bubble
            </label>
            <button className="primary block" onClick={() => void start()} disabled={state === 'starting'}>
              <span className="rec-dot" /> {state === 'starting' ? 'Starting…' : 'Start recording'}
            </button>
          </>
        ) : (
          <>
            <video ref={preview} className="screen-rec-preview" muted autoPlay playsInline />
            <p className="screen-rec-time" role="timer">
              <span className="rec-dot live" /> {state === 'saving' ? 'Saving…' : `Recording ${formatTime(seconds)}`}
            </p>
            <button className="primary block danger" onClick={() => void stop()} disabled={state === 'saving'}>
              Stop and add to the video
            </button>
          </>
        )}
        {error && (
          <p className="hint error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
