import { IndexCorruptionError } from '../errors/index.js';
import type { PersistedTimeseriesRecord } from '../types.js';
import {
  compareIndexKeys,
  isLeafNode,
  type BTreeNode,
  type BranchNode,
  type IndexKey,
  type LeafEntry,
  type LeafNode,
  type TimeIndexTreeState,
} from './timeIndexBTreeTypes.js';

export const getNodeMinKey = (node: BTreeNode): IndexKey | null => {
  if (isLeafNode(node)) {
    return node.entries.length === 0 ? null : node.entries[0].key;
  }

  if (node.children.length === 0) {
    return null;
  }

  return getNodeMinKey(node.children[0]);
};

export const getNodeMaxKey = (node: BTreeNode): IndexKey | null => {
  if (isLeafNode(node)) {
    return node.entries.length === 0 ? null : node.entries[node.entries.length - 1].key;
  }

  if (node.children.length === 0) {
    return null;
  }

  return getNodeMaxKey(node.children[node.children.length - 1]);
};

const selectBranchChild = (branch: BranchNode, key: IndexKey): BTreeNode => {
  if (branch.children.length === 0) {
    throw new IndexCorruptionError('Branch node has no children.');
  }

  let selectedIndex = 0;
  let lower = 0;
  let upper = branch.children.length - 1;

  while (lower <= upper) {
    const mid = Math.floor((lower + upper) / 2);
    const midMin = getNodeMinKey(branch.children[mid]);
    if (midMin === null) {
      throw new IndexCorruptionError('Branch child has no minimum key.');
    }

    const compared = compareIndexKeys(midMin, key);
    if (compared <= 0) {
      selectedIndex = mid;
      lower = mid + 1;
    } else {
      upper = mid - 1;
    }
  }

  return branch.children[selectedIndex];
};

export const findLeafForKey = (
  state: TimeIndexTreeState,
  key: IndexKey,
): LeafNode => {
  let cursor: BTreeNode = state.root;
  while (!isLeafNode(cursor)) {
    cursor = selectBranchChild(cursor, key);
  }

  return cursor;
};

export const lowerBoundInLeaf = (entries: LeafEntry[], key: IndexKey): number => {
  let lower = 0;
  let upper = entries.length;

  while (lower < upper) {
    const mid = Math.floor((lower + upper) / 2);
    if (compareIndexKeys(entries[mid].key, key) < 0) {
      lower = mid + 1;
    } else {
      upper = mid;
    }
  }

  return lower;
};

export const rangeQueryRecords = (
  state: TimeIndexTreeState,
  startTimestamp: number,
  endTimestamp: number,
): PersistedTimeseriesRecord[] => {
  if (state.entryCount === 0 || startTimestamp > endTimestamp) {
    return [];
  }

  const output: PersistedTimeseriesRecord[] = [];
  const startKey: IndexKey = {
    timestamp: startTimestamp,
    insertionOrder: 0n,
  };

  let cursorLeaf: LeafNode | null = findLeafForKey(state, startKey);
  let cursorIndex = lowerBoundInLeaf(cursorLeaf.entries, startKey);

  while (cursorLeaf !== null) {
    for (
      let entryIndex = cursorIndex;
      entryIndex < cursorLeaf.entries.length;
      entryIndex += 1
    ) {
      const entry = cursorLeaf.entries[entryIndex];
      if (entry.key.timestamp > endTimestamp) {
        return output;
      }
      if (entry.key.timestamp >= startTimestamp) {
        output.push(entry.record);
      }
    }

    cursorLeaf = cursorLeaf.next;
    cursorIndex = 0;
  }

  return output;
};
