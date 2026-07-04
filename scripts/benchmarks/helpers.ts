import { performance } from 'node:perf_hooks';

export interface BenchmarkResult {
  readonly scenario: string;
  readonly volume: number;
  readonly durationMs: number;
  readonly opsPerSec: number;
}

export type ScenarioFn = (volume: number) => Promise<void>;

export interface BenchmarkScenario {
  readonly name: string;
  readonly run: ScenarioFn;
}

export const VOLUMES = [1_024, 4_096, 16_384, 65_536] as const;

export const measure = async (
  name: string,
  volume: number,
  fn: () => void | Promise<void>,
): Promise<BenchmarkResult> => {
  // Warm-up run (not measured)
  await fn();

  const start = performance.now();
  await fn();
  const durationMs = performance.now() - start;

  const opsPerSec = durationMs > 0 ? (volume / durationMs) * 1_000 : Infinity;
  return { scenario: name, volume, durationMs, opsPerSec };
};

export const generateDocument = (index: number): Record<string, unknown> => {
  return {
    name: `user_${index}`,
    age: 18 + (index % 60),
    email: `user_${index}@example.com`,
    score: Math.round(Math.random() * 10_000) / 100,
    category: ['A', 'B', 'C', 'D'][index % 4],
    active: index % 3 !== 0,
    createdAt: Date.now() - index * 1_000,
  };
};

export const printResults = (results: BenchmarkResult[]): void => {
  const scenarioWidth = Math.max(
    'Scenario'.length,
    ...results.map((r) => r.scenario.length),
  );
  const volWidth = 8;
  const durWidth = 14;
  const opsWidth = 14;

  const header =
    'Scenario'.padEnd(scenarioWidth) +
    ' | ' +
    'Volume'.padStart(volWidth) +
    ' | ' +
    'Duration (ms)'.padStart(durWidth) +
    ' | ' +
    'ops/sec'.padStart(opsWidth);

  const separator = '-'.repeat(header.length);

  console.log('');
  console.log(header);
  console.log(separator);

  for (const r of results) {
    const line =
      r.scenario.padEnd(scenarioWidth) +
      ' | ' +
      String(r.volume).padStart(volWidth) +
      ' | ' +
      r.durationMs.toFixed(3).padStart(durWidth) +
      ' | ' +
      (r.opsPerSec === Infinity
        ? '∞'.padStart(opsWidth)
        : Math.round(r.opsPerSec).toLocaleString().padStart(opsWidth));

    console.log(line);
  }

  console.log(separator);
  console.log('');
};
