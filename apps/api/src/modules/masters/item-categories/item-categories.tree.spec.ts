import { describe, expect, it } from 'vitest';
import { buildCategoryTree, fitsDepth } from './item-categories.tree.js';

const node = (id: string, parentId: string | null, name: string, isActive = true) => ({
  id,
  parentId,
  name,
  isActive,
});

describe('buildCategoryTree', () => {
  it('nests children under parents and sorts every level by name', () => {
    const tree = buildCategoryTree([
      node('s', null, 'Steel'),
      node('b', 's', 'TMT bars'),
      node('a', null, 'aluminium'),
      node('f', 'b', 'Fe 500'),
      node('c', 's', 'Coils'),
    ]);
    expect(tree).toEqual([
      { id: 'a', parentId: null, name: 'aluminium', isActive: true, children: [] },
      {
        id: 's',
        parentId: null,
        name: 'Steel',
        isActive: true,
        children: [
          { id: 'c', parentId: 's', name: 'Coils', isActive: true, children: [] },
          {
            id: 'b',
            parentId: 's',
            name: 'TMT bars',
            isActive: true,
            children: [{ id: 'f', parentId: 'b', name: 'Fe 500', isActive: true, children: [] }],
          },
        ],
      },
    ]);
  });

  it('leaves out a node whose parent was filtered out, with its subtree', () => {
    const tree = buildCategoryTree([node('b', 's', 'TMT bars'), node('f', 'b', 'Fe 500')]);
    expect(tree).toEqual([]);
  });
});

describe('fitsDepth', () => {
  it('allows at most three levels', () => {
    expect(fitsDepth(0, 3)).toBe(true);
    expect(fitsDepth(2, 1)).toBe(true);
    expect(fitsDepth(3, 1)).toBe(false);
    expect(fitsDepth(1, 3)).toBe(false);
  });
});
