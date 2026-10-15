import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import { downloadBlob, readFileAsDataURL } from '../lib/download';
import { FILTER_PRESETS, NEUTRAL_FILTERS, sameFilters } from '../lib/filters';
import type { Filters } from '../lib/filters';
import { useHistory } from '../lib/history';
import { saveDesignProject } from '../lib/projects';
import { uid } from '../lib/id';
import { ColorField, NumberField, RangeField } from '../ui/fields';
import { removeBackgroundFromImage } from '../lib/bgremove';
import { FilterSliders } from '../ui/FilterSliders';
import { FirstRunTips, ShortcutsDialog, shortcutsBlocked } from '../ui/Help';
import { LookSettings } from '../ui/LookSettings';
import { alpha, lookAttributes, lookStyle, templateById, useLook } from '../lib/look';
import { Icon } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { Menu, MenuItem } from '../ui/Menu';
import type { Shortcut } from '../ui/Help';
import {
  addElement,
  alignElements,
  applyCrop,
  boundsOf,
  createImage,
  createShape,
  createSticker,
  createText,
  cropRect,
  docColors,
  distributeElements,
  duplicateElements,
  elementAt,
  elementsInRect,
  FONTS,
  GRADIENT_PRESETS,
  handlePosition,
  HANDLE_SIGNS,
  isDesignDoc,
  moveElements,
  moveLayer,
  normalizeRect,
  removeElements,
  resizeBox,
  resizeDoc,
  rotationFromPoint,
  rotationHandlePosition,
  snapPosition,
  updateElement,
} from './model';
import type { AlignMode, Guide, Handle, LayerMove, Point, Rect } from './model';
import { animateAll, ANIMATIONS, entranceLength } from './animate';
import { blankPage, duplicatePage, insertPage, isDesignFile, movePage, normalizeFile, pageDuration, pageView, removePage, withPage } from './pages';
import { Presenter } from './Presenter';
import { designThumbnail, exportDesign, exportDesignVideo, exportPdf, ImageCache, measureTextHeight, renderDesign } from './render';
import { SIZE_PRESETS, TEMPLATES } from './templates';
import type { Crop, DesignDoc, DesignElement, DesignFile, ElementAnimation, Gradient, ImageElement, ShapeKind, TextElement } from './types';

const SWATCHES = ['#ffffff', '#111827', '#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6', '#fde68a', '#d1fae5'];
const SHAPES: ShapeKind[] = ['rect', 'ellipse', 'triangle', 'star', 'line', 'heart', 'arrow', 'bubble', 'hexagon', 'diamond'];
const STICKERS = ['😀', '😂', '😍', '🥳', '😎', '🔥', '⭐', '❤️', '👍', '🎉', '✨', '💯', '🚀', '🌈', '☀️', '🌸', '🍕', '☕', '📣', '✅'];
const CROP_ASPECTS: { label: string; aspect: number | null }[] = [
  { label: 'Original', aspect: null },
  { label: '1:1', aspect: 1 },
  { label: '4:5', aspect: 4 / 5 },
  { label: '3:2', aspect: 3 / 2 },
  { label: '16:9', aspect: 16 / 9 },
  { label: '9:16', aspect: 9 / 16 },
];
const HANDLES = Object.keys(HANDLE_SIGNS) as Handle[];
const HANDLE_CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
};
const ALIGN_BUTTONS: { mode: AlignMode; icon: string; label: string }[] = [
  { mode: 'left', icon: '⇤', label: 'Left' },
  { mode: 'hcenter', icon: '↔', label: 'Center' },
  { mode: 'right', icon: '⇥', label: 'Right' },
  { mode: 'top', icon: '⤒', label: 'Top' },
  { mode: 'vcenter', icon: '↕', label: 'Middle' },
  { mode: 'bottom', icon: '⤓', label: 'Bottom' },
];

const SHORTCUTS: Shortcut[] = [
  { keys: ['Ctrl', 'Z'], action: 'Undo' },
  { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo' },
  { keys: ['Ctrl', 'C'], action: 'Copy' },
  { keys: ['Ctrl', 'V'], action: 'Paste (also pastes images)' },
  { keys: ['Ctrl', 'D'], action: 'Duplicate' },
  { keys: ['Ctrl', 'A'], action: 'Select everything' },
  { keys: ['Shift', 'Click'], action: 'Add to / remove from selection' },
  { keys: ['Del'], action: 'Delete' },
  { keys: ['Arrows'], action: 'Nudge 1px (Shift: 10px)' },
  { keys: ['Alt', 'Drag'], action: 'Move without snapping' },
  { keys: ['Shift', 'Rotate'], action: 'Rotate in 15° steps' },
  { keys: ['Esc'], action: 'Deselect' },
  { keys: ['Page Up'], action: 'Previous page' },
  { keys: ['Page Down'], action: 'Next page' },
  { keys: ['?'], action: 'Show this help' },
];

type Tab = 'templates' | 'text' | 'elements' | 'uploads' | 'background';

type Drag =
  | { mode: 'move'; start: Point; origins: Map<string, Point>; bounds: Rect; clickedId: string; moved: boolean }
  | { mode: 'resize'; start: Point; el: DesignElement; handle: Handle }
  | { mode: 'rotate'; el: DesignElement }
  | { mode: 'marquee'; start: Point; base: string[] };

let measureCtx: CanvasRenderingContext2D | null = null;
function fitTextHeight(el: TextElement): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  return measureCtx ? measureTextHeight(measureCtx, el) : el.height;
}

function loadImageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = reject;
    img.src = src;
  });
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

const gradientCss = (g: Gradient) => `linear-gradient(${g.angle + 90}deg, ${g.from}, ${g.to})`;

type Updater<T> = T | ((prev: T) => T);
const applyUpdate = <T,>(u: Updater<T>, prev: T): T => (typeof u === 'function' ? (u as (p: T) => T)(prev) : u);

