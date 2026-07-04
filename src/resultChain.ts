import { ValidationError } from './errors.js';
import {
  computeDistinct,
  computeGroupBy,
  extractNumericValues,
  validateAggregationField,
} from './internal/aggregationUtils.js';
import { cloneDocument } from './internal/objectUtils.js';
import {
  applyProjection,
  applySort,
  cloneProjectionSpec,
  cloneSortSpec,
  validateSkip,
} from './internal/resultChainUtils.js';
import type {
  Filter,
  FrostpillarDocument,
  FrostpillarStoredDocument,
  GroupAccumulators,
  GroupResultEntry,
  ProjectionSpec,
  SortDirection,
  SortInput,
} from './types.js';

export interface ResultChainContext<TDocument extends FrostpillarDocument> {
  readonly assertOpen: () => void;
  readonly executeFilter: (
    filter?: Filter,
    limit?: number,
  ) => Promise<FrostpillarStoredDocument<TDocument>[]>;
  readonly executeCount: (filter?: Filter) => Promise<number>;
  readonly pathCache: Map<string, string[]>;
}

interface ResultChainState {
  readonly filter?: Filter;
  readonly limit?: number;
  readonly projection?: ProjectionSpec;
  readonly skip?: number;
  readonly sort?: [string, SortDirection][];
}

const validateLimit = (value: number): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ValidationError('limit must be a positive integer.');
  }
};

export class ResultChain<
  TDocument extends FrostpillarDocument = FrostpillarDocument,
> {
  private readonly context: ResultChainContext<TDocument>;
  private readonly state: ResultChainState;

  public constructor(
    context: ResultChainContext<TDocument>,
    state: ResultChainState,
  ) {
    this.context = context;
    this.state = state;
  }

  public sort(spec: SortInput): ResultChain<TDocument> {
    const nextSort = cloneSortSpec(spec);

    return new ResultChain<TDocument>(this.context, {
      ...this.state,
      sort: nextSort,
    });
  }

  public limit(value: number): ResultChain<TDocument> {
    validateLimit(value);

    return new ResultChain<TDocument>(this.context, {
      ...this.state,
      limit: value,
    });
  }

  public skip(value: number): ResultChain<TDocument> {
    validateSkip(value);

    return new ResultChain<TDocument>(this.context, {
      ...this.state,
      skip: value,
    });
  }

  public project(spec: ProjectionSpec): ResultChain<TDocument> {
    const nextProjection = cloneProjectionSpec(spec);

    return new ResultChain<TDocument>(this.context, {
      ...this.state,
      projection: nextProjection,
    });
  }

  /**
   * Fetches the filtered result set.
   *
   * `applyScanLimit` controls whether the `skip + limit` scan hint may be passed
   * to the datastore. It is only safe for `toArray`/`cursor`, which apply
   * skip/limit afterwards. Aggregation terminals must operate on the full
   * filtered set (spec 03 §1.4), so they pass `false`.
   */
  private async getFilteredDocuments(
    applyScanLimit: boolean,
  ): Promise<FrostpillarStoredDocument<TDocument>[]> {
    this.context.assertOpen();
    // Only pass a scan limit hint when there is no sort: with a sort, all matching
    // documents must be collected before ordering, so early termination is unsafe.
    const scanLimit =
      applyScanLimit && this.state.sort === undefined
        ? this.computeSortLimit()
        : undefined;
    return await this.context.executeFilter(this.state.filter, scanLimit);
  }

  private async getNumericValues(field: string): Promise<number[]> {
    const normalizedField = validateAggregationField(field);
    const filtered = await this.getFilteredDocuments(false);
    return extractNumericValues(
      filtered,
      normalizedField,
      this.context.pathCache,
    );
  }

  private computeSortLimit(): number | undefined {
    if (this.state.limit === undefined) {
      return undefined;
    }
    return (this.state.skip ?? 0) + this.state.limit;
  }

  private applySortSkipLimit(
    docs: FrostpillarStoredDocument<TDocument>[],
  ): FrostpillarStoredDocument<TDocument>[] {
    const sorted =
      this.state.sort === undefined
        ? docs
        : applySort(
            docs,
            this.state.sort,
            this.context.pathCache,
            this.computeSortLimit(),
          );
    const skipped =
      this.state.skip === undefined ? sorted : sorted.slice(this.state.skip);
    const limited =
      this.state.limit === undefined
        ? skipped
        : skipped.slice(0, this.state.limit);
    return limited;
  }

  public async *cursor(): AsyncGenerator<FrostpillarStoredDocument<TDocument>> {
    const filtered = await this.getFilteredDocuments(true);
    const limited = this.applySortSkipLimit(filtered);
    const projection = this.state.projection;

    for (const document of limited) {
      if (projection !== undefined) {
        yield applyProjection(document, projection, this.context.pathCache);
      } else {
        yield cloneDocument(document);
      }
    }
  }

  public async toArray(): Promise<FrostpillarStoredDocument<TDocument>[]> {
    const filtered = await this.getFilteredDocuments(true);
    const limited = this.applySortSkipLimit(filtered);
    const projection = this.state.projection;
    if (projection !== undefined) {
      return limited.map((document) =>
        applyProjection(document, projection, this.context.pathCache),
      );
    }

    return limited.map((document) => cloneDocument(document));
  }

  public async count(): Promise<number> {
    this.context.assertOpen();
    const total = await this.context.executeCount(this.state.filter);
    const afterSkip =
      this.state.skip !== undefined
        ? Math.max(0, total - this.state.skip)
        : total;
    return this.state.limit !== undefined
      ? Math.min(afterSkip, this.state.limit)
      : afterSkip;
  }

  public async sum(field: string): Promise<number> {
    const values = await this.getNumericValues(field);
    return values.reduce((total, value) => total + value, 0);
  }

  public async avg(field: string): Promise<number | null> {
    const values = await this.getNumericValues(field);
    if (values.length === 0) {
      return null;
    }

    const total = values.reduce((sum, value) => sum + value, 0);
    return total / values.length;
  }

  public async min(field: string): Promise<number | null> {
    const values = await this.getNumericValues(field);
    if (values.length === 0) {
      return null;
    }

    return values.reduce((currentMin, value) =>
      value < currentMin ? value : currentMin,
    );
  }

  public async max(field: string): Promise<number | null> {
    const values = await this.getNumericValues(field);
    if (values.length === 0) {
      return null;
    }

    return values.reduce((currentMax, value) =>
      value > currentMax ? value : currentMax,
    );
  }

  public async distinct(field: string): Promise<unknown[]> {
    const normalizedField = validateAggregationField(field);
    const filtered = await this.getFilteredDocuments(false);
    return computeDistinct(filtered, normalizedField, this.context.pathCache);
  }

  public async groupBy(
    field: string,
    accumulators: GroupAccumulators,
  ): Promise<GroupResultEntry[]> {
    const normalizedField = validateAggregationField(field);
    const filtered = await this.getFilteredDocuments(false);
    return computeGroupBy(
      filtered,
      normalizedField,
      accumulators,
      this.context.pathCache,
    );
  }
}
