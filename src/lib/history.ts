import { useCallback, useRef, useState } from 'react';

/** Undo/redo stack. `present` is the live state. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 100;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Record a new state as an undoable step. */
export function commit<T>(h: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, present: next, future: [] };
}

/** Replace the present without creating an undo step (e.g. while dragging). */
export function replace<T>(h: History<T>, next: T): History<T> {
  return next === h.present ? h : { ...h, present: next };
}

/** Save the present as an undo step so later `replace` calls can be undone in one go. */
export function checkpoint<T>(h: History<T>, limit = HISTORY_LIMIT): History<T> {
  const past = [...h.past, h.present];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, present: h.present, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const previous = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: next, future: rest };
}

type Updater<T> = T | ((prev: T) => T);
const apply = <T,>(u: Updater<T>, prev: T): T =>
  typeof u === 'function' ? (u as (p: T) => T)(prev) : u;

/** React hook wrapping the history helpers. */
export function useHistory<T>(initial: T | (() => T)) {
  const [history, setHistory] = useState<History<T>>(() =>
    createHistory(typeof initial === 'function' ? (initial as () => T)() : initial),
  );

  // `mark` arms a checkpoint that is only taken when the next transient change happens,
  // so a click or focus with no actual edit does not leave an empty undo step.
  const pending = useRef(false);

  const set = useCallback((u: Updater<T>) => {
    pending.current = false;
    setHistory((h) => commit(h, apply(u, h.present)));
  }, []);
  const setTransient = useCallback((u: Updater<T>) => {
    const takeCheckpoint = pending.current;
    pending.current = false;
    setHistory((h) => {
      const base = takeCheckpoint ? checkpoint(h) : h;
      return replace(base, apply(u, base.present));
    });
  }, []);
  const mark = useCallback(() => {
    pending.current = true;
  }, []);
  const doUndo = useCallback(() => {
    pending.current = false;
    setHistory((h) => undo(h));
  }, []);
  const doRedo = useCallback(() => {
    pending.current = false;
    setHistory((h) => redo(h));
  }, []);
  const reset = useCallback((value: T) => {
    pending.current = false;
    setHistory(createHistory(value));
  }, []);

  return {
    state: history.present,
    /** Change state and record an undo step. */
    set,
    /** Change state without its own undo step; the first change after `mark` starts a new step. */
    setTransient,
    mark,
    undo: doUndo,
    redo: doRedo,
    reset,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
