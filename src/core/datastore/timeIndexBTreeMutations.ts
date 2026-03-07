import { IndexCorruptionError } from '../errors/index.js';
import type { PersistedTimeseriesRecord } from '../types.js';
import {
  createBranchNode,
  createKeyFromRecord,
  createLeafNode,
  getMinBranchChildren,
  getMinLeafEntries,
  isLeafNode,
  type BTreeNode,
  type BranchNode,
  type LeafNode,
  type TimeIndexTreeState,
} from './timeIndexBTreeTypes.js';
import { findLeafForKey, lowerBoundInLeaf } from './timeIndexBTreeNavigation.js';

const insertChildAfter = (
  state: TimeIndexTreeState,
  parent: BranchNode,
  existingChild: BTreeNode,
  childToInsert: BTreeNode,
): void => {
  const insertAfter = parent.children.indexOf(existingChild);
  if (insertAfter < 0) {
    throw new IndexCorruptionError(
      'Parent branch does not contain expected existing child.',
    );
  }

  parent.children.splice(insertAfter + 1, 0, childToInsert);
  childToInsert.parent = parent;

  if (parent.children.length > state.maxBranchChildren) {
    splitBranch(state, parent);
  }
};

const splitLeaf = (state: TimeIndexTreeState, leaf: LeafNode): void => {
  const splitAt = Math.ceil(leaf.entries.length / 2);
  const siblingEntries = leaf.entries.splice(splitAt);
  const sibling = createLeafNode(siblingEntries, leaf.parent);

  sibling.prev = leaf;
  sibling.next = leaf.next;
  if (leaf.next !== null) {
    leaf.next.prev = sibling;
  } else {
    state.rightmostLeaf = sibling;
  }
  leaf.next = sibling;

  if (leaf.parent === null) {
    state.root = createBranchNode([leaf, sibling], null);
    return;
  }

  insertChildAfter(state, leaf.parent, leaf, sibling);
};

const splitBranch = (state: TimeIndexTreeState, branch: BranchNode): void => {
  const splitAt = Math.ceil(branch.children.length / 2);
  const siblingChildren = branch.children.splice(splitAt);
  const sibling = createBranchNode(siblingChildren, branch.parent);

  if (branch.parent === null) {
    state.root = createBranchNode([branch, sibling], null);
    return;
  }

  insertChildAfter(state, branch.parent, branch, sibling);
};

const requireLeafNode = (node: BTreeNode): LeafNode => {
  if (!isLeafNode(node)) {
    throw new IndexCorruptionError('Expected leaf node but found branch node.');
  }

  return node;
};

const requireBranchNode = (node: BTreeNode): BranchNode => {
  if (isLeafNode(node)) {
    throw new IndexCorruptionError('Expected branch node but found leaf node.');
  }

  return node;
};

const removeChildFromBranch = (branch: BranchNode, childIndex: number): void => {
  if (childIndex < 0 || childIndex >= branch.children.length) {
    throw new IndexCorruptionError('removeChildFromBranch index is out of range.');
  }

  branch.children.splice(childIndex, 1);
};

const detachLeafFromChain = (state: TimeIndexTreeState, leaf: LeafNode): void => {
  if (leaf.prev !== null) {
    leaf.prev.next = leaf.next;
  } else if (leaf.next !== null) {
    state.leftmostLeaf = leaf.next;
  }

  if (leaf.next !== null) {
    leaf.next.prev = leaf.prev;
  } else if (leaf.prev !== null) {
    state.rightmostLeaf = leaf.prev;
  }

  leaf.prev = null;
  leaf.next = null;
};

