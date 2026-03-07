import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('specs define regex safety bounds and path-containment hardening', async () => {
  const datastoreSpec = await readDoc('docs/specs/04_DatastoreAPI.md');
  const queryContract = await readDoc('docs/specs/05_QueryEngineContract.md');
  const recordSpec = await readDoc('docs/specs/01_RecordFormat.md');

  assert.match(
    datastoreSpec,
    /resolved datastore path MUST stay within current working directory \(`process\.cwd\(\)`\)/i,
  );
  assert.match(
    datastoreSpec,
    /containment checks MUST use canonical filesystem paths \(`realpath`\)/i,
  );
  assert.match(
    datastoreSpec,
    /re-validate canonical containment immediately before lock\/data file creation/i,
  );
  assert.match(
    datastoreSpec,
    /filePrefix` and `target\.fileName` MUST be file-name fragments/i,
  );
  assert.match(
    datastoreSpec,
    /must fail with\s+`ConfigurationError`/i,
  );
  assert.match(
    datastoreSpec,
    /payload per-object key count max is `256`/i,
  );
  assert.match(
    datastoreSpec,
    /payload total key count max is `4096`/i,
  );
  assert.match(
    datastoreSpec,
    /payload aggregate validation byte budget max is `1048576`/i,
  );

  assert.match(recordSpec, /One payload object level MUST contain at most `256` keys/i);
  assert.match(recordSpec, /Total key count across full payload tree MUST be `<= 4096`/i);
  assert.match(recordSpec, /Payload validation aggregate UTF-8 byte budget MUST be `<= 1048576`/i);

  assert.match(
    queryContract,
    /`like` MUST use bounded wildcard matching semantics \(`%` and `_`\) without compiling/i,
  );
  assert.match(
    queryContract,
    /`regexp` patterns using backreferences, look-around assertions, or nested quantifier/i,
  );
  assert.match(
    queryContract,
    /`regexp` pattern length MUST be bounded \(max 256 UTF-16 code units\)/i,
  );
  assert.match(
    queryContract,
    /`like` matching implementation MUST keep additional working memory proportional to[\s\S]*O\(pattern length\)/i,
  );
  assert.match(
    queryContract,
    /each validated `regexp` predicate pattern MUST be[\s\S]*compiled once and reused/i,
  );
  assert.match(
    queryContract,
    /Native filter expression nesting depth[\s\S]*MUST be `<= 64`/i,
  );
  assert.match(
    queryContract,
    /max scanned candidate rows per query: `10000`/i,
  );
  assert.match(
    queryContract,
    /max output rows per query[\s\S]*`5000`/i,
  );
});

test('usage docs and ADR record security hardening contract in EN/JA', async () => {
  const usageEn = await readDoc('docs/usage/01_DatastoreAPI.md');
  const usageJa = await readDoc('docs/usage/01_DatastoreAPI-JA.md');
  const adrIndex = await readDoc('docs/adr/INDEX.md');
  const adr = await readDoc(
    'docs/adr/43_QueryRegexSafety_and_FilePathContainment.md',
  );
  const adr45 = await readDoc(
    'docs/adr/45_QueryPredicate_MemoryBound_and_RegexCompileReuse.md',
  );
  const adr53 = await readDoc(
    'docs/adr/53_SecurityHardening_Execution_for_SymlinkPayload_and_QueryGuards.md',
  );

  assert.match(
    usageEn,
    /`regexp` blocks look-around, backreferences, and nested quantifier groups/i,
  );
  assert.match(
    usageEn,
    /resolved file datastore path must stay under `process\.cwd\(\)`/i,
  );
  assert.match(
    usageEn,
    /`like` matching keeps additional working memory proportional to pattern length/i,
  );
  assert.match(
    usageEn,
    /`regexp` predicate pattern is compiled once per native query execution/i,
  );

  assert.match(
    usageJa,
    /`regexp` は look-around・backreference・入れ子量指定グループ.*を拒否します/i,
  );
  assert.match(
    usageJa,
    /file backend の解決後パスは `process\.cwd\(\)` 配下に制限されます/i,
  );
  assert.match(
    usageJa,
    /`like` の照合は、追加作業メモリをパターン長に比例する範囲.*制限します/i,
  );
  assert.match(
    usageJa,
    /`regexp` パターンは 1 回の native query 実行につき 1 回だけコンパイルし/i,
  );
  assert.match(
    usageEn,
    /payload per-object key count limit \(`256`\), total key count limit \(`4096`\), and aggregate payload byte budget \(`1048576`\)/i,
  );
  assert.match(
    usageEn,
    /native query guardrails reject filter-expression depth over `64`, scanned rows over `10000`, and output rows over `5000`/i,
  );
  assert.match(
    usageJa,
    /payload は「1オブジェクトあたり 256 キー」「全体 4096 キー」「集約バイト予算 1048576」/i,
  );
  assert.match(
    usageJa,
    /native query は「式深さ 64」「走査行 10000」「出力行 5000」を超えると拒否/iu,
  );

  assert.match(
    adrIndex,
    /43_QueryRegexSafety_and_FilePathContainment\.md/,
  );
  assert.match(
    adrIndex,
    /45_QueryPredicate_MemoryBound_and_RegexCompileReuse\.md/,
  );
  assert.match(
    adrIndex,
    /53_SecurityHardening_Execution_for_SymlinkPayload_and_QueryGuards\.md/,
  );
  assert.match(
    adr,
    /Bound query-time pattern complexity and enforce file datastore path containment/i,
  );
  assert.match(
    adr45,
    /MUST use an algorithm with additional working memory[\s\S]*bounded by pattern length/i,
  );
  assert.match(
    adr45,
    /compile each `regexp` predicate pattern once[\s\S]*query invocation[\s\S]*reuse/i,
  );
  assert.match(
    adr53,
    /canonical realpath containment, payload aggregate guardrails, and query depth\/row budgets/i,
  );
});
