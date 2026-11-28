#!/usr/bin/env node
/* Statelia — Minitab gap audit consistency checker (WO-08).
 *
 * Recomputes every published number from docs/audit/*.json and checks the CSV,
 * the HTML dashboard and docs/MINITAB_MASTER_FEATURE_GAP.md against it. Also
 * checks that every Source Evidence file/symbol and every Test Evidence file/QA
 * case really exists in the repository, so a row cannot claim something the
 * code does not have.
 *
 *   node tools/verify_audit.mjs            # 0 errors required
 *   node tools/verify_audit.mjs --verbose
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');
const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);
const warn = (m) => warnings.push(m);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const json = (p) => JSON.parse(read(p));
const readTree = (p) => {
  const abs = path.join(ROOT, p);
  if (!fs.existsSync(abs)) return '';
  if (!fs.statSync(abs).isDirectory()) return fs.readFileSync(abs, 'utf8');
  return fs.readdirSync(abs).filter((f) => /\.(tsx?|css)$/.test(f)).map((f) => fs.readFileSync(path.join(abs, f), 'utf8')).join('\n');
};

const STATUS = ['FULL', 'PARTIAL', 'MISSING', 'DIFFERENT', 'NOT_APPLICABLE', 'UNKNOWN'];
const VERIF = ['INDEPENDENT_VERIFIED', 'UNIT_VERIFIED', 'E2E_VERIFIED', 'IMPLEMENTATION_ONLY', 'UNVERIFIED', 'FAILED'];
const PRIO = ['P0', 'P1', 'P2', 'P3'];
const PHASE = ['Phase 4', 'Phase 5', 'Phase 6'];
const COLS = ['Feature ID', 'Parent Feature ID', 'Category', 'Minitab Feature', 'Minitab Option', 'Minitab Version',
  'Reference URL', 'Sigrún Feature', 'Implementation Status', 'Verification Status', 'Source Evidence', 'Test Evidence',
  'Missing Parameters', 'Missing Outputs', 'Numerical Differences', 'UX Differences', 'Known Limitations', 'Priority',
  'Target Phase', 'Estimated Complexity', 'Dependencies'];

const ref = json('docs/audit/minitab-reference-inventory.json');
const inv = json('docs/audit/sigrun-feature-inventory.json');
const mx = json('docs/audit/minitab-gap-matrix.json');
const summ = json('docs/audit/audit-summary.json');
const cov = json('docs/audit/qa-coverage.json');
const plans = json('docs/audit/phase-backlog.json');
const rows = mx.rows;

const qaIds = new Set();
for (const f of fs.readdirSync(path.join(ROOT, 'qa/cases')).filter((f) => f.endsWith('.json'))) {
  for (const c of JSON.parse(read('qa/cases/' + f)).cases) qaIds.add(c.id);
}
const analysesSrc = read('src/lib/analyses.ts');
if (!qaIds.size) fail('qa/cases: 케이스를 읽지 못했다');

/* ── 1. reference inventory ─────────────────────────────────────────────────── */
const REF_FIELDS = ['featureId', 'domainId', 'category', 'menuPath', 'analysisName', 'inputDataType', 'requiredInputs',
  'optionalInputs', 'analysisOptions', 'statisticalMethods', 'outputStatistics', 'diagnosticResults', 'graphTypes',
  'storageOptions', 'exportOptions', 'statisticalAssumptions', 'methodsAndFormulas', 'officialReferenceUrl'];
