import { ITEM_CATEGORY_MAX_DEPTH, type ItemCategoryTreeNode } from '@ekaro/contracts';

export interface CategoryNodeInput {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly isActive: boolean;
}

/**
 * Builds the category forest for `GET /item-categories?tree=true`: roots and children sorted by
 * name. A node whose parent is not in `rows` (filtered out, for example inactive) is left out
 * together with its subtree, so a filtered tree never shows a child without its parent.
 */
export function buildCategoryTree(rows: readonly CategoryNodeInput[]): ItemCategoryTreeNode[] {
  const nodes = new Map<string, ItemCategoryTreeNode>();
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      isActive: row.isActive,
      children: [],
    });
  }
  const roots: ItemCategoryTreeNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentId === null) roots.push(node);
    else nodes.get(node.parentId)?.children.push(node);
  }
  const byName = (x: ItemCategoryTreeNode, y: ItemCategoryTreeNode): number =>
    x.name.localeCompare(y.name, 'en', { sensitivity: 'base' });
  const sort = (list: ItemCategoryTreeNode[]): ItemCategoryTreeNode[] => {
    list.sort(byName);
    for (const node of list) sort(node.children);
    return list;
  };
  return sort(roots);
}

/**
 * Whether a category whose subtree is `subtreeHeight` levels tall (1 for a leaf) may sit under a
 * parent at `parentDepth` (0 for the root level): the deepest node must stay within 3 levels.
 */
export function fitsDepth(parentDepth: number, subtreeHeight: number): boolean {
  return parentDepth + subtreeHeight <= ITEM_CATEGORY_MAX_DEPTH;
}