export function DesignEditor({ initialFile, projectId, onExit }: { initialFile: DesignFile; projectId: string; onExit: () => void }) {
  // Undo history covers the whole file; editing tools see one page at a time.
  const fileHistory = useHistory<DesignFile>(initialFile);
  const file = fileHistory.state;
  const [pageIndex, setPageIndex] = useState(0);
  const page = Math.min(pageIndex, file.pages.length - 1);
  const doc = useMemo(() => pageView(file, page), [file, page]);
  const { mark } = fileHistory;
  const fileSet = fileHistory.set;
  const fileSetTransient = fileHistory.setTransient;
  const set = useCallback(
    (u: Updater<DesignDoc>) => fileSet((f) => withPage(f, page, applyUpdate(u, pageView(f, page)))),
    [fileSet, page],
  );
  const setTransient = useCallback(
    (u: Updater<DesignDoc>) => fileSetTransient((f) => withPage(f, page, applyUpdate(u, pageView(f, page)))),
    [fileSetTransient, page],
  );
  const history = useMemo(
    () => ({
      undo: fileHistory.undo,
      redo: fileHistory.redo,
      canUndo: fileHistory.canUndo,
      canRedo: fileHistory.canRedo,
      reset: (value: DesignFile | DesignDoc) => fileHistory.reset(normalizeFile(value)),
    }),
    [fileHistory],
  );
  const [presenting, setPresenting] = useState<number | null>(null);
  const [previewStart, setPreviewStart] = useState<number | null>(null);
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [menu, setMenu] = useState<Point | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showLook, setShowLook] = useState(false);
  const look = useLook();
  // Selection outlines follow the editor's highlight colour.
  const selectColor = look.accent ?? templateById(look.template).palette.accent;
  const [tab, setTab] = useState<Tab>('templates');
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const [fitZoom, setFitZoom] = useState(0.5);
  const [imageVersion, setImageVersion] = useState(0);
  const [uploads, setUploads] = useState<string[]>([]);
  const [exportScale, setExportScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => !window.matchMedia?.('(max-width: 760px)').matches);
  const openInputRef = useRef<HTMLInputElement>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const clipboardRef = useRef<DesignElement[]>([]);
  const images = useMemo(() => new ImageCache(() => setImageVersion((v) => v + 1)), []);
  const templateThumbs = useMemo(() => TEMPLATES.map((t) => designThumbnail(t.build(), 200)), []);

  const zoom = zoomOverride ?? fitZoom;
  const selectedEls = doc.elements.filter((e) => selectedIds.includes(e.id));
  const selected = selectedEls.length === 1 ? selectedEls[0] : null;
  const editing = doc.elements.find((e) => e.id === editingId && e.type === 'text') as TextElement | undefined;

  // Drop selection ids that no longer exist (after undo, delete, template swap…).
  useEffect(() => {
    const ids = new Set(doc.elements.map((e) => e.id));
    setSelectedIds((sel) => (sel.every((id) => ids.has(id)) ? sel : sel.filter((id) => ids.has(id))));
  }, [doc.elements]);

  // Autosave so work survives a refresh. Untouched blank designs are not saved.
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error' | null>(null);
  useEffect(() => {
    if (file === initialFile && file.pages.every((p) => p.elements.length === 0)) return;
    setSaveState('saving');
    const t = setTimeout(() => {
      saveDesignProject(projectId, file, designThumbnail(pageView(file, 0), 240, images)).then(
        () => setSaveState('saved'),
        () => setSaveState('error'),
      );
    }, 600);
    return () => clearTimeout(t);
  }, [file, initialFile, projectId, images]);

  // Play the page's entrance animations on the canvas.
  useEffect(() => {
    if (previewStart === null) return;
    const end = entranceLength(doc) + 0.3;
    let raf = 0;
    const tick = () => {
      const t = (performance.now() - previewStart) / 1000;
      if (t >= end) {
        setPreviewStart(null);
        setPreviewTime(null);
        return;
      }
      setPreviewTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [previewStart, doc]);

  const setFile = fileSet;
  const goToPage = (i: number) => {
    setPageIndex(Math.max(0, Math.min(i, file.pages.length - 1)));
    setSelectedIds([]);
    setEditingId(null);
  };
  const addPage = () => {
    setFile((f) => insertPage(f, page + 1, blankPage(doc.background)));
    setPageIndex(page + 1);
    setSelectedIds([]);
  };
  const copyPage = () => {
    setFile((f) => duplicatePage(f, page));
    setPageIndex(page + 1);
    setSelectedIds([]);
  };
  const deletePage = () => {
    if (file.pages.length <= 1) return;
    if (file.pages[page].elements.length > 0 && !confirm(`Delete page ${page + 1}?`)) return;
    setFile((f) => removePage(f, page));
    setPageIndex(Math.max(0, page - 1));
    setSelectedIds([]);
  };
  const shiftPage = (delta: number) => {
    const to = page + delta;
    if (to < 0 || to >= file.pages.length) return;
    setFile((f) => movePage(f, page, to));
    setPageIndex(to);
  };
  // Keyboard handler reads the latest page through a ref, so it needn't re-subscribe.
  const goToPageRef = useRef((delta: number) => goToPage(page + delta));
  goToPageRef.current = (delta: number) => goToPage(page + delta);

  const setPageSeconds = (seconds: number) =>
    setFile((f) => ({ ...f, pages: f.pages.map((p, i) => (i === page ? { ...p, duration: seconds } : p)) }));

  // Fit the artboard to the available space.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const pad = 64;
      const z = Math.min((stage.clientWidth - pad) / doc.width, (stage.clientHeight - pad) / doc.height);
      setFitZoom(Math.max(0.05, z));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [doc.width, doc.height]);

  // Draw design + selection overlay.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(doc.width * zoom * dpr);
    canvas.height = Math.round(doc.height * zoom * dpr);
    canvas.style.width = `${doc.width * zoom}px`;
    canvas.style.height = `${doc.height * zoom}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
    renderDesign(ctx, doc, images, editingId ?? undefined, previewTime ?? undefined);

    const px = 1 / zoom;
    if (!editingId && previewTime === null) {
      for (const el of selectedEls) {
        const c = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate((el.rotation * Math.PI) / 180);
        ctx.strokeStyle = el.locked ? '#9ca3af' : selectColor;
        ctx.lineWidth = (selected ? 2 : 1.5) * px;
        ctx.strokeRect(-el.width / 2, -el.height / 2, el.width, el.height);
        ctx.restore();
      }
      if (selectedEls.length > 1) {
        const b = boundsOf(selectedEls)!;
        ctx.save();
        ctx.setLineDash([6 * px, 4 * px]);
        ctx.strokeStyle = selectColor;
        ctx.lineWidth = px;
        ctx.strokeRect(b.x, b.y, b.width, b.height);
        ctx.restore();
      }
      if (selected && !selected.locked) {
        const size = 10 * px;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = selectColor;
        ctx.lineWidth = 1.5 * px;
        for (const h of visibleHandles(selected)) {
          const p = handlePosition(selected, h);
          ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
          ctx.strokeRect(p.x - size / 2, p.y - size / 2, size, size);
        }
        const r = rotationHandlePosition(selected, 28 * px);
        ctx.beginPath();
        ctx.arc(r.x, r.y, 7 * px, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    if (marquee) {
      ctx.fillStyle = alpha(selectColor, 0.1);
      ctx.strokeStyle = selectColor;
      ctx.lineWidth = px;
      ctx.fillRect(marquee.x, marquee.y, marquee.width, marquee.height);
      ctx.strokeRect(marquee.x, marquee.y, marquee.width, marquee.height);
    }
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = px;
    for (const g of guides) {
      ctx.beginPath();
      if (g.axis === 'x') {
        ctx.moveTo(g.pos, 0);
        ctx.lineTo(g.pos, doc.height);
      } else {
        ctx.moveTo(0, g.pos);
        ctx.lineTo(doc.width, g.pos);
      }
      ctx.stroke();
    }
    // selectedEls/selected are derived from doc + selectedIds, which are listed.
  }, [doc, zoom, selectedIds, editingId, guides, marquee, images, imageVersion, previewTime, selectColor]);

  const toDoc = (e: { clientX: number; clientY: number }): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
  };

  const hitHandle = (el: DesignElement, p: Point): Handle | 'rotate' | null => {
    if (el.locked) return null;
    const tol = 10 / zoom;
    const r = rotationHandlePosition(el, 28 / zoom);
    if (Math.hypot(p.x - r.x, p.y - r.y) <= tol) return 'rotate';
    for (const h of visibleHandles(el)) {
      const hp = handlePosition(el, h);
      if (Math.abs(p.x - hp.x) <= tol && Math.abs(p.y - hp.y) <= tol) return h;
    }
    return null;
  };

  const startMove = (p: Point, ids: string[], clickedId: string) => {
    const movable = doc.elements.filter((e) => ids.includes(e.id) && !e.locked);
    if (movable.length === 0) return;
    dragRef.current = {
      mode: 'move',
      start: p,
      origins: new Map(movable.map((e) => [e.id, { x: e.x, y: e.y }])),
      bounds: boundsOf(movable)!,
      clickedId,
      moved: false,
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (editingId || e.button !== 0) return;
    setMenu(null);
    const p = toDoc(e);
    const handle = selected ? hitHandle(selected, p) : null;
    if (selected && handle) {
      dragRef.current = handle === 'rotate' ? { mode: 'rotate', el: selected } : { mode: 'resize', start: p, el: selected, handle };
    } else {
      const hit = elementAt(doc, p, 6 / zoom);
      if (hit && e.shiftKey) {
        const next = selectedIds.includes(hit.id) ? selectedIds.filter((id) => id !== hit.id) : [...selectedIds, hit.id];
        setSelectedIds(next);
        if (next.includes(hit.id)) startMove(p, next, hit.id);
      } else if (hit) {
        const next = selectedIds.includes(hit.id) ? selectedIds : [hit.id];
        setSelectedIds(next);
        startMove(p, next, hit.id);
      } else {
        const base = e.shiftKey ? selectedIds : [];
        setSelectedIds(base);
        dragRef.current = { mode: 'marquee', start: p, base };
      }
    }
    if (dragRef.current) {
      if (dragRef.current.mode !== 'marquee') mark();
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = toDoc(e);
    const drag = dragRef.current;
    if (!drag) {
      const handle = selected ? hitHandle(selected, p) : null;
      const cursor = handle === 'rotate' ? 'grab' : handle ? HANDLE_CURSORS[handle] : elementAt(doc, p, 6 / zoom) ? 'move' : 'default';
      e.currentTarget.style.cursor = cursor;
      return;
    }
    if (drag.mode === 'marquee') {
      const r = normalizeRect(drag.start, p);
      setMarquee(r);
      const inside = elementsInRect(doc, r);
      setSelectedIds([...new Set([...drag.base, ...inside])]);
    } else if (drag.mode === 'move') {
      let dx = p.x - drag.start.x;
      let dy = p.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) * zoom < 3) return;
      drag.moved = true;
      if (!e.altKey) {
        const ids = [...drag.origins.keys()];
        const raw = { ...drag.bounds, x: drag.bounds.x + dx, y: drag.bounds.y + dy };
        const snapped = snapPosition(doc, ids, raw, 8 / zoom);
        dx += snapped.x - raw.x;
        dy += snapped.y - raw.y;
        setGuides(snapped.guides);
      } else {
        setGuides([]);
      }
      setTransient((d) => ({
        ...d,
        elements: d.elements.map((el) => {
          const o = drag.origins.get(el.id);
          return o ? { ...el, x: Math.round(o.x + dx), y: Math.round(o.y + dy) } : el;
        }),
      }));
    } else if (drag.mode === 'rotate') {
      setTransient((d) => updateElement(d, drag.el.id, { rotation: Math.round(rotationFromPoint(drag.el, p, e.shiftKey)) }));
    } else {
      const el = drag.el;
      const delta = { x: p.x - drag.start.x, y: p.y - drag.start.y };
      const [sx, sy] = HANDLE_SIGNS[drag.handle];
      const corner = !!(sx && sy);
      // Images and text keep their proportions on corners by default (Shift toggles).
      const keepRatio = el.type === 'shape' ? e.shiftKey : !e.shiftKey;
      const box = resizeBox(el, drag.handle, delta, corner && keepRatio);
      let patch: Partial<DesignElement> = box;
      if (el.type === 'text') {
        const fontSize = corner && keepRatio ? Math.max(6, el.fontSize * (box.width / el.width)) : el.fontSize;
        const next = { ...el, ...box, fontSize };
        patch = { ...box, fontSize, height: fitTextHeight(next) };
      }
      setTransient((d) => updateElement(d, el.id, roundBox(patch)));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    // A plain click on one item of a multi-selection selects just that item.
    if (drag?.mode === 'move' && !drag.moved && !e.shiftKey && selectedIds.length > 1) setSelectedIds([drag.clickedId]);
    setGuides([]);
    setMarquee(null);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = elementAt(doc, toDoc(e), 6 / zoom);
    if (hit?.type === 'text' && !hit.locked) {
      setSelectedIds([hit.id]);
      setEditingId(hit.id);
      mark();
    }
  };

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const hit = elementAt(doc, toDoc(e), 6 / zoom);
    if (hit && !selectedIds.includes(hit.id)) setSelectedIds([hit.id]);
    if (!hit) setSelectedIds([]);
    setMenu({ x: e.clientX, y: e.clientY });
  };

  // Close the context menu on any outside click.
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.context-menu')) setMenu(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  const insert = useCallback(
    (el: DesignElement) => {
      set((d) => addElement(d, el));
      setSelectedIds([el.id]);
    },
    [set],
  );

  const addImageFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        const src = await readFileAsDataURL(file);
        setUploads((u) => [src, ...u]);
        const { w, h } = await loadImageSize(src);
        insert(createImage(doc, src, w, h));
      }
    },
    [doc, insert],
  );

  const patchSelected = (patch: Partial<DesignElement>, live = false) => {
    if (!selected) return;
    let next = { ...selected, ...patch } as DesignElement;
    if (next.type === 'text') next = { ...next, height: fitTextHeight(next) };
    const fn = (d: DesignDoc) => updateElement(d, selected.id, next);
    if (live) setTransient(fn);
    else set(fn);
  };

  const patchImageFilters = (patch: Partial<Filters>) => {
    if (selected?.type !== 'image') return;
    patchSelected({ filters: { ...(selected.filters ?? NEUTRAL_FILTERS), ...patch } }, true);
  };

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    set((d) => removeElements(d, selectedIds));
  }, [selectedIds, set]);

  const duplicateSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const result = duplicateElements(doc, selectedIds);
    set(result.doc);
    setSelectedIds(result.ids);
  }, [doc, selectedIds, set]);

  const copySelected = useCallback(() => {
    clipboardRef.current = doc.elements.filter((e) => selectedIds.includes(e.id));
  }, [doc, selectedIds]);

  const paste = useCallback(() => {
    if (clipboardRef.current.length === 0) return;
    const copies = clipboardRef.current.map((e) => ({ ...e, id: uid(e.type), x: e.x + 20, y: e.y + 20, locked: false }));
    clipboardRef.current = copies;
    set((d) => ({ ...d, elements: [...d.elements, ...copies] }));
    setSelectedIds(copies.map((c) => c.id));
  }, [set]);

  const toggleLock = () => {
    const lock = !selectedEls.every((e) => e.locked);
    set((d) => ({ ...d, elements: d.elements.map((e) => (selectedIds.includes(e.id) ? { ...e, locked: lock } : e)) }));
  };

  const layer = (move: LayerMove) => {
    if (selectedIds.length === 0) return;
    set((d) => {
      // Keep the selection's relative order when moving several layers.
      const ordered = d.elements.filter((e) => selectedIds.includes(e.id)).map((e) => e.id);
      const sequence = move === 'top' || move === 'down' ? ordered : [...ordered].reverse();
      return sequence.reduce((acc, id) => moveLayer(acc, id, move), d);
    });
  };

  const align = (mode: AlignMode) => set((d) => alignElements(d, selectedIds, mode));

  // Keyboard shortcuts. The window listeners are added once and call the latest
  // handlers through refs, so they never need re-adding mid-keypress.
  const keyHandlers = useRef<{ onKey: (e: KeyboardEvent) => void; onPaste: (e: ClipboardEvent) => void }>();
  {
    const onKey = (e: KeyboardEvent) => {
      // Off while typing, while a dialog/menu/slideshow is open, or during an animation preview.
      if (isTyping(e.target) || shortcutsBlocked() || previewStart !== null) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        history.redo();
      } else if (mod && key === 'd') {
        e.preventDefault();
        duplicateSelected();
      } else if (mod && key === 'a') {
        e.preventDefault();
        setSelectedIds(doc.elements.map((el) => el.id));
      } else if (mod && key === 'c') {
        copySelected();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'Escape') {
        setSelectedIds([]);
        setMenu(null);
      } else if (e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault();
        goToPageRef.current(e.key === 'PageDown' ? 1 : -1);
      } else if (e.key === '?') {
        setShowHelp(true);
      } else if (e.key.startsWith('Arrow') && selectedIds.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        set((d) => moveElements(d, selectedIds, dx, dy));
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || shortcutsBlocked()) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        void addImageFiles(files);
      } else if (clipboardRef.current.length) {
        e.preventDefault();
        paste();
      }
    };
    keyHandlers.current = { onKey, onPaste };
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandlers.current?.onKey(e);
    const onPaste = (e: ClipboardEvent) => keyHandlers.current?.onPaste(e);
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  const doExport = async (type: 'image/png' | 'image/jpeg') => {
    setBusy(true);
    try {
      const blob = await exportDesign(doc, type, exportScale);
      downloadBlob(blob, `${doc.name || 'design'}.${type === 'image/png' ? 'png' : 'jpg'}`);
    } finally {
      setBusy(false);
    }
  };

  const doExportPdf = async () => {
    setBusy(true);
    try {
      downloadBlob(await exportPdf(file), `${doc.name || 'design'}.pdf`);
    } finally {
      setBusy(false);
    }
  };

  const doExportVideo = async () => {
    setVideoProgress(0);
    setSelectedIds([]);
    try {
      const blob = await exportDesignVideo(file, setVideoProgress);
      downloadBlob(blob, `${doc.name || 'design'}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Video export failed');
    } finally {
      setVideoProgress(null);
    }
  };

  const saveProject = () =>
    downloadBlob(new Blob([JSON.stringify(file)], { type: 'application/json' }), `${doc.name || 'design'}.bee.json`);

  const openProject = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!isDesignDoc(parsed) && !isDesignFile(parsed)) throw new Error('Not a design file');
      history.reset(parsed);
      setPageIndex(0);
      setSelectedIds([]);
    } catch {
      alert('Could not open that file. Choose a .bee.json design saved from B-E Motion.');
    }
  };

  const textPresets: { label: string; preset: Partial<TextElement> }[] = [
    { label: 'Add a heading', preset: { text: 'Heading', fontSize: Math.round(doc.width / 10), fontWeight: 'bold' } },
    { label: 'Add a subheading', preset: { text: 'Subheading', fontSize: Math.round(doc.width / 16), fontWeight: 'bold' } },
    { label: 'Add body text', preset: { text: 'Body text', fontSize: Math.round(doc.width / 28) } },
    { label: 'Outlined title', preset: { text: 'OUTLINE', fontSize: Math.round(doc.width / 9), fontWeight: 'bold', fontFamily: 'Impact, sans-serif', color: '#ffffff', outlineWidth: 4, outlineColor: '#111827', letterSpacing: 4 } },
    { label: 'Shadow title', preset: { text: 'Shadow', fontSize: Math.round(doc.width / 10), fontWeight: 'bold', color: '#f59e0b', shadow: true } },
  ];

  const allLocked = selectedEls.length > 0 && selectedEls.every((e) => e.locked);
  const usedColors = docColors(doc);

  /** Change the crop of the selected image without stretching it. */
  const setCrop = (crop: Crop | undefined, live = false) => {
    if (selected?.type !== 'image') return;
    const img = images.get(selected.src);
    const nw = selected.naturalWidth ?? img?.naturalWidth;
    const nh = selected.naturalHeight ?? img?.naturalHeight;
    if (!nw || !nh) return;
    const next = applyCrop({ ...selected, naturalWidth: nw, naturalHeight: nh }, crop, nw, nh);
    const fn = (d: DesignDoc) => updateElement(d, selected.id, roundBox(next));
    if (live) setTransient(fn);
    else set(fn);
  };

  return (
    <div className="editor design cc" style={lookStyle(look)} {...lookAttributes(look)}>
      <header className="topbar">
        <div className="topbar-group">
          <button className="brand-btn" onClick={onExit} title="Back to home" aria-label="Home">
            <Logo height={17} />
          </button>
          <span className="divider" />
          <span className={`save-state ${saveState ?? ''}`} aria-live="polite">
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && (
              <>
                <Icon name="check" size={14} /> Saved
              </>
            )}
            {saveState === 'error' && '⚠ Not saved'}
          </span>
        </div>
        <div className="topbar-group center">
          <input
            className="title-input center-title"
            value={doc.name}
            onFocus={mark}
            onChange={(e) => setTransient((d) => ({ ...d, name: e.target.value }))}
            aria-label="Design name"
          />
        </div>
        <div className="topbar-group end">
          <button className="icon-btn" onClick={() => setShowLook(true)} title="Editor look: themes and layout" aria-label="Editor look">
            <Icon name="palette" />
          </button>
          <button className="icon-btn" onClick={() => setShowHelp(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
            <Icon name="help" />
          </button>
          <Menu
            buttonClassName="primary"
            title="Download or save"
            label={
              <>
                <Icon name="download" /> <span className="label">Download</span> <Icon name="chevronDown" size={14} />
              </>
            }
          >
            <div className="menu-section">
              <span className="menu-heading">Size</span>
              <div className="segmented">
                {[0.5, 1, 2].map((v) => (
                  <button key={v} className={exportScale === v ? 'active' : ''} onClick={() => setExportScale(v)}>
                    {v}×
                  </button>
                ))}
              </div>
            </div>
            <MenuItem icon={<Icon name="image" />} title="PNG" detail="Sharpest quality, this page" onClick={() => doExport('image/png')} disabled={busy} />
            <MenuItem icon={<Icon name="image" />} title="JPG" detail="Smaller file, this page" onClick={() => doExport('image/jpeg')} disabled={busy} />
            <MenuItem icon={<Icon name="file" />} title="PDF" detail="Print-ready, all pages" onClick={doExportPdf} disabled={busy} />
            <MenuItem icon={<Icon name="film" />} title="Video" detail="Animated, all pages" onClick={doExportVideo} disabled={busy || videoProgress !== null} />
            <div className="menu-sep" />
            <MenuItem icon={<Icon name="folder" />} title="Save project file" detail="Editable .bee.json backup" onClick={saveProject} />
            <MenuItem icon={<Icon name="upload" />} title="Open project file" detail="Load a .bee.json" onClick={() => openInputRef.current?.click()} />
          </Menu>
          <input ref={openInputRef} type="file" accept=".json,application/json" hidden onChange={openProject} />
        </div>
      </header>

      <div className="workspace">
        <aside className={`panel cc-library ${panelOpen ? '' : 'collapsed'}`}>
          <nav className="cc-tabs" aria-label="Library">
          {(['templates', 'text', 'elements', 'uploads', 'background'] as Tab[]).map((t) => (
            <button
              key={t}
              className={tab === t ? 'active' : ''}
              onClick={() => {
                // Tapping the open tab again folds the panel away (handy on small screens).
                if (tab === t) setPanelOpen((o) => !o);
                else {
                  setTab(t);
                  setPanelOpen(true);
                }
              }}
            >
              <Icon name={({ templates: 'layout', text: 'text', elements: 'shapes', uploads: 'upload', background: 'droplet' } as const)[t]} size={18} />
              <span>{t[0].toUpperCase() + t.slice(1)}</span>
            </button>
          ))}
          </nav>
          {panelOpen && (
          <div className="cc-library-body">
          {tab === 'templates' && (
            <>
              <h3>Templates</h3>
              <div className="grid2">
                {TEMPLATES.map((t, i) => (
                  <button
                    key={t.label}
                    className="card template-card"
                    title={t.label}
                    onClick={() => {
                      if (file.pages.length > 1) {
                        // In a multi-page design, a template becomes a new page sized to match.
                        const built = resizeDoc(t.build(), doc.width, doc.height);
                        setFile((f) => insertPage(f, page + 1, { ...blankPage(built.background), gradient: built.gradient ?? null, elements: built.elements }));
                        setPageIndex(page + 1);
                        setSelectedIds([]);
                      } else if (doc.elements.length === 0 || confirm('Replace the current design with this template?')) {
                        set(t.build());
                        setSelectedIds([]);
                      }
                    }}
                  >
                    <img src={templateThumbs[i]} alt="" />
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
              <h3>Magic resize</h3>
              <p className="hint">Change the canvas size; everything is scaled to fit.</p>
              <div className="list">
                {SIZE_PRESETS.map((s) => (
                  <button key={s.label} onClick={() => set((d) => resizeDoc(d, s.width, s.height))}>
                    {s.label} <small>{s.width}×{s.height}</small>
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === 'text' && (
            <>
              <h3>Text</h3>
              <div className="list">
                {textPresets.map((t) => (
                  <button
                    key={t.label}
                    className="text-preset"
                    style={{ fontWeight: t.preset.fontWeight === 'bold' ? 700 : 400 }}
                    onClick={() => {
                      const el = createText(doc, t.preset);
                      insert({ ...el, height: fitTextHeight(el) });
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="hint">Double-click text on the canvas to edit it.</p>
            </>
          )}

          {tab === 'elements' && (
            <>
              <h3>Shapes</h3>
              <div className="grid3">
                {SHAPES.map((s) => (
                  <button key={s} className="card shape-card" onClick={() => insert(createShape(doc, s))} title={s}>
                    <ShapeIcon shape={s} />
                  </button>
                ))}
              </div>
              <h3>Stickers</h3>
              <div className="sticker-grid">
                {STICKERS.map((em) => (
                  <button key={em} onClick={() => insert(createSticker(doc, em))} title="Add sticker">
                    {em}
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === 'uploads' && (
            <>
              <h3>Uploads</h3>
              <label className="button primary block">
                Upload images
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files) void addImageFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
              <p className="hint">You can also drag images onto the canvas or paste them with Ctrl+V.</p>
              <div className="grid2">
                {uploads.map((src, i) => (
                  <button
                    key={i}
                    className="card thumb"
                    onClick={async () => {
                      const { w, h } = await loadImageSize(src);
                      insert(createImage(doc, src, w, h));
                    }}
                  >
                    <img src={src} alt="" />
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === 'background' && (
            <>
              <h3>Background</h3>
              <div className="row">
                <button className={!doc.gradient ? 'active' : ''} onClick={() => set((d) => ({ ...d, gradient: null }))}>Solid</button>
                <button className={doc.gradient ? 'active' : ''} onClick={() => !doc.gradient && set((d) => ({ ...d, gradient: GRADIENT_PRESETS[0] }))}>
                  Gradient
                </button>
              </div>
              {doc.gradient ? (
                <>
                  <div className="swatches">
                    {GRADIENT_PRESETS.map((g, i) => (
                      <button key={i} className="swatch" style={{ background: gradientCss(g) }} onClick={() => set((d) => ({ ...d, gradient: g }))} />
                    ))}
                  </div>
                  <ColorField label="From" value={doc.gradient.from} onStart={mark} onChange={(v) => setTransient((d) => ({ ...d, gradient: { ...d.gradient!, from: v } }))} swatches={usedColors} />
                  <ColorField label="To" value={doc.gradient.to} onStart={mark} onChange={(v) => setTransient((d) => ({ ...d, gradient: { ...d.gradient!, to: v } }))} swatches={usedColors} />
                  <RangeField label="Angle" value={doc.gradient.angle} min={0} max={360} step={5} onStart={mark} onChange={(v) => setTransient((d) => ({ ...d, gradient: { ...d.gradient!, angle: v } }))} format={(v) => `${v}°`} />
                </>
              ) : (
                <>
                  <ColorField label="Color" value={doc.background} onStart={mark} onChange={(v) => setTransient((d) => ({ ...d, background: v }))} swatches={usedColors} />
                  <div className="swatches">
                    {SWATCHES.map((c) => (
                      <button key={c} className="swatch" style={{ background: c }} onClick={() => set((d) => ({ ...d, background: c, gradient: null }))} title={c} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          </div>
          )}
        </aside>

        <div className="stage-column cc-player">
        <div className="cc-panel-head">
          <span>Canvas</span>
          <span className="cc-head-info">
            Page {page + 1} of {file.pages.length} · {doc.width}×{doc.height}
          </span>
        </div>
        <main
          className="stage"
          ref={stageRef}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setSelectedIds([]);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void addImageFiles(e.dataTransfer.files);
          }}
        >
          <div className="artboard" style={{ width: doc.width * zoom, height: doc.height * zoom }}>
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={onDoubleClick}
              onContextMenu={onContextMenu}
            />
            {editing && (
              <textarea
                className="text-editor"
                autoFocus
                value={editing.text}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  const next = { ...editing, text: e.target.value };
                  setTransient((d) => updateElement(d, editing.id, { text: next.text, height: fitTextHeight(next) }));
                }}
                onBlur={() => setEditingId(null)}
                onKeyDown={(e) => e.key === 'Escape' && setEditingId(null)}
                style={{
                  left: editing.x * zoom,
                  top: editing.y * zoom,
                  width: editing.width * zoom,
                  height: Math.max(editing.height, editing.fontSize * editing.lineHeight) * zoom,
                  font: `${editing.italic ? 'italic ' : ''}${editing.fontWeight} ${editing.fontSize * zoom}px ${editing.fontFamily}`,
                  lineHeight: editing.lineHeight,
                  letterSpacing: `${(editing.letterSpacing ?? 0) * zoom}px`,
                  color: editing.color,
                  textAlign: editing.align,
                  transform: `rotate(${editing.rotation}deg)`,
                }}
              />
            )}
          </div>
          <FirstRunTips
            storageKey="bee.tips.design"
            title="Welcome to the design editor 👋"
            tips={[
              'Pick a template or add text, shapes and photos from the left.',
              'Drag on empty canvas to select several things at once; Shift-click adds to the selection.',
              'Right-click anything for quick actions. Press ? for all shortcuts.',
            ]}
          />
        </main>
        <div className="cc-player-bar">
          <div className="cc-tools">
          <button className="icon-btn" onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
            <Icon name="undo" />
          </button>
          <button className="icon-btn" onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
            <Icon name="redo" />
          </button>
          </div>
          <div className="transport-center">
            <button className="secondary small" onClick={() => setPresenting(page)} title="Show pages full screen">
              <Icon name="present" size={16} /> Present
            </button>
          </div>
          <div className="cc-player-right">
          <div className="zoom">
            <button onClick={() => setZoomOverride(Math.max(0.05, zoom / 1.25))} title="Zoom out" aria-label="Zoom out">
              <Icon name="minus" size={16} />
            </button>
            <button className="zoom-value" onClick={() => setZoomOverride(null)} title="Fit to screen">
              {Math.round(zoom * 100)}%
            </button>
            <button onClick={() => setZoomOverride(Math.min(8, zoom * 1.25))} title="Zoom in" aria-label="Zoom in">
              <Icon name="plus" size={16} />
            </button>
          </div>
          </div>
        </div>
        </div>

        <aside className="panel right cc-details">
          <div className="cc-panel-head">
            <span>Details</span>
          </div>
          <div className="cc-details-body">
          {selectedEls.length > 1 ? (
            <>
              <h3>{selectedEls.length} elements selected</h3>
              <h4>Align</h4>
              <div className="grid3">
                {ALIGN_BUTTONS.map((a) => (
                  <button key={a.mode} onClick={() => align(a.mode)} title={`Align ${a.label.toLowerCase()}`}>
                    {a.icon} {a.label}
                  </button>
                ))}
              </div>
              <h4>Spacing</h4>
              <div className="row">
                <button disabled={selectedEls.length < 3} onClick={() => set((d) => distributeElements(d, selectedIds, 'x'))} title="Even horizontal spacing (3+ items)">
                  ⇹ Horizontally
                </button>
                <button disabled={selectedEls.length < 3} onClick={() => set((d) => distributeElements(d, selectedIds, 'y'))} title="Even vertical spacing (3+ items)">
                  ⇳ Vertically
                </button>
              </div>
              <h4>Arrange</h4>
              <div className="row">
                <button onClick={() => layer('top')}>Bring to front</button>
                <button onClick={() => layer('bottom')}>Send to back</button>
              </div>
              <div className="row">
                <button onClick={duplicateSelected}>Duplicate</button>
                <button onClick={toggleLock}>{allLocked ? 'Unlock' : 'Lock'}</button>
                <button className="danger" onClick={deleteSelected} disabled={allLocked}>Delete</button>
              </div>
            </>
          ) : selected ? (
            <>
              <h3>{selected.name}</h3>
              <div className="row">
                <button onClick={duplicateSelected} title="Duplicate (Ctrl+D)">Duplicate</button>
                <button onClick={toggleLock}>{selected.locked ? 'Unlock' : 'Lock'}</button>
                <button className="danger" onClick={deleteSelected} disabled={selected.locked}>Delete</button>
              </div>

              {selected.type === 'text' && (
                <>
                  <label className="field">
                    <span>Text</span>
                    <textarea value={selected.text} rows={3} onFocus={mark} onChange={(e) => patchSelected({ text: e.target.value }, true)} />
                  </label>
                  <label className="field">
                    <span>Font</span>
                    <select value={selected.fontFamily} onChange={(e) => patchSelected({ fontFamily: e.target.value })}>
                      {FONTS.map((f) => (
                        <option key={f} value={f} style={{ fontFamily: f }}>{f.split(',')[0].replace(/"/g, '')}</option>
                      ))}
                    </select>
                  </label>
                  <NumberField label="Size" value={selected.fontSize} min={4} onChange={(v) => patchSelected({ fontSize: v })} />
                  <div className="row">
                    <button className={selected.fontWeight === 'bold' ? 'active' : ''} onClick={() => patchSelected({ fontWeight: selected.fontWeight === 'bold' ? 'normal' : 'bold' })}><b>B</b></button>
                    <button className={selected.italic ? 'active' : ''} onClick={() => patchSelected({ italic: !selected.italic })}><i>I</i></button>
                    {(['left', 'center', 'right'] as const).map((a) => (
                      <button key={a} className={selected.align === a ? 'active' : ''} onClick={() => patchSelected({ align: a })}>
                        {{ left: '⇤', center: '↔', right: '⇥' }[a]}
                      </button>
                    ))}
                  </div>
                  <ColorField label="Color" value={selected.color} onStart={mark} onChange={(v) => patchSelected({ color: v }, true)} swatches={usedColors} />
                  <RangeField label="Line height" value={selected.lineHeight} min={0.8} max={3} step={0.05} onStart={mark} onChange={(v) => patchSelected({ lineHeight: v }, true)} />
                  <RangeField label="Letter spacing" value={selected.letterSpacing ?? 0} min={-5} max={50} step={1} onStart={mark} onChange={(v) => patchSelected({ letterSpacing: v }, true)} format={(v) => `${v}px`} />
                  <h4>Effects</h4>
                  <div className="row">
                    <button className={selected.shadow ? 'active' : ''} onClick={() => patchSelected({ shadow: !selected.shadow })}>Shadow</button>
                    <button
                      className={(selected.outlineWidth ?? 0) > 0 ? 'active' : ''}
                      onClick={() => patchSelected({ outlineWidth: (selected.outlineWidth ?? 0) > 0 ? 0 : Math.max(2, Math.round(selected.fontSize / 25)) })}
                    >
                      Outline
                    </button>
                  </div>
                  {(selected.outlineWidth ?? 0) > 0 && (
                    <>
                      <RangeField label="Outline width" value={selected.outlineWidth ?? 0} min={1} max={30} step={1} onStart={mark} onChange={(v) => patchSelected({ outlineWidth: v }, true)} format={(v) => `${v}px`} />
                      <ColorField label="Outline color" value={selected.outlineColor ?? '#000000'} onStart={mark} onChange={(v) => patchSelected({ outlineColor: v }, true)} swatches={usedColors} />
                    </>
                  )}
                </>
              )}

              {selected.type === 'shape' && (
                <>
                  {selected.shape !== 'line' && (
                    <ColorField label="Fill" value={selected.fill} onStart={mark} onChange={(v) => patchSelected({ fill: v }, true)} swatches={usedColors} />
                  )}
                  <ColorField label="Border" value={selected.stroke} onStart={mark} onChange={(v) => patchSelected({ stroke: v }, true)} swatches={usedColors} />
                  <RangeField label="Border width" value={selected.strokeWidth} min={0} max={60} step={1} onStart={mark} onChange={(v) => patchSelected({ strokeWidth: v }, true)} />
                  {selected.shape === 'rect' && (
                    <RangeField label="Corner radius" value={selected.radius} min={0} max={Math.min(selected.width, selected.height) / 2} step={1} onStart={mark} onChange={(v) => patchSelected({ radius: v }, true)} />
                  )}
                </>
              )}

              {selected.type === 'image' && (
                <>
                  <div className="row">
                    <button className={selected.flipX ? 'active' : ''} onClick={() => patchSelected({ flipX: !selected.flipX })}>⇋ Flip H</button>
                    <button className={selected.flipY ? 'active' : ''} onClick={() => patchSelected({ flipY: !selected.flipY })}>⇵ Flip V</button>
                  </div>
                  <RangeField label="Corner radius" value={selected.radius} min={0} max={Math.min(selected.width, selected.height) / 2} step={1} onStart={mark} onChange={(v) => patchSelected({ radius: v }, true)} />
                  <BackgroundRemover el={selected} onApply={(patch) => patchSelected(patch)} />
                  <CropControls el={selected} mark={mark} setCrop={setCrop} />
                  <h4>Filters</h4>
                  <div className="grid3">
                    {FILTER_PRESETS.map((p) => (
                      <button key={p.label} className={sameFilters(selected.filters, p.filters) ? 'active' : ''} onClick={() => patchSelected({ filters: p.filters })}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <h4>Adjust</h4>
                  <FilterSliders filters={selected.filters ?? NEUTRAL_FILTERS} mark={mark} onChange={patchImageFilters} />
                </>
              )}

              <label className="field">
                <span>Animation</span>
                <select
                  value={selected.animation ?? 'none'}
                  onChange={(e) => {
                    patchSelected({ animation: e.target.value as ElementAnimation });
                    setPreviewStart(performance.now());
                  }}
                >
                  {ANIMATIONS.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </label>
              <RangeField label="Transparency" value={selected.opacity} min={0} max={1} step={0.01} onStart={mark} onChange={(v) => patchSelected({ opacity: v }, true)} />
              <div className="grid2">
                <NumberField label="X" value={Math.round(selected.x)} onChange={(v) => patchSelected({ x: v })} />
                <NumberField label="Y" value={Math.round(selected.y)} onChange={(v) => patchSelected({ y: v })} />
                <NumberField label="W" value={Math.round(selected.width)} min={1} onChange={(v) => patchSelected({ width: v })} />
                <NumberField label="H" value={Math.round(selected.height)} min={0} onChange={(v) => patchSelected({ height: v })} />
              </div>
              <NumberField label="Rotation°" value={selected.rotation} onChange={(v) => patchSelected({ rotation: ((v % 360) + 360) % 360 })} />
              <h4>Align to page</h4>
              <div className="grid3">
                {ALIGN_BUTTONS.map((a) => (
                  <button key={a.mode} onClick={() => align(a.mode)} disabled={selected.locked} title={`Align ${a.label.toLowerCase()}`}>
                    {a.icon} {a.label}
                  </button>
                ))}
              </div>
              <h4>Arrange</h4>
              <div className="row">
                <button onClick={() => layer('top')} title="Bring to front">Front</button>
                <button onClick={() => layer('up')} title="Bring forward">Forward</button>
                <button onClick={() => layer('down')} title="Send backward">Back</button>
                <button onClick={() => layer('bottom')} title="Send to back">Bottom</button>
              </div>
            </>
          ) : (
            <>
              <h3>
                Page {page + 1} <small className="hint">of {file.pages.length}</small>
              </h3>
              <p className="hint">
                {doc.width} × {doc.height}px. Click an element to edit it, or drag across the canvas to select several.
                Drag to move; use the handles to resize or rotate. Hold Alt while dragging to turn off snapping.
              </p>
              <h4>Animate this page</h4>
              <div className="grid3">
                {ANIMATIONS.map((a) => (
                  <button
                    key={a.value}
                    className={doc.elements.length > 0 && doc.elements.every((e) => (e.animation ?? 'none') === a.value) ? 'active' : ''}
                    onClick={() => {
                      set((d) => animateAll(d, a.value));
                      if (a.value !== 'none') setPreviewStart(performance.now());
                    }}
                    disabled={doc.elements.length === 0}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              <button className="block" onClick={() => setPreviewStart(performance.now())} disabled={entranceLength(doc) === 0}>
                ▶ Preview animation
              </button>
              <NumberField
                label="Page length in present mode / video (s)"
                value={pageDuration(file.pages[page])}
                min={1}
                max={60}
                step={0.5}
                onChange={setPageSeconds}
              />
            </>
          )}

          <h4>Layers</h4>
          <ul className="layers">
            {[...doc.elements].reverse().map((el) => (
              <li key={el.id}>
                <button
                  className={selectedIds.includes(el.id) ? 'active' : ''}
                  onClick={(e) =>
                    setSelectedIds((sel) =>
                      e.shiftKey ? (sel.includes(el.id) ? sel.filter((id) => id !== el.id) : [...sel, el.id]) : [el.id],
                    )
                  }
                >
                  <span>{el.type === 'text' ? 'T' : el.type === 'image' ? '🖼' : '◆'}</span>
                  <span className="layer-name">{el.type === 'text' ? el.text.slice(0, 24) || 'Text' : el.name}</span>
                  {el.locked && <span title="Locked">🔒</span>}
                </button>
              </li>
            ))}
            {doc.elements.length === 0 && <li className="hint">Nothing here yet. Add text, shapes or images from the left.</li>}
          </ul>
          </div>
        </aside>
      </div>

      <PageStrip
          file={file}
          current={page}
          images={images}
          imageVersion={imageVersion}
          onSelect={goToPage}
          onAdd={addPage}
          onDuplicate={copyPage}
          onDelete={deletePage}
          onMove={shiftPage}
        />

      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }} onClick={() => setMenu(null)}>
          {selectedEls.length > 0 && (
            <>
              <button onClick={copySelected}>Copy <kbd>Ctrl C</kbd></button>
              <button onClick={duplicateSelected}>Duplicate <kbd>Ctrl D</kbd></button>
              <button onClick={paste} disabled={clipboardRef.current.length === 0}>Paste <kbd>Ctrl V</kbd></button>
              <hr />
              <button onClick={() => layer('top')}>Bring to front</button>
              <button onClick={() => layer('bottom')}>Send to back</button>
              <button onClick={() => align('hcenter')}>{selectedEls.length > 1 ? 'Align centers' : 'Center on page'}</button>
              <button onClick={toggleLock}>{allLocked ? 'Unlock' : 'Lock'}</button>
              <hr />
              <button className="danger" onClick={deleteSelected} disabled={allLocked}>Delete <kbd>Del</kbd></button>
            </>
          )}
          {selectedEls.length === 0 && (
            <>
              <button onClick={paste} disabled={clipboardRef.current.length === 0}>Paste <kbd>Ctrl V</kbd></button>
              <button onClick={() => setSelectedIds(doc.elements.map((e) => e.id))} disabled={doc.elements.length === 0}>
                Select all <kbd>Ctrl A</kbd>
              </button>
              <button onClick={() => setTab('background')}>Change background</button>
            </>
          )}
        </div>
      )}

      {showLook && <LookSettings onClose={() => setShowLook(false)} />}

      {showHelp && <ShortcutsDialog shortcuts={SHORTCUTS} onClose={() => setShowHelp(false)} />}
      {presenting !== null && <Presenter file={file} startPage={presenting} onClose={() => setPresenting(null)} />}
      {videoProgress !== null && (
        <div className="modal-backdrop" data-modal>
          <div className="modal">
            <h3>Making your video…</h3>
            <p className="hint">Each page plays once with its animations while it is recorded. Keep this tab open.</p>
            <div className="progress"><div style={{ width: `${Math.round(videoProgress * 100)}%` }} /></div>
            <p>{Math.round(videoProgress * 100)}%</p>
          </div>
        </div>
      )}
    </div>
  );
}

function visibleHandles(el: DesignElement): Handle[] {
  if (el.type === 'shape' && el.shape === 'line') return ['w', 'e'];
  if (el.type === 'text') return ['nw', 'ne', 'se', 'sw', 'e', 'w'];
  return HANDLES;
}

function roundBox<T extends Partial<DesignElement>>(p: T): T {
  const out = { ...p };
  for (const k of ['x', 'y', 'width', 'height'] as const) {
    if (typeof out[k] === 'number') (out as Record<string, number>)[k] = Math.round(out[k] as number);
  }
  return out;
}

function ShapeIcon({ shape }: { shape: ShapeKind }) {
  const common = { fill: '#7c3aed' };
  return (
    <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden>
      {shape === 'rect' && <rect x="4" y="4" width="32" height="32" {...common} />}
      {shape === 'ellipse' && <circle cx="20" cy="20" r="16" {...common} />}
      {shape === 'triangle' && <polygon points="20,4 36,36 4,36" {...common} />}
      {shape === 'star' && <polygon points="20,3 24.5,15 37,15 27,23 31,36 20,28 9,36 13,23 3,15 15.5,15" {...common} />}
      {shape === 'line' && <line x1="4" y1="20" x2="36" y2="20" stroke="#1f2937" strokeWidth="4" strokeLinecap="round" />}
      {shape === 'heart' && <path d="M20 35 C2 24 4 6 20 12 C36 6 38 24 20 35Z" {...common} />}
      {shape === 'arrow' && <polygon points="4,14 24,14 24,6 37,20 24,34 24,26 4,26" {...common} />}
      {shape === 'bubble' && <path d="M8 5 H32 Q36 5 36 9 V25 Q36 29 32 29 H16 L9 36 L11 29 H8 Q4 29 4 25 V9 Q4 5 8 5Z" {...common} />}
      {shape === 'hexagon' && <polygon points="36,20 28,34 12,34 4,20 12,6 28,6" {...common} />}
      {shape === 'diamond' && <polygon points="20,3 37,20 20,37 3,20" {...common} />}
    </svg>
  );
}

function CropControls({
  el,
  mark,
  setCrop,
}: {
  el: ImageElement;
  mark: () => void;
  setCrop: (crop: Crop | undefined, live?: boolean) => void;
}) {
  const crop: Crop = el.crop ?? { aspect: null, zoom: 1, cx: 0.5, cy: 0.5 };
  const nw = el.naturalWidth ?? 1;
  const nh = el.naturalHeight ?? 1;
  const r = cropRect(nw, nh, crop);
  // Panning only matters when part of the picture is hidden in that direction.
  const canPanX = r.width < nw - 0.5;
  const canPanY = r.height < nh - 0.5;
  return (
    <>
      <h4>Crop</h4>
      <div className="grid3">
        {CROP_ASPECTS.map((a) => (
          <button
            key={a.label}
            className={crop.aspect === a.aspect || (a.aspect !== null && crop.aspect !== null && Math.abs(crop.aspect - a.aspect) < 1e-6) ? 'active' : ''}
            onClick={() => setCrop({ ...crop, aspect: a.aspect })}
          >
            {a.label}
          </button>
        ))}
      </div>
      <RangeField label="Zoom" value={crop.zoom} min={1} max={4} step={0.05} onStart={mark} onChange={(v) => setCrop({ ...crop, zoom: v }, true)} format={(v) => `${v.toFixed(2)}×`} />
      {canPanX && (
        <RangeField label="Move left / right" value={crop.cx} min={0} max={1} step={0.01} onStart={mark} onChange={(v) => setCrop({ ...crop, cx: v }, true)} format={(v) => `${Math.round(v * 100)}%`} />
      )}
      {canPanY && (
        <RangeField label="Move up / down" value={crop.cy} min={0} max={1} step={0.01} onStart={mark} onChange={(v) => setCrop({ ...crop, cy: v }, true)} format={(v) => `${Math.round(v * 100)}%`} />
      )}
      {el.crop && (
        <button className="block" onClick={() => setCrop(undefined)}>
          Reset crop
        </button>
      )}
    </>
  );
}

const pageThumbs = new WeakMap<object, { url: string; version: number }>();

/** Strip of page thumbnails under the canvas, with page actions. */
function PageStrip({
  file,
  current,
  images,
  imageVersion,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete,
  onMove,
}: {
  file: DesignFile;
  current: number;
  images: ImageCache;
  /** Bumps when a photo finishes loading, so thumbnails drawn before that are refreshed. */
  imageVersion: number;
  onSelect: (i: number) => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (delta: number) => void;
}) {
  // Thumbnails are cached per page object, so only edited pages are redrawn.
  const thumb = (i: number) => {
    const p = file.pages[i];
    const cached = pageThumbs.get(p);
    if (cached && cached.version === imageVersion) return cached.url;
    const url = designThumbnail(pageView(file, i), 120, images);
    pageThumbs.set(p, { url, version: imageVersion });
    return url;
  };
  return (
    <div className="page-strip" aria-label="Pages">
      <div className="track-head page-head">
        <Icon name="layers" size={14} />
        <span>Pages</span>
      </div>
      <div className="page-list">
        {file.pages.map((p, i) => (
          <button
            key={p.id}
            className={`page-thumb ${i === current ? 'active' : ''}`}
            onClick={() => onSelect(i)}
            title={`Page ${i + 1}`}
          >
            <img src={thumb(i)} alt="" />
            <span>{i + 1}</span>
          </button>
        ))}
        <button className="page-add" onClick={onAdd} title="Add a blank page after this one">
          + Page
        </button>
      </div>
      <div className="page-actions">
        <button onClick={() => onMove(-1)} disabled={current === 0} title="Move page left">◀</button>
        <button onClick={() => onMove(1)} disabled={current === file.pages.length - 1} title="Move page right">▶</button>
        <button onClick={onDuplicate} title="Duplicate page">Duplicate</button>
        <button className="danger" onClick={onDelete} disabled={file.pages.length <= 1} title="Delete page">Delete</button>
      </div>
    </div>
  );
}

/** Remove a plain background from a photo, with a strength slider and a way back. */
function BackgroundRemover({ el, onApply }: { el: ImageElement; onApply: (patch: Partial<ImageElement>) => void }) {
  const [tolerance, setTolerance] = useState(18);
  const [working, setWorking] = useState(false);
  const run = async () => {
    setWorking(true);
    try {
      const original = el.originalSrc ?? el.src;
      const out = await removeBackgroundFromImage(original, tolerance);
      if (out.removed === 0) {
        alert('No plain background found at the edges. Try a higher strength.');
        return;
      }
      onApply({ src: out.src, originalSrc: original, naturalWidth: out.width, naturalHeight: out.height });
    } catch {
      alert('Could not process this photo.');
    } finally {
      setWorking(false);
    }
  };
  return (
    <>
      <h4>Background</h4>
      <RangeField label="Strength" value={tolerance} min={2} max={60} step={1} onChange={setTolerance} format={(v) => `${v}%`} />
      <div className="row">
        <button className="primary" onClick={run} disabled={working}>
          {working ? 'Working…' : el.originalSrc ? 'Redo removal' : '✂ Remove background'}
        </button>
        {el.originalSrc && <button onClick={() => onApply({ src: el.originalSrc, originalSrc: undefined })}>Restore</button>}
      </div>
      <p className="hint">Works best on photos with a plain, even background (white, green screen, studio wall).</p>
    </>
  );
}
