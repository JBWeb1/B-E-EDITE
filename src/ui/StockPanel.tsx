import { useState } from 'react';
import { formatTime } from '../lib/download';
import { creditLine, fetchStock, loadPexelsKey, savePexelsKey, searchStock, stockFileName } from '../lib/stock';
import type { StockItem, StockKind } from '../lib/stock';
import { Icon } from './Icon';

const LABELS: Record<StockKind, string> = { image: 'Photos', video: 'Videos', audio: 'Music & sounds' };
const IDEAS: Record<StockKind, string[]> = {
  image: ['nature', 'city', 'food', 'beach', 'office', 'abstract'],
  video: ['ocean', 'city night', 'coffee', 'forest', 'sky', 'people'],
  audio: ['upbeat', 'piano', 'lofi', 'whoosh', 'applause', 'birds'],
};

/** Search free stock photos, videos and sounds, and add one with a click. */
export function StockPanel({ kinds, onPick }: { kinds: StockKind[]; onPick: (file: File, item: StockItem) => Promise<void> | void }) {
  const [kind, setKind] = useState<StockKind>(kinds[0]);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [key, setKey] = useState(loadPexelsKey);

  const search = async (q = query, k = kind) => {
    if (!q.trim()) return;
    setQuery(q);
    setError('');
    setBusy('Searching…');
    try {
      setItems(await searchStock(k, q));
    } catch (err) {
      setItems(null);
      setError(err instanceof Error ? (/fetch/i.test(err.message) ? 'Could not reach the stock library. Check your internet connection.' : err.message) : 'Search failed');
    } finally {
      setBusy(null);
    }
  };
  const pick = async (item: StockItem) => {
    setBusy(`Adding “${item.title}”…`);
    setError('');
    try {
      const blob = await fetchStock(item);
      await onPick(new File([blob], stockFileName(item, blob.type), { type: blob.type || (item.kind === 'image' ? 'image/jpeg' : item.kind === 'video' ? 'video/mp4' : 'audio/mpeg') }), item);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that file');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stock-panel">
      {kinds.length > 1 && (
        <div className="segmented" role="group" aria-label="Stock type">
          {kinds.map((k) => (
            <button key={k} className={kind === k ? 'active' : ''} onClick={() => (setKind(k), setItems(null), query && void search(query, k))}>
              {LABELS[k]}
            </button>
          ))}
        </div>
      )}
      <form
        className="row stock-search"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search free ${LABELS[kind].toLowerCase()}…`} aria-label="Search stock" />
        <button type="submit" disabled={!query.trim() || !!busy} aria-label="Search">
          <Icon name="search" size={15} />
        </button>
      </form>
      {kind === 'video' && (
        <label className="field">
          <span>Pexels key (free at pexels.com/api)</span>
          <input type="password" value={key} onChange={(e) => (setKey(e.target.value.trim()), savePexelsKey(e.target.value.trim()))} aria-label="Pexels key" autoComplete="off" />
        </label>
      )}
      {!items && !busy && (
        <div className="chips">
          {IDEAS[kind].map((q) => (
            <button key={q} className="chip" onClick={() => void search(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
      {busy && (
        <p className="hint" role="status">
          {busy}
        </p>
      )}
      {error && (
        <p className="hint error" role="alert">
          {error}
        </p>
      )}
      {items && items.length === 0 && <p className="hint">Nothing found for “{query}”.</p>}
      {items && kind !== 'audio' && (
        <div className="stock-grid">
          {items.map((it) => (
            <button key={it.id} className="card stock-item" onClick={() => void pick(it)} title={creditLine(it)} aria-label={`Add ${it.title}`} disabled={!!busy}>
              <img src={it.thumb} alt="" loading="lazy" />
              {it.duration ? <span className="asset-dur">{formatTime(it.duration)}</span> : null}
            </button>
          ))}
        </div>
      )}
      {items && kind === 'audio' && (
        <div className="list stock-sounds">
          {items.map((it) => (
            <div key={it.id} className="stock-sound">
              <audio src={it.url} controls preload="none" aria-label={`Listen to ${it.title}`} />
              <button onClick={() => void pick(it)} aria-label={`Add ${it.title}`} disabled={!!busy} title={creditLine(it)}>
                <Icon name="plus" size={15} /> {it.title.slice(0, 32)}
                {it.duration ? ` · ${formatTime(it.duration)}` : ''}
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="hint">
        {kind === 'video' ? 'Videos from Pexels, free to use.' : 'Openly licensed media from Openverse.'} Hover a result to see who made it and its licence; the credit is kept in the file’s name.
      </p>
    </div>
  );
}