for (const f of ref.features) {
  for (const k of REF_FIELDS) {
    if (f[k] === undefined) fail(`reference ${f.featureId}: 필드 ${k} 없음`);
    else if (Array.isArray(f[k]) && f[k].length === 0) fail(`reference ${f.featureId}: ${k} 비어 있음`);
    else if (typeof f[k] === 'string' && !f[k].trim()) fail(`reference ${f.featureId}: ${k} 비어 있음`);
  }
  if (f.referenceUrlHttpStatus !== 200) fail(`reference ${f.featureId}: URL HTTP ${f.referenceUrlHttpStatus}`);
  const u = f.officialReferenceUrl;
  if (!/^https:\/\/support\.minitab\.com\//.test(u)) fail(`reference ${f.featureId}: 공식 도메인 아님 ${u}`);
}
const domainCounts = ref.domains.map((d) => d.featureCount);
if (domainCounts.reduce((a, b) => a + b, 0) !== ref.features.length) fail('reference: domain featureCount 합이 전체와 다르다');
if (ref.features.length !== ref.meta.featureCount) fail('reference: meta.featureCount 불일치');
if (new Set(ref.features.map((f) => f.featureId)).size !== ref.features.length) fail('reference: featureId 중복');

/* ── 2. Sigrún inventory ────────────────────────────────────────────────────── */
for (const s of inv.features) {
  if (!s.title || !s.uiEntryPoint) fail(`sigrun ${s.featureId}: title/uiEntryPoint 없음`);
  const files = String(s.sourceFile).split(',').map((x) => x.trim()).filter(Boolean);
  for (const f of files) if (!exists(f)) fail(`sigrun ${s.featureId}: 소스 파일 없음 ${f}`);
  if (s.kind === 'analysis' && !new RegExp(`id: '${s.analysisId}'`).test(analysesSrc)) fail(`sigrun ${s.featureId}: 레지스트리에 ${s.analysisId} 없음`);
  const engine = String(s.engineFunction || '').split(',').map((x) => x.trim()).filter(Boolean);
  const blob = files.filter(exists).map(readTree).join('\n');
  for (const sym of engine) {
    if (sym && !blob.includes(sym)) fail(`sigrun ${s.featureId}: 심볼 ${sym} 이 소스에 없음`);
  }
  for (const t of s.unitTestFiles) if (!exists('tests/' + t)) fail(`sigrun ${s.featureId}: 테스트 없음 tests/${t}`);
  for (const q of s.independentQaCaseIds) if (!qaIds.has(q)) fail(`sigrun ${s.featureId}: QA 케이스 없음 ${q}`);
  for (const e of s.e2eTestIds) if (!exists(e)) fail(`sigrun ${s.featureId}: E2E 없음 ${e}`);
  for (const h of s.helpDocumentIds) if (!new RegExp(`id: '${h}'`).test(['basics', 'quality', 'doe', 'models'].map((f) => read(`src/help/content/${f}.ts`)).join('\n'))) fail(`sigrun ${s.featureId}: 도움말 문서 없음 ${h}`);
  const tutSrc = ['part1', 'part2', 'part3'].map((f) => read(`src/tutorials/courses/${f}.ts`)).join('\n');
  for (const t of s.tutorialIds) if (!tutSrc.includes(`id: '${t}'`)) fail(`sigrun ${s.featureId}: 튜토리얼 없음 ${t}`);
}

/* ── 3. matrix ──────────────────────────────────────────────────────────────── */
if (!rows.length) fail('matrix: 행이 없다');
const ids = new Set();
for (const r of rows) {
  for (const c of COLS) if (r[c] === undefined) fail(`matrix ${r['Feature ID']}: 열 ${c} 없음`);
  if (ids.has(r['Feature ID'])) fail(`matrix: Feature ID 중복 ${r['Feature ID']}`);
  ids.add(r['Feature ID']);
  if (!STATUS.includes(r['Implementation Status'])) fail(`matrix ${r['Feature ID']}: 상태 어휘 오류`);
  if (!VERIF.includes(r['Verification Status'])) fail(`matrix ${r['Feature ID']}: 검증 어휘 오류`);
  if (!PRIO.includes(r['Priority'])) fail(`matrix ${r['Feature ID']}: 우선순위 오류`);
  if (!PHASE.includes(r['Target Phase'])) fail(`matrix ${r['Feature ID']}: Phase 오류`);
  if (!['S', 'M', 'L'].includes(r['Estimated Complexity'])) fail(`matrix ${r['Feature ID']}: 복잡도 오류`);
  if (r['Implementation Status'] === 'MISSING' && r['Test Evidence'] !== '없음') fail(`matrix ${r['Feature ID']}: MISSING 인데 Test Evidence 가 있다`);
  if (r['Implementation Status'] === 'FULL' && r['Verification Status'] !== 'INDEPENDENT_VERIFIED') fail(`matrix ${r['Feature ID']}: FULL 은 독립 검증이 있어야 한다`);
  if (r['Implementation Status'] !== 'MISSING' && r['Implementation Status'] !== 'NOT_APPLICABLE') {
    // Source Evidence: "file[, file] · symbol[, symbol]"
    const [filesPart, symPart = ''] = String(r['Source Evidence']).split(' · ');
    const files = filesPart.split(',').map((x) => x.trim()).filter(Boolean);
    if (!files.length) fail(`matrix ${r['Feature ID']}: Source Evidence 파일 없음`);
    const blob = [];
    for (const f of files) {
      if (!exists(f)) fail(`matrix ${r['Feature ID']}: Source Evidence 파일 없음 ${f}`);
      else blob.push(readTree(f));
    }
    const joined = blob.join('\n');
    for (const sym of symPart.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (!joined.includes(sym)) fail(`matrix ${r['Feature ID']}: Source Evidence 심볼 없음 ${sym}`);
    }
    const parts = String(r['Test Evidence']).split(' · ').map((x) => x.trim()).filter(Boolean);
    let hasReal = false;
    for (const p of parts) {
      if (p === '없음') continue;
      if (p.startsWith('QA-')) {
        if (!qaIds.has(p)) fail(`matrix ${r['Feature ID']}: QA 케이스 없음 ${p}`);
        hasReal = true;
      } else if ((p.startsWith('tests/') || p.startsWith('tools/')) && !exists(p)) {
        fail(`matrix ${r['Feature ID']}: 테스트 파일 없음 ${p}`);
      } else if (p.startsWith('tests/') || p.startsWith('tools/')) hasReal = true;
    }
    if (!hasReal && r['Verification Status'] !== 'IMPLEMENTATION_ONLY') fail(`matrix ${r['Feature ID']}: Test Evidence 가 비었는데 검증 상태가 ${r['Verification Status']}`);
  }
}

/* ── 4. CSV equals JSON ─────────────────────────────────────────────────────── */
const csvText = read('docs/audit/minitab-gap-matrix.csv');
const parseCsv = (text) => {
  const out = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); out.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
};
const csv = parseCsv(csvText);
const header = csv[0];
if (header.join('|') !== COLS.join('|')) fail('csv: 헤더가 21필드와 다르다');
if (csv.length - 1 !== rows.length) fail(`csv: 행 수 ${csv.length - 1} ≠ JSON ${rows.length}`);
else {
  for (let i = 0; i < rows.length; i += 1) {
    for (let c = 0; c < COLS.length; c += 1) {
      const want = String(rows[i][COLS[c]] ?? '');
      if ((csv[i + 1][c] ?? '') !== want) fail(`csv: ${rows[i]['Feature ID']} · ${COLS[c]} 불일치`);
    }
  }
}

