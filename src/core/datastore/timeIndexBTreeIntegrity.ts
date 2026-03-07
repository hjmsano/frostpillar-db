import { IndexCorruptionError } from '../errors/index.js';
import {
  compareIndexKeys,
  getMinBranchChildren,
  getMinLeafEntries,
  isLeafNode,
  type IndexKey,
  type TimeIndexBTreeStats,
  type TimeIndexTreeState,
} from './timeIndexBTreeTypes.js';
import { getNodeMaxKey, getNodeMinKey } from './timeIndexBTreeNavigation.js';

interface NodeValidationResult {
  minKey: IndexKey | null;
  maxKey: IndexKey | null;
  leafDepth: number | null;
  leafCount: number;
  branchCount: number;
  entryCount: number;
}

interface NodeStats {
  height: number;
  leafCount: number;
  branchCount: number;
}

const validateLeafNodeOrdering = (state: TimeIndexTreeState, node: Node): void => {
  if (!isLeafNode(node)) {
    throw new IndexCorruptionError('Expected leaf node during ordering validation.');
  }

  for (let index = 1; index < node.entries.length; index += 1) {
    if (compareIndexKeys(node.entries[index - 1].key, node.entries[index].key) >= 0) {
      throw new IndexCorruptionError('Leaf entries are not strictly ordered.');
    }
  }

  if (node.entries.length > state.maxLeafEntries) {
    throw new IndexCorruptionError('Leaf node exceeds maximum occupancy.');
  }
};

const validateNode = (
  state: TimeIndexTreeState,
  node: Node,
  depth: number,
): NodeValidationResult => {
  if (isLeafNode(node)) {
    validateLeafNodeOrdering(state, node);

    if (node !== state.root && node.entries.length < getMinLeafEntries(state)) {
      throw new IndexCorruptionError('Non-root leaf node violates minimum occupancy.');
    }

    const minKey = node.entries.length === 0 ? null : node.entries[0].key;
    const maxKey = node.entries.length === 0 ? null : node.entries[node.entries.length - 1].key;
    return {
      minKey,
      maxKey,
      leafDepth: node.entries.length === 0 ? null : depth,
      leafCount: 1,
      branchCount: 0,
      entryCount: node.entries.length,
    };
  }

  if (node.children.length === 0) {
    throw new IndexCorruptionError('Branch node has zero children.');
  }

  if (node !== state.root && node.children.length < getMinBranchChildren(state)) {
    throw new IndexCorruptionError('Non-root branch node violates minimum occupancy.');
  }
  if (node.children.length > state.maxBranchChildren) {
    throw new IndexCorruptionError('Branch node exceeds maximum occupancy.');
  }

  let leafDepth: number | null = null;
  let leafCount = 0;
  let branchCount = 1;
  let entryCount = 0;
  let minKey: IndexKey | null = null;
  let maxKey: IndexKey | null = null;
  let previousChildMax: IndexKey | null = null;

  for (const child of node.children) {
    if (child.parent !== node) {
      throw new IndexCorruptionError('Child-parent pointer mismatch in branch node.');
    }

    const childValidation = validateNode(state, child, depth + 1);
    if (childValidation.minKey === null || childValidation.maxKey === null) {
      throw new IndexCorruptionError(
        'Branch child must not be empty in non-root branch tree.',
      );
    }

    if (
      leafDepth !== null &&
      childValidation.leafDepth !== null &&
      childValidation.leafDepth !== leafDepth
    ) {
      throw new IndexCorruptionError('Leaf depth mismatch detected in tree.');
    }
    if (leafDepth === null && childValidation.leafDepth !== null) {
      leafDepth = childValidation.leafDepth;
    }

    if (
      previousChildMax !== null &&
      compareIndexKeys(previousChildMax, childValidation.minKey) >= 0
    ) {
      throw new IndexCorruptionError('Branch child key ranges are not strictly ordered.');
    }

    if (minKey === null) {
      minKey = childValidation.minKey;
    }
    maxKey = childValidation.maxKey;
    previousChildMax = childValidation.maxKey;

    leafCount += childValidation.leafCount;
    branchCount += childValidation.branchCount;
    entryCount += childValidation.entryCount;
  }

  return {
    minKey,
    maxKey,
    leafDepth,
    leafCount,
    branchCount,
    entryCount,
  };
};

