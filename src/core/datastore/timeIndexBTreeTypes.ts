import { ValidationError } from '../errors/index.js';
import type { PersistedTimeseriesRecord } from '../types.js';

export const DEFAULT_MAX_LEAF_ENTRIES = 64;
export const DEFAULT_MAX_BRANCH_CHILDREN = 64;
const MIN_NODE_CAPACITY = 3;

export interface IndexKey {
  timestamp: number;
  insertionOrder: bigint;
}

export interface LeafEntry {
  key: IndexKey;
  record: PersistedTimeseriesRecord;
}

export interface LeafNode {
  kind: 'leaf';
  entries: LeafEntry[];
  parent: BranchNode | null;
  prev: LeafNode | null;
  next: LeafNode | null;
}

export interface BranchNode {
  kind: 'branch';
  children: BTreeNode[];
  parent: BranchNode | null;
}

export type BTreeNode = LeafNode | BranchNode;

export interface TimeIndexTreeState {
  maxLeafEntries: number;
  maxBranchChildren: number;
  root: BTreeNode;
  leftmostLeaf: LeafNode;
  rightmostLeaf: LeafNode;
  entryCount: number;
}

export interface TimeIndexBTreeConfig {
  maxLeafEntries?: number;
  maxBranchChildren?: number;
}

export interface TimeIndexBTreeStats {
  height: number;
  leafCount: number;
  branchCount: number;
  entryCount: number;
}

export const isLeafNode = (node: BTreeNode): node is LeafNode => {
  return node.kind === 'leaf';
};

export const compareIndexKeys = (left: IndexKey, right: IndexKey): number => {
  if (left.timestamp !== right.timestamp) {
    return left.timestamp - right.timestamp;
  }

  if (left.insertionOrder === right.insertionOrder) {
    return 0;
  }

  return left.insertionOrder < right.insertionOrder ? -1 : 1;
};

export const normalizeNodeCapacity = (
  value: number | undefined,
  field: string,
  defaultValue: number,
): number => {
  if (value === undefined) {
    return defaultValue;
  }

  if (!Number.isInteger(value) || value < MIN_NODE_CAPACITY) {
    throw new ValidationError(
      `${field} must be an integer >= ${MIN_NODE_CAPACITY}.`,
    );
  }

  return value;
};

export const createKeyFromRecord = (
  record: PersistedTimeseriesRecord,
): IndexKey => {
  return {
    timestamp: record.timestamp,
    insertionOrder: record.insertionOrder,
  };
};

export const createLeafNode = (
  entries: LeafEntry[],
  parent: BranchNode | null,
): LeafNode => {
  return {
    kind: 'leaf',
    entries,
    parent,
    prev: null,
    next: null,
  };
};

export const createBranchNode = (
  children: BTreeNode[],
  parent: BranchNode | null,
): BranchNode => {
  const branch: BranchNode = {
    kind: 'branch',
    children,
    parent,
  };

  for (const child of children) {
    child.parent = branch;
  }

  return branch;
};

export const getMinLeafEntries = (state: TimeIndexTreeState): number => {
  return Math.ceil(state.maxLeafEntries / 2);
};

export const getMinBranchChildren = (state: TimeIndexTreeState): number => {
  return Math.ceil(state.maxBranchChildren / 2);
};