/* ── 5. summary recomputation ───────────────────────────────────────────────── */
const minitabRows = rows.filter((r) => r.Category !== 'Sigrún 독립 구현');
const independentRows = rows.filter((r) => r.Category === 'Sigrún 독립 구현');
const countBy = (rs, k) => rs.reduce((acc, r) => (acc[r[k]] = (acc[r[k]] || 0) + 1, acc), {});
const overall = countBy(minitabRows, 'Implementation Status');
for (const k of STATUS) if ((overall[k] || 0) !== summ.overall[k]) fail(`summary: ${k} ${summ.overall[k]} ≠ ${overall[k] || 0}`);
if (summaryCount() !== minitabRows.length) fail('summary: 분모 불일치');
function summaryCount() { return summ.minitabFeatureCount; }
if (minitabRows.length !== summ.minitabFeatureCount) fail('summary: minitabFeatureCount 불일치');
if (independentRows.length !== summ.independentFeatureCount) fail('summary: independentFeatureCount 불일치');
const impl = minitabRows.filter((r) => ['FULL', 'PARTIAL', 'DIFFERENT'].includes(r['Implementation Status'])).length;
if (impl !== summ.overall.implemented) fail('summary: implemented 불일치');
if (Math.abs(summ.overall.implementedPct - Math.round(1000 * impl / minitabRows.length) / 10) > 0.05) fail('summary: implementedPct 불일치');
for (const d of summ.byDomain) {
  const rs = minitabRows.filter((r) => r.Category === d.category);
  if (rs.length !== d.total) fail(`summary: ${d.category} total 불일치`);
  for (const k of STATUS) if ((countBy(rs, 'Implementation Status')[k] || 0) !== d[k]) fail(`summary: ${d.category} ${k} 불일치`);
}
for (const p of PRIO) if (minitabRows.filter((r) => r.Priority === p).length !== summ.byPriority[p]) fail(`summary: priority ${p}`);
for (const p of PHASE) if (minitabRows.filter((r) => r['Target Phase'] === p).length !== summ.byPhase[p]) fail(`summary: phase ${p}`);
if (cov.meta.caseCount !== qaIds.size) fail(`qa-coverage: 케이스 수 ${cov.meta.caseCount} ≠ 실제 ${qaIds.size}`);
if (cov.methodologyDifferences.length < 10) fail('qa-coverage: 방법론 차이 10항목 미만');

