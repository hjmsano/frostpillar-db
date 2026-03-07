import type { PersistedTimeseriesRecord } from '../types.js';
import { assertTimeIndexInvariants, getTimeIndexStats } from './timeIndexBTreeIntegrity.js';
import { insertRecord, popOldestRecord } from './timeIndexBTreeMutations.js';
import { rangeQueryRecords } from './timeIndexBTreeNavigation.js';
import {
  DEFAULT_MAX_BRANCH_CHILDREN,
  DEFAULT_MAX_LEAF_ENTRIES,
  createLeafNode,
  normalizeNodeCapacity,
  type TimeIndexBTreeConfig,
  type TimeIndexBTreeStats,
  type TimeIndexTreeState,
} from './timeIndexBTreeTypes.js';

export type { TimeIndexBTreeConfig, TimeIndexBTreeStats };

export class TimeIndexBTree {
  private readonly state: TimeIndexTreeState;

  constructor(config?: TimeIndexBTreeConfig) {
    const maxLeafEntries = normalizeNodeCapacity(
      config?.maxLeafEntries,
      'maxLeafEntries',
      DEFAULT_MAX_LEAF_ENTRIES,
    );
    const maxBranchChildren = normalizeNodeCapacity(
      config?.maxBranchChildren,
      'maxBranchChildren',
      DEFAULT_MAX_BRANCH_CHILDREN,
    );

    const emptyLeaf = createLeafNode([], null);
    this.state = {
      maxLeafEntries,
      maxBranchChildren,
      root: emptyLeaf,
      leftmostLeaf: emptyLeaf,
      rightmostLeaf: emptyLeaf,
      entryCount: 0,
    };
  }

  public insert(record: PersistedTimeseriesRecord): void {
    insertRecord(this.state, record);
  }

  public popOldest(): PersistedTimeseriesRecord | null {
    return popOldestRecord(this.state);
  }

  public rangeQuery(
    startTimestamp: number,
    endTimestamp: number,
  ): PersistedTimeseriesRecord[] {
    return rangeQueryRecords(this.state, startTimestamp, endTimestamp);
  }

  public assertInvariants(): void {
    assertTimeIndexInvariants(this.state);
  }

  public getStats(): TimeIndexBTreeStats {
    return getTimeIndexStats(this.state);
  }
}
