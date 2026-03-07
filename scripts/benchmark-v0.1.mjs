import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { Datastore } from '../dist/core/index.js';

/**
 * @typedef {Object} BenchmarkDataset
 * @property {string} name
 * @property {'memory' | 'file'} backend
 * @property {number} recordCount
 * @property {'narrow' | 'nested' | 'mixed'} payloadShape
 */

/**
 * @typedef {Object} BenchmarkMetrics
 * @property {string} dataset
 * @property {'memory' | 'file'} backend
 * @property {number} records
 * @property {number} insertDurationMs
 * @property {number} selectDurationMs
 * @property {number} insertRecordsPerSecond
 * @property {number} selectRecordsPerSecond
 */

/**
 * @returns {BenchmarkDataset[]}
 */
export const getDatasets = () => {
  return [
    {
      name: 'tiny-memory',
      backend: 'memory',
      recordCount: 1000,
      payloadShape: 'narrow',
    },
    {
      name: 'small-file',
      backend: 'file',
      recordCount: 2000,
      payloadShape: 'nested',
    },
    {
      name: 'medium-memory',
      backend: 'memory',
      recordCount: 10000,
      payloadShape: 'mixed',
    },
  ];
};

/**
 * @param {number} index
 * @param {'narrow' | 'nested' | 'mixed'} payloadShape
 * @returns {Record<string, unknown>}
 */
export const buildPayload = (index, payloadShape) => {
  if (payloadShape === 'narrow') {
    return {
      event: index % 2 === 0 ? 'ingest' : 'egress',
      value: index,
      source: `sensor-${index % 8}`,
    };
  }

  if (payloadShape === 'nested') {
    return {
      event: 'commit',
      source: `gateway-${index % 4}`,
      metrics: {
        latencyMs: index % 100,
        retries: index % 3,
      },
      meta: {
        region: index % 2 === 0 ? 'ap-northeast-1' : 'us-west-2',
        tags: {
          app: 'frostpillar-bench',
          run: `r-${Math.floor(index / 10)}`,
        },
      },
    };
  }

  return {
    event: index % 5 === 0 ? 'warning' : 'ok',
    source: `node-${index % 16}`,
    value: index * 0.5,
    success: index % 3 !== 0,
    flags: {
      hot: index % 7 === 0,
      sampled: index % 11 === 0,
    },
  };
};

/**
 * @param {number} recordCount
 * @param {'narrow' | 'nested' | 'mixed'} payloadShape
 * @returns {Array<{ timestamp: number, payload: Record<string, unknown> }>}
 */
export const generateRecords = (recordCount, payloadShape) => {
  const startTimestamp = Date.parse('2026-01-01T00:00:00.000Z');
  return Array.from({ length: recordCount }, (_, index) => {
    return {
      timestamp: startTimestamp + index,
      payload: buildPayload(index, payloadShape),
    };
  });
};

/**
 * @param {number} records
 * @param {number} durationMs
 * @returns {number}
 */
export const recordsPerSecond = (records, durationMs) => {
  if (durationMs <= 0) {
    return 0;
  }
  return Number((records / (durationMs / 1000)).toFixed(2));
};

/**
 * @param {BenchmarkDataset} dataset
 * @param {string} benchmarkDirectory
 * @returns {Promise<BenchmarkMetrics>}
 */
export const runDataset = async (dataset, benchmarkDirectory) => {
  const records = generateRecords(dataset.recordCount, dataset.payloadShape);
  const rangeStart = records[0]?.timestamp ?? 0;
  const rangeEnd = records[records.length - 1]?.timestamp ?? 0;

  if (dataset.backend === 'memory') {
    const db = new Datastore({ location: 'memory' });

    const insertStart = performance.now();
    for (const record of records) {
      await db.insert(record);
    }
    const insertDurationMs = Number((performance.now() - insertStart).toFixed(3));

    const selectStart = performance.now();
    await db.select({ start: rangeStart, end: rangeEnd });
    const selectDurationMs = Number((performance.now() - selectStart).toFixed(3));

    await db.close();

    return {
      dataset: dataset.name,
      backend: dataset.backend,
      records: dataset.recordCount,
      insertDurationMs,
      selectDurationMs,
      insertRecordsPerSecond: recordsPerSecond(dataset.recordCount, insertDurationMs),
      selectRecordsPerSecond: recordsPerSecond(dataset.recordCount, selectDurationMs),
    };
  }

  const filePath = path.join(benchmarkDirectory, `${dataset.name}.fpdb`);
  const db = new Datastore({
    location: 'file',
    filePath,
  });

  const insertStart = performance.now();
  for (const record of records) {
    await db.insert(record);
  }
  await db.commit();
  const insertDurationMs = Number((performance.now() - insertStart).toFixed(3));
  await db.close();

  const reopen = new Datastore({
    location: 'file',
    filePath,
  });

  const selectStart = performance.now();
  await reopen.select({ start: rangeStart, end: rangeEnd });
  const selectDurationMs = Number((performance.now() - selectStart).toFixed(3));
  await reopen.close();

  return {
    dataset: dataset.name,
    backend: dataset.backend,
    records: dataset.recordCount,
    insertDurationMs,
    selectDurationMs,
    insertRecordsPerSecond: recordsPerSecond(dataset.recordCount, insertDurationMs),
    selectRecordsPerSecond: recordsPerSecond(dataset.recordCount, selectDurationMs),
  };
};

/**
 * @returns {Promise<{
 *   generatedAt: string,
 *   environment: Record<string, unknown>,
 *   results: BenchmarkMetrics[],
 * }>}
 */
export const runBenchmark = async () => {
  const benchmarkDirectory = path.join(
    process.cwd(),
    '.tmp',
    'benchmark-v0.1',
  );

  await rm(benchmarkDirectory, { recursive: true, force: true });
  await mkdir(benchmarkDirectory, { recursive: true });

  const results = [];
  for (const dataset of getDatasets()) {
    const metrics = await runDataset(dataset, benchmarkDirectory);
    results.push(metrics);
  }

  return {
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuModel: os.cpus()[0]?.model ?? 'unknown',
      cwd: process.cwd(),
    },
    results,
  };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const output = await runBenchmark();
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
