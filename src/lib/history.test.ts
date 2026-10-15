import { describe, expect, it } from 'vitest';
import { checkpoint, commit, createHistory, redo, replace, undo } from './history';

describe('history', () => {
  it('undoes and redoes committed steps', () => {
    let h = createHistory(1);
    h = commit(h, 2);
    h = commit(h, 3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(1);
    h = redo(h);
    expect(h.present).toBe(2);
  });

  it('clears redo stack on new commit', () => {
    let h = commit(createHistory('a'), 'b');
    h = undo(h);
    h = commit(h, 'c');
    expect(h.future).toEqual([]);
    expect(redo(h).present).toBe('c');
  });

  it('groups transient changes after a checkpoint into one undo step', () => {
    let h = checkpoint(createHistory(0));
    h = replace(h, 5);
    h = replace(h, 10);
    expect(h.present).toBe(10);
    expect(undo(h).present).toBe(0);
  });

  it('caps the history length', () => {
    let h = createHistory(0);
    for (let i = 1; i <= 10; i++) h = commit(h, i, 3);
    expect(h.past).toEqual([7, 8, 9]);
  });
});
