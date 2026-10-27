import { useEffect, useRef, useState } from 'react';
import { getMedia, putMedia, RECIPE_MEDIA_PREFIX } from '../lib/projects';
import { Icon } from '../ui/Icon';
import { describeRecipe, detectParts, extractRecipe, RECIPE_PARTS } from './recipes';
import type { Recipe, RecipePart } from './recipes';
import type { MediaAsset, VideoProject } from './types';

const KEY = 'bee.recipes';

export function loadRecipes(): Recipe[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveRecipes(list: Recipe[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    alert('Could not save the recipe (browser storage is full or off).');
  }
}

/** The recipe's media files, ready to use in a project. */
async function recipeAssets(r: Recipe): Promise<MediaAsset[]> {
  const out: MediaAsset[] = [];
  for (const a of r.assets) {
    const blob = await getMedia(a.id);
    if (blob) out.push({ ...a, url: URL.createObjectURL(blob) });
  }
  return out;
}

/**
 * Save how this video is edited as a recipe, or replay a saved recipe on it.
 * Recipes live in this browser; their music and logos are kept in the media store.
 */
export function RecipesDialog({ project, onApply, onClose }: { project: VideoProject; onApply: (r: Recipe, assets: MediaAsset[]) => void; onClose: () => void }) {
  const [recipes, setRecipes] = useState<Recipe[]>(loadRecipes);
  const found = detectParts(project);
  const available = RECIPE_PARTS.filter((p) => found[p.id]);
  const [parts, setParts] = useState<RecipePart[]>(() => available.filter((p) => p.id !== 'shape').map((p) => p.id));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const update = (list: Recipe[]) => {
    setRecipes(list);
    saveRecipes(list);
  };

  const save = async () => {
    setBusy(true);
    try {
      const r = extractRecipe(project, parts, name.trim() || `Recipe ${recipes.length + 1}`);
      // The recipe keeps its own copy of music and logos, so it still works after this project is deleted.
      const ids = new Map<string, string>();
      for (const a of r.assets) {
        const src = project.assets.find((x) => x.id === a.id);
        if (!src) continue;
        const id = a.id.startsWith(RECIPE_MEDIA_PREFIX) ? a.id : `${RECIPE_MEDIA_PREFIX}${r.id}-${a.id}`;
        if (id !== a.id) await putMedia(id, await (await fetch(src.url)).blob());
        ids.set(a.id, id);
      }
      const map = (id: string) => ids.get(id) ?? id;
      const saved: Recipe = {
        ...r,
        assets: r.assets.map((a) => ({ ...a, id: map(a.id) })),
        intro: r.intro && { ...r.intro, sounds: r.intro.sounds.map((s) => ({ ...s, assetId: map(s.assetId) })) },
        outro: r.outro && { ...r.outro, sounds: r.outro.sounds.map((s) => ({ ...s, assetId: map(s.assetId) })) },
        music: r.music && { ...r.music, assetId: map(r.music.assetId) },
        watermark: r.watermark && { ...r.watermark, assetId: r.watermark.assetId && map(r.watermark.assetId) },
      };
      update([saved, ...recipes]);
      setName('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not save the recipe');
    } finally {
      setBusy(false);
    }
  };

  const apply = async (r: Recipe) => {
    setBusy(true);
    try {
      onApply(r, await recipeAssets(r));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" data-modal onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal recipes-modal" role="dialog" aria-label="Edit recipes">
        <div className="look-head">
          <h3>Edit recipes</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <p className="hint">Save how this video is edited, then replay it on your next video in one click — same intro, captions, look, music and outro.</p>

        <h4>My recipes</h4>
        {recipes.length === 0 && <p className="hint">No recipes yet. Save one below.</p>}
        <ul className="recipe-list">
          {recipes.map((r) => (
            <li key={r.id} className="recipe-card">
              <div>
                <strong>{r.name}</strong>
                <small>{describeRecipe(r).join(' · ') || 'Empty'}</small>
              </div>
              <button className="primary" onClick={() => void apply(r)} disabled={busy} aria-label={`Apply ${r.name}`}>
                Apply
              </button>
              <button
                className="icon-btn"
                onClick={() => confirm(`Delete the recipe "${r.name}"?`) && update(recipes.filter((x) => x.id !== r.id))}
                aria-label={`Delete ${r.name}`}
                title="Delete"
              >
                <Icon name="trash" size={15} />
              </button>
            </li>
          ))}
        </ul>

        <h4>Save this video as a recipe</h4>
        {available.length === 0 ? (
          <p className="hint">Edit something first (titles, captions, a look, music…).</p>
        ) : (
          <>
            <div className="recipe-parts">
              {available.map((p) => (
                <label key={p.id} className="check">
                  <input type="checkbox" checked={parts.includes(p.id)} onChange={(e) => setParts(e.target.checked ? [...parts, p.id] : parts.filter((x) => x !== p.id))} />
                  <span>
                    {p.label} <small>{found[p.id]}</small>
                  </span>
                </label>
              ))}
            </div>
            <div className="row">
              <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Recipe name, e.g. Weekly vlog" aria-label="Recipe name" />
              <button className="primary" onClick={() => void save()} disabled={busy || parts.length === 0}>
                <Icon name="plus" size={15} /> Save recipe
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