const rebalanceAfterBranchRemoval = (
  state: TimeIndexTreeState,
  branch: BranchNode,
): void => {
  if (branch === state.root) {
    if (branch.children.length === 1) {
      const onlyChild = branch.children[0];
      onlyChild.parent = null;
      state.root = onlyChild;
      if (isLeafNode(onlyChild)) {
        state.leftmostLeaf = onlyChild;
        state.rightmostLeaf = onlyChild;
      }
    }
    return;
  }

  if (branch.children.length >= getMinBranchChildren(state)) {
    return;
  }

  const parent = branch.parent;
  if (parent === null) {
    throw new IndexCorruptionError('Branch node has no parent during rebalance.');
  }

  const branchIndex = parent.children.indexOf(branch);
  const leftSibling =
    branchIndex > 0 ? requireBranchNode(parent.children[branchIndex - 1]) : null;
  const rightSibling =
    branchIndex + 1 < parent.children.length
      ? requireBranchNode(parent.children[branchIndex + 1])
      : null;

  if (leftSibling !== null && leftSibling.children.length > getMinBranchChildren(state)) {
    const borrowedChild = leftSibling.children.pop();
    if (borrowedChild === undefined) {
      throw new IndexCorruptionError('Failed to borrow child from left branch sibling.');
    }
    branch.children.unshift(borrowedChild);
    borrowedChild.parent = branch;
    return;
  }

  if (rightSibling !== null && rightSibling.children.length > getMinBranchChildren(state)) {
    const borrowedChild = rightSibling.children.shift();
    if (borrowedChild === undefined) {
      throw new IndexCorruptionError('Failed to borrow child from right branch sibling.');
    }
    branch.children.push(borrowedChild);
    borrowedChild.parent = branch;
    return;
  }

  if (leftSibling !== null) {
    for (const child of branch.children) {
      leftSibling.children.push(child);
      child.parent = leftSibling;
    }
    removeChildFromBranch(parent, branchIndex);
    rebalanceAfterBranchRemoval(state, parent);
    return;
  }

  if (rightSibling !== null) {
    for (const child of rightSibling.children) {
      branch.children.push(child);
      child.parent = branch;
    }
    removeChildFromBranch(parent, branchIndex + 1);
    rebalanceAfterBranchRemoval(state, parent);
    return;
  }

  throw new IndexCorruptionError('Cannot rebalance branch node without siblings.');
};

const rebalanceAfterLeafRemoval = (state: TimeIndexTreeState, leaf: LeafNode): void => {
  if (leaf === state.root) {
    if (state.entryCount === 0) {
      state.leftmostLeaf = leaf;
      state.rightmostLeaf = leaf;
    }
    return;
  }

  if (leaf.entries.length >= getMinLeafEntries(state)) {
    return;
  }

  const parent = leaf.parent;
  if (parent === null) {
    throw new IndexCorruptionError('Leaf node has no parent during rebalance.');
  }

  const leafIndex = parent.children.indexOf(leaf);
  const leftSibling =
    leafIndex > 0 ? requireLeafNode(parent.children[leafIndex - 1]) : null;
  const rightSibling =
    leafIndex + 1 < parent.children.length
      ? requireLeafNode(parent.children[leafIndex + 1])
      : null;

  if (leftSibling !== null && leftSibling.entries.length > getMinLeafEntries(state)) {
    const borrowed = leftSibling.entries.pop();
    if (borrowed === undefined) {
      throw new IndexCorruptionError('Failed to borrow entry from left sibling leaf.');
    }
    leaf.entries.unshift(borrowed);
    return;
  }

  if (rightSibling !== null && rightSibling.entries.length > getMinLeafEntries(state)) {
    const borrowed = rightSibling.entries.shift();
    if (borrowed === undefined) {
      throw new IndexCorruptionError('Failed to borrow entry from right sibling leaf.');
    }
    leaf.entries.push(borrowed);
    return;
  }

  if (leftSibling !== null) {
    leftSibling.entries.push(...leaf.entries);
    detachLeafFromChain(state, leaf);
    removeChildFromBranch(parent, leafIndex);
    rebalanceAfterBranchRemoval(state, parent);
    return;
  }

  if (rightSibling !== null) {
    leaf.entries.push(...rightSibling.entries);
    detachLeafFromChain(state, rightSibling);
    removeChildFromBranch(parent, leafIndex + 1);
    rebalanceAfterBranchRemoval(state, parent);
    return;
  }

  throw new IndexCorruptionError('Cannot rebalance leaf node without siblings.');
};

export const insertRecord = (
  state: TimeIndexTreeState,
  record: PersistedTimeseriesRecord,
): void => {
  const key = createKeyFromRecord(record);
  const targetLeaf = findLeafForKey(state, key);
  const insertAt = lowerBoundInLeaf(targetLeaf.entries, key);
  targetLeaf.entries.splice(insertAt, 0, {
    key,
    record,
  });
  state.entryCount += 1;

  if (targetLeaf.entries.length > state.maxLeafEntries) {
    splitLeaf(state, targetLeaf);
  }
};

export const popOldestRecord = (
  state: TimeIndexTreeState,
): PersistedTimeseriesRecord | null => {
  if (state.entryCount === 0) {
    return null;
  }

  const oldestEntry = state.leftmostLeaf.entries.shift();
  if (oldestEntry === undefined) {
    throw new IndexCorruptionError(
      'Index leftmost leaf is empty while entryCount is non-zero.',
    );
  }

  state.entryCount -= 1;
  rebalanceAfterLeafRemoval(state, state.leftmostLeaf);
  return oldestEntry.record;
};