const validateLeafLinks = (
  state: TimeIndexTreeState,
  expectedLeafCount: number,
): void => {
  if (state.entryCount === 0) {
    if (!isLeafNode(state.root)) {
      throw new IndexCorruptionError('Empty tree root must be a leaf node.');
    }
    if (state.leftmostLeaf !== state.root || state.rightmostLeaf !== state.root) {
      throw new IndexCorruptionError('Empty tree leaf pointers must reference root leaf.');
    }
    return;
  }

  if (state.leftmostLeaf.prev !== null) {
    throw new IndexCorruptionError('Leftmost leaf prev pointer must be null.');
  }
  if (state.rightmostLeaf.next !== null) {
    throw new IndexCorruptionError('Rightmost leaf next pointer must be null.');
  }

  const visited = new Set<Node>();
  let cursor: Node | null = state.leftmostLeaf;
  let previous: Node | null = null;
  let leafCount = 0;

  while (cursor !== null) {
    if (!isLeafNode(cursor)) {
      throw new IndexCorruptionError('Leaf linkage cursor reached non-leaf node.');
    }

    if (visited.has(cursor)) {
      throw new IndexCorruptionError('Cycle detected in leaf linkage.');
    }
    visited.add(cursor);

    if (cursor.prev !== previous) {
      throw new IndexCorruptionError('Leaf prev pointer mismatch.');
    }

    if (previous !== null && isLeafNode(previous)) {
      const prevMax = getNodeMaxKey(previous);
      const currentMin = getNodeMinKey(cursor);
      if (prevMax === null || currentMin === null) {
        throw new IndexCorruptionError('Non-empty tree leaf chain contains empty leaf node.');
      }
      if (compareIndexKeys(prevMax, currentMin) > 0) {
        throw new IndexCorruptionError('Adjacent leaf key ranges are out of order.');
      }
    }

    previous = cursor;
    cursor = cursor.next;
    leafCount += 1;
  }

  if (previous !== state.rightmostLeaf) {
    throw new IndexCorruptionError('Rightmost leaf pointer mismatch.');
  }
  if (leafCount !== expectedLeafCount) {
    throw new IndexCorruptionError('Leaf chain count mismatch with tree traversal count.');
  }
};

const collectStats = (node: Node): NodeStats => {
  if (isLeafNode(node)) {
    return {
      height: 1,
      leafCount: 1,
      branchCount: 0,
    };
  }

  let maxChildHeight = 0;
  let leafCount = 0;
  let branchCount = 1;

  for (const child of node.children) {
    const childStats = collectStats(child);
    if (childStats.height > maxChildHeight) {
      maxChildHeight = childStats.height;
    }
    leafCount += childStats.leafCount;
    branchCount += childStats.branchCount;
  }

  return {
    height: maxChildHeight + 1,
    leafCount,
    branchCount,
  };
};

type Node = TimeIndexTreeState['root'];

export const assertTimeIndexInvariants = (state: TimeIndexTreeState): void => {
  const validation = validateNode(state, state.root, 0);
  if (validation.entryCount !== state.entryCount) {
    throw new IndexCorruptionError(
      'Index entry count mismatch between tree traversal and tracked state.',
    );
  }

  validateLeafLinks(state, validation.leafCount);
};

export const getTimeIndexStats = (
  state: TimeIndexTreeState,
): TimeIndexBTreeStats => {
  const stats = collectStats(state.root);
  return {
    height: stats.height,
    leafCount: stats.leafCount,
    branchCount: stats.branchCount,
    entryCount: state.entryCount,
  };
};