/* ── 6. backlog: 12 fields, complete and unique allocation ──────────────────── */
const FIELDS12 = ['Work Order ID', 'Feature IDs', 'Priority', 'Implementation Scope', 'Mathematical Requirements',
  'Input/Output Contract', 'Dependencies', 'Implementation Complexity', 'Independent Reference', 'Acceptance Criteria',
  'Required Sample/Help/Tutorial', 'Regression Test Requirements'];
const allocated = new Map();
for (const phase of PHASE) {
  const items = plans[phase] || [];
  if (!items.length) fail(`backlog ${phase}: 작업지시 없음`);
  for (const it of items) {
    for (const f of FIELDS12) if (!it[f] || (Array.isArray(it[f]) && !it[f].length)) fail(`backlog ${it['Work Order ID']}: ${f} 비어 있음`);
    if (it['Target Phase'] !== phase) fail(`backlog ${it['Work Order ID']}: phase 불일치`);
    for (const f of it['Feature IDs']) {
      if (!ids.has(f)) fail(`backlog ${it['Work Order ID']}: 없는 기능 ${f}`);
      if (!minitabRows.find((r) => r['Feature ID'] === f)) fail(`backlog ${it['Work Order ID']}: Minitab 기능이 아님 ${f}`);
      if (allocated.has(f)) fail(`backlog: ${f} 가 ${allocated.get(f)} 와 ${it['Work Order ID']} 에 중복 배정`);
      allocated.set(f, it['Work Order ID']);
      const row = minitabRows.find((r) => r['Feature ID'] === f);
      if (row['Target Phase'] !== phase) fail(`backlog: ${f} 의 Target Phase ${row['Target Phase']} ≠ ${phase}`);
    }
  }
}
for (const r of minitabRows) if (!allocated.has(r['Feature ID'])) fail(`backlog: ${r['Feature ID']} 미배정`);

