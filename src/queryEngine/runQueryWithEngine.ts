import type {
  NativeQueryResultRow,
  QueryEngineModule,
  QueryExecutionOptions,
} from '../core/types.js';
import type { Datastore } from '../core/datastore/Datastore.js';

export const runQueryWithEngine = async (
  db: Datastore,
  engine: QueryEngineModule,
  queryText: string,
  options?: QueryExecutionOptions,
): Promise<NativeQueryResultRow[]> => {
  const request = engine.toNativeQuery(queryText, options);
  return await db.queryNative(request);
};
