import { uid } from '../lib/id';
import { resizeDoc } from './model';
import type { DesignDoc, DesignFile, DesignPage } from './types';

export const DEFAULT_PAGE_SECONDS = 4;

export function blankPage(background = '#ffffff'): DesignPage {
  return { id: uid('page'), background, gradient: null, elements: [] };
}

/** Wrap a single-page design (the older saved format) as a file. */
export function toFile(doc: DesignDoc): DesignFile {
  return {
    name: doc.name,
    width: doc.width,
    height: doc.height,
    pages: [{ id: uid('page'), background: doc.background, gradient: doc.gradient ?? null, elements: doc.elements }],
  };
}

export function isDesignFile(value: unknown): value is DesignFile {
  const v = value as DesignFile;
  return !!v && typeof v.width === 'number' && typeof v.height === 'number' && Array.isArray(v.pages) && v.pages.length > 0;
}

/** Accept either format (file, or older single-page doc) and return a file. */
export function normalizeFile(value: DesignFile | DesignDoc): DesignFile {
  return isDesignFile(value) ? value : toFile(value as DesignDoc);
}

/** One page of a file, shaped as a stand-alone design. */
export function pageView(file: DesignFile, index: number): DesignDoc {
  const page = file.pages[Math.max(0, Math.min(index, file.pages.length - 1))];
  return {
    name: file.name,
    width: file.width,
    height: file.height,
    background: page.background,
    gradient: page.gradient ?? null,
    elements: page.elements,
  };
}

/**
 * Write an edited page view back into the file. If the size changed (magic
 * resize), every other page is resized the same way so all pages match.
 */
export function withPage(file: DesignFile, index: number, view: DesignDoc): DesignFile {
  const resized = view.width !== file.width || view.height !== file.height;
  return {
    name: view.name,
    width: view.width,
    height: view.height,
    pages: file.pages.map((p, i) => {
      if (i === index) return { ...p, background: view.background, gradient: view.gradient ?? null, elements: view.elements };
      if (!resized) return p;
      const r = resizeDoc({ ...pageView(file, i) }, view.width, view.height);
      return { ...p, elements: r.elements };
    }),
  };
}

export function insertPage(file: DesignFile, at: number, page: DesignPage = blankPage(file.pages[0]?.background)): DesignFile {
  const pages = [...file.pages];
  pages.splice(Math.max(0, Math.min(at, pages.length)), 0, page);
  return { ...file, pages };
}

/** Copy a page (with new element ids) right after it. */
export function duplicatePage(file: DesignFile, index: number): DesignFile {
  const src = file.pages[index];
  if (!src) return file;
  const copy: DesignPage = { ...src, id: uid('page'), elements: src.elements.map((e) => ({ ...e, id: uid(e.type) })) };
  return insertPage(file, index + 1, copy);
}

export function removePage(file: DesignFile, index: number): DesignFile {
  if (file.pages.length <= 1) return file;
  return { ...file, pages: file.pages.filter((_, i) => i !== index) };
}

export function movePage(file: DesignFile, from: number, to: number): DesignFile {
  if (to < 0 || to >= file.pages.length || from === to) return file;
  const pages = [...file.pages];
  const [p] = pages.splice(from, 1);
  pages.splice(to, 0, p);
  return { ...file, pages };
}

export function pageDuration(page: DesignPage): number {
  return page.duration ?? DEFAULT_PAGE_SECONDS;
}
