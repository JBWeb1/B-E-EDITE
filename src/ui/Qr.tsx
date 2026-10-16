import { useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';

/** A QR code (SVG) for `text`. */
export function QrCode({ text, label, size = 240 }: { text: string; label: string; size?: number }) {
  const svg = useMemo(() => {
    const q = qrcode(0, 'L');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  }, [text]);
  return <div className="qr" style={{ width: size, maxWidth: '100%' }} role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

/**
 * Reads a QR code with the camera. Uses the browser's built-in barcode reader when it
 * has one, otherwise a small JavaScript decoder.
 */
export function QrScanner({ onResult, onError }: { onResult: (text: string) => void; onError?: (message: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('Starting the camera…');
  const done = useRef(false);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch {
        setStatus('No camera available. Paste the code instead.');
        onError?.('no camera');
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => {});
      setStatus('Point the camera at the code');
      const Native = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      const native = Native ? new Native({ formats: ['qr_code'] }) : null;
      const jsQR = native ? null : (await import('jsqr')).default;
      const tick = async () => {
        if (stopped || done.current) return;
        if (v.videoWidth) {
          let text: string | undefined;
          if (native) text = (await native.detect(v).catch(() => []))[0]?.rawValue;
          else {
            canvas.width = Math.min(640, v.videoWidth);
            canvas.height = Math.round((canvas.width * v.videoHeight) / v.videoWidth);
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            text = jsQR!(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' })?.data;
          }
          if (text) {
            done.current = true;
            setStatus('Got it ✓');
            onResultRef.current(text);
            return;
          }
        }
        raf = requestAnimationFrame(() => void tick());
      };
      void tick();
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="qr-scanner">
      <video ref={video} muted playsInline aria-label="Camera" />
      <span>{status}</span>
    </div>
  );
}