/* ── 7. dashboard ───────────────────────────────────────────────────────────── */
const html = read('docs/audit/minitab-gap-dashboard.html');
if (/(https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(html.replace(/<script id="audit-dashboard-data"[\s\S]*?<\/script>/g, '').replace(/https:\/\/support\.minitab\.com/g, ''))) warn('dashboard: 외부 URL 문자열이 남아 있다(링크가 아니라 텍스트면 무해)');
if (/<link\b|<script[^>]*src=|<img[^>]*src=|@import|url\(/i.test(html)) fail('dashboard: 외부 리소스 참조가 있다');
const m = html.match(/<script id="audit-dashboard-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!m) fail('dashboard: 데이터 블록 없음');
else {
  const blob = JSON.parse(m[1]);
  if (blob.minitabFeatureCount !== summ.minitabFeatureCount) fail('dashboard: 분모 불일치');
  if (blob.overall.MISSING !== summ.overall.MISSING) fail('dashboard: MISSING 불일치');
  for (const d of summ.byDomain) {
    const got = blob.byDomain.find((x) => x.category === d.category);
    if (!got || got.total !== d.total || got.MISSING !== d.MISSING) fail(`dashboard: ${d.category} 불일치`);
  }
  if (blob.qaCases !== cov.meta.caseCount) fail('dashboard: QA 케이스 수 불일치');
  if (blob.backlog['Phase 4'].workOrders !== plans['Phase 4'].length) fail('dashboard: Phase 4 작업지시 수 불일치');
}

/* ── 8. markdown report ─────────────────────────────────────────────────────── */
const md = read('docs/MINITAB_MASTER_FEATURE_GAP.md');
for (const [needle, label] of [
  [`Minitab 공개 문서에서 확인한 기능 **${summ.minitabFeatureCount}개**`, '분모'],
  [`**${summ.overall.implemented}개(${summ.overall.implementedPct}%)**`, '구현 수'],
  [`**FULL ${summ.overall.FULL} · PARTIAL ${summ.overall.PARTIAL} · DIFFERENT ${summ.overall.DIFFERENT} · MISSING ${summ.overall.MISSING} · NOT_APPLICABLE ${summ.overall.NOT_APPLICABLE} · UNKNOWN ${summ.overall.UNKNOWN}**`, '상태 분포'],
  [`**P0 ${summ.byPriority.P0} · P1 ${summ.byPriority.P1} · P2 ${summ.byPriority.P2} · P3 ${summ.byPriority.P3}**`, '우선순위'],
  [`**Phase 4 ${summ.byPhase['Phase 4']}기능`, 'Phase 4'],
  [`**Phase 5 ${summ.byPhase['Phase 5']}기능`, 'Phase 5'],
  [`**Phase 6 ${summ.byPhase['Phase 6']}기능`, 'Phase 6'],
]) if (!md.includes(needle)) fail(`report: ${label} 문구가 집계와 다르다 (${needle})`);
for (const d of summ.byDomain) {
  const line = `| ${d.category} | ${d.total} | ${d.FULL} | ${d.PARTIAL} | ${d.DIFFERENT} | ${d.MISSING} | ${d.NOT_APPLICABLE} |`;
  if (!md.includes(line)) fail(`report: ${d.category} 요약 행 불일치`);
}
if (!md.includes(mx.meta.commit)) fail('report: 기준 커밋 SHA 없음');
for (const phase of PHASE) {
  const file = { 'Phase 4': 'docs/PHASE4_BACKLOG.md', 'Phase 5': 'docs/PHASE5_BACKLOG.md', 'Phase 6': 'docs/PHASE6_BACKLOG.md' }[phase];
  const text = read(file);
  for (const it of plans[phase]) {
    if (!text.includes(it['Work Order ID'])) fail(`${file}: ${it['Work Order ID']} 없음`);
    for (const f of FIELDS12) if (!text.includes(`**${f}**`)) fail(`${file}: 12필드 ${f} 표기 없음`);
  }
}

/* ── report ─────────────────────────────────────────────────────────────────── */
const totalRows = rows.length;
console.log(`matrix rows            ${totalRows} (Minitab ${minitabRows.length} + 독립 ${independentRows.length})`);
console.log(`status                 ` + STATUS.map((k) => `${k} ${overall[k] || 0}`).join(' · '));
console.log(`reference features     ${ref.features.length} (URL HTTP 200 ${ref.features.filter((f) => f.referenceUrlHttpStatus === 200).length})`);
console.log(`sigrun features        ${inv.features.length} (분석 ${inv.features.filter((s) => s.kind === 'analysis').length} · 모듈 ${inv.features.filter((s) => s.kind === 'module').length})`);
console.log(`qa cases               ${qaIds.size}`);
console.log(`backlog work orders    ${PHASE.map((p) => `${p} ${plans[p].length}`).join(' · ')}`);
console.log(`allocated features     ${allocated.size} / ${minitabRows.length}`);
if (VERBOSE && warnings.length) console.log('warnings:\n  ' + warnings.join('\n  '));
if (errors.length) {
  console.error(`\n✗ ${errors.length} error(s)`);
  for (const e of errors.slice(0, 60)) console.error('  - ' + e);
  if (errors.length > 60) console.error(`  … ${errors.length - 60} more`);
  process.exit(1);
}
console.log(`\n✓ 0 errors${warnings.length ? ` (${warnings.length} warning)` : ''}`);
