/**
 * After an export: the finished video, ready to post. On phones "Share" opens the
 * system share sheet (TikTok, Instagram, YouTube, WhatsApp… appear there); on a
 * computer, open the site's upload page and drop the file in. The caption with
 * hashtags is ready to copy.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { downloadBlob } from '../lib/download';
import { Icon } from '../ui/Icon';
import { postCaption } from './postkit';
import type { VideoProject } from './types';

export const POST_SITES: { id: string; label: string; url: string; note: string }[] = [
  { id: 'tiktok', label: 'TikTok', url: 'https://www.tiktok.com/tiktokstudio/upload', note: 'Upload page in TikTok Studio' },
  { id: 'youtube', label: 'YouTube', url: 'https://studio.youtube.com/', note: 'YouTube Studio → Create → Upload' },
  { id: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/', note: 'Press + Create' },
  { id: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/', note: 'Photo/video in a new post' },
  { id: 'x', label: 'X', url: 'https://x.com/compose/post', note: 'Attach the video to a post' },
  { id: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/feed/?shareActive=true', note: 'Start a post → Video' },
];

/** True when this browser can hand the file to other apps (phones, some desktops). */
export const canShareFile = (file: File) => {
  try {
    return typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
};

export function PostDialog({ file, project, onClose }: { file: File; project: VideoProject; onClose: () => void }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      // Stop the preview from loading before its link is released (else the browser logs an error).
      video?.removeAttribute('src');
      video?.load();
      URL.revokeObjectURL(url);
    };
  }, [url]);
  const [caption, setCaption] = useState(() => postCaption(project));
  const [note, setNote] = useState('');
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const share = async () => {
    try {
      await navigator.share({ files: [file], title: project.name, text: caption });
      setNote('Shared.');
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) setNote('Sharing did not work here. Download the file and upload it instead.');
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      setNote('Caption copied.');
    } catch {
      setNote('Select the caption and copy it.');
    }
  };
  const mb = (file.size / 1_000_000).toFixed(1);
  return (
    <div className="modal-backdrop" data-modal onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal post-modal" role="dialog" aria-label="Your video is ready">
        <div className="look-head">
          <h3>🎉 Your video is ready</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <video ref={videoRef} className="post-preview" src={url} controls playsInline preload="metadata" />
        <p className="hint">
          {file.name} · {mb} MB · saved to your downloads
        </p>
        <div className="row">
          {canShareFile(file) && (
            <button className="primary" onClick={() => void share()}>
              <Icon name="upload" size={15} /> Share…
            </button>
          )}
          <button onClick={() => downloadBlob(file, file.name)}>
            <Icon name="download" size={15} /> Download again
          </button>
        </div>
        <h4>Post it</h4>
        <p className="hint">{canShareFile(file) ? 'Share sends it straight to TikTok, Instagram, YouTube and other apps on this device. Or open a site and drop the file in:' : 'Open the site, then drag the file from your downloads into its upload box:'}</p>
        <div className="post-sites">
          {POST_SITES.map((s) => (
            <a key={s.id} className="button" href={s.url} target="_blank" rel="noopener noreferrer" title={s.note}>
              {s.label}
            </a>
          ))}
        </div>
        <label className="field">
          <span>Caption</span>
          <textarea rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} aria-label="Post caption" />
        </label>
        <button onClick={() => void copy()}>
          <Icon name="copy" size={15} /> Copy caption
        </button>
        {note && (
          <p className="hint" role="status">
            {note}
          </p>
        )}
      </div>
    </div>
  );
}
