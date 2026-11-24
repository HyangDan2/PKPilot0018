# Sigrún Phase 3 — 최종 총괄 보고서 (Stage 3A → 3E)

> **저장소**: `HyangDan2/PKPilot0018` (HD2Lab Sigrún)
> **기간**: 2026-11-24 (Stage 3A ~ Stage 3E, 같은 날 연속 릴리스)
> **배포**: GitHub Pages — <https://hyangdan2.github.io/PKPilot0018/>
> **기준 커밋**: Phase 3 시작 직전 `87728e9` → 이 보고서가 포함된 Stage 3E 머지 커밋(§9)
> **Phase 3 범위**: 차트 엔진 고도화(3A·3B·3D) · 모형 계층(3C) · 오프라인 배포(3E) · 각 단계의 교정 QA

---

## 1. Phase 3가 끝난 뒤 무엇이 달라졌나

| 영역 | Phase 2까지 | Phase 3 이후 |
| --- | --- | --- |
| 차트 결함·가드 | 그리기 코드에 분산된 방어 | `src/lib/chartGuards.ts` — NaN·역전 범위·0 간격·알 수 없는 enum이 좌표계에 도달하지 않는다 |
| 3D 표면 | 없음 | `surface3d.ts` + `surfaceGl.ts` — 401×401 격자, WebGL 메시, WebGL이 없으면 **자동 정적 투영** |
| 등고 | 단일 반응 | 등고 고급 옵션(사용자 색상 맵·수준별 스타일·마스크), **Overlaid Contour**(다중 반응 만족 영역) |
| 모형 | 실행 결과 카드에만 존재 | **Stored Model Manager** — 저장·이름변경·재적합·예측·등고·표면·최적화·비교 |
| 최적화 | 없음 | 다중 반응 최적화 — Derringer–Suich 만족도, 7종 상태, 정의역 모듈, 단일 예측 엔진 |
| 프로파일러 | 없음 | (반응 × 인자) 격자, 슬라이더, 구간 밴드, Optimize/Reset/조건 저장 |
| 차트 인터랙션 | 정적 그림 | 확대·이동·십자선·데이터 커서·툴팁 고정·점 선택·워크시트 행 연동·선택 데이터 CSV |
| 고급 축 | 선형/로그 | symlog·ln·거듭제곱·날짜 축·축 생략·보조 눈금·지정 눈금·보조 축 |
| Figure | 카드 단위 내보내기 | **Graph Layout Editor** — 여러 차트를 한 페이지에 배치, 주석, SVG/PNG(150·300·600 DPI) |
| 배포 | GitHub Pages(ESM) | + **Portable 단일 HTML**(`file://`, 오프라인, Node/Python 불필요) |

---

## 2. 단계별 산출물

| 단계 | 작업 목록 | 보고서 | 독립 QA | E2E |
| --- | --- | --- | --- | --- |
| 3A | WO-01 차트 결함·가드, WO-02 Stored Model Manager, 다항 회귀 | `docs/PHASE3_3A_REPORT.md` | QA-J (모형) | `tools/e2e_phase3_3a.cjs` 29 |
| 3B | WO-03 3D Surface, WO-04 Overlaid Contour | `docs/PHASE3_3B_REPORT.md` · `docs/PHASE3_3B_CORRECTIVE_QA.md` | QA-V (표면) | `e2e_phase3_3b.cjs` 41 · `e2e_phase3_3b_corrective.cjs` 13 |
| 3C | WO-05 다중 반응 최적화, WO-06 예측 프로파일러 | `docs/PHASE3_3C_REPORT.md` · `docs/PHASE3_3C_CORRECTIVE_QA.md` · `docs/OPTIMIZER_METHODOLOGY.md` | QA-W (최적화, 20건) | `e2e_phase3_3c.cjs` 24 |
| 3D | WO-07 Graph Layout Editor, WO-08 고급 축/등고/계열 옵션, WO-09 인터랙션 | `docs/PHASE3_3D_REPORT.md` | QA-Y (오차 막대) | `e2e_phase3_3d.cjs` 49 |
| 3E | WO-10 Portable Build, 통합 QA, 최종 보고 | 본 문서 · `docs/PORTABLE_BUILD_GUIDE.md` | 통합(`qa:stats` 225) | `e2e_portable_offline.cjs` 63 · `tools/run_e2e_suite.cjs`(전체) |

각 단계의 교정 QA(3B·3C)는 별도 PR로 `main`에 들어갔고, 그 수정이 이 보고서의 수치에 반영되어 있다.

---

## 3. 변경 파일 (Phase 3 전체, `87728e9..HEAD`)

109개 파일, +57 249 / −2 217 줄.

**앱 (`src/`, 43)** — `App.tsx`, `types.ts`, `styles/app.css`
· 차트: `chartConfig.ts`, `chartConfigOps.ts`, `charts.ts`, `chartGuards.ts`, `chartExport.ts`, `chartInteraction.ts`, `chartMemory.ts`, `chartStage3b.ts`, `axisAdvanced.ts`, `seriesStats.ts`, `contour.ts`, `surface3d.ts`, `surfaceGl.ts`, `pngDpi.ts`, `graphLayout.ts`
· 모형: `modelStore.ts`, `modelPredictor.ts`, `predictionAdapter.ts`, `factorDomain.ts`, `optimizer.ts`, `optimizationTypes.ts`, `desirability.ts`, `profiler.ts`, `feasible.ts`, `glm.ts`, `doe.ts`, `stats.ts`, `analyses.ts`
· 화면: `ModelManager.tsx`, `ResponseOptimizer.tsx`, `PredictionProfiler.tsx`, `Surface3DView.tsx`, `GraphLayoutEditor.tsx`, `ChartFrame.tsx`, `ChartPropertiesDrawer.tsx`, `OutputPanel.tsx`, `MenuBar.tsx`, `WorksheetGrid.tsx`, `i18n.ts`, `project.ts`

**테스트 (`tests/`, 22)** — `axis-advanced`, `chart-guards`, `chart-interaction`, `chart-memory`, `contour-bands`, `contour-styles`, `error-bars`, `feasible`, `gap-doc`, `graph-layout`, `input-audit`, `model-store`, `optimizer`, `perf-optimizer`, `phase3b-corrective`, `phase3c-corrective`, `png-dpi`, `polyreg-model`, `profiler`, `scatter-stage2`, `stage3b-linkage`, `surface3d`

**독립 QA (`qa/`, 15)** — `reference/engine.py`(NumPy/SciPy/statsmodels 기준 엔진), `adapters/sigrun/cli.ts`(배포 코드 경로), `cases/QA-J·V·W·Y`, `build_cases.py`, `tolerances.json`, `inventory.md`, `reports/latest.{json,html}`

**문서 (`docs/`, 9 + 신규 2)** — 단계별 보고서 6, `CHART_FEATURE_GAP.md`, `MODEL_STORE_ARCHITECTURE.md`, `OPTIMIZER_METHODOLOGY.md`, **`PHASE3_UPGRADE_REPORT.md`(신규)**, **`PORTABLE_BUILD_GUIDE.md`(신규)**

**도구 (`tools/`, 13)** — `build_portable.mjs`(신규), `e2e_portable_offline.cjs`(신규), `run_e2e_suite.cjs`(신규), `bench_optimizer.ts`, `serve_inline.cjs`, `shot_phase3_3a.cjs`, E2E 5종

**기타** — `vite.portable.config.ts`(신규), `portable.html`(신규), `package.json`(`build:portable`·`qa:perf`·`qa:portable`), `.gitignore`(`dist-portable`), `README.md`

---

## 4. 검증 결과 (Stage 3E 시점, `main` = `e43d46f` + Stage 3E 브랜치)

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | **0 errors** |
| `npm test` | **1 001 / 1 001 PASS** (44 파일) |
| `npm run qa:stats` | **225 / 225 PASS** · FAIL 0 · REVIEW 0 · UNVERIFIED 0 · ERROR 0 |
| `npm run build` | 성공 — `dist/assets/index-I4-C1lpF.js` 1 196 430 B (라이브 배포본과 **바이트 동일**) |
| `npm run build:portable` | 성공 — `dist-portable/sigrun-portable.html` 1 265 202 B · ZIP 367 915 B |
| Phase 1 E2E (`stage1`·`stage2`·`stage3`) | **77 · 37 · 176 PASS** |
| Phase 1 UI (`ui_compact`) | **63 PASS** (PC·390·320) |
| Phase 2 (`followup`·`chart_axes`·`chart_upgrade`) | **ok(true, svg 39) · 6 · 34 PASS** |
| Phase 3 3A / 3B / 3B교정 / 3C / 3D | **29 / 41 / 13 / 24 / 49 PASS** |
| Portable 오프라인(`file://`, 네트워크 차단) | **63 / 63 PASS** — 네트워크 시도 0건 |
| GitHub Actions | `Deploy`·`Statistics QA` — PR #23~#25 및 이전 단계 모두 **success** (예: run `45370480137`, `45370480074`) |
| 라이브 스모크 (Stage 3D) | **49 / 49 PASS** (`BASE=https://hyangdan2.github.io/PKPilot0018/ SERVE=0`) |
| 라이브 스모크 (Stage 3C) | **24 / 24 PASS** |

로컬 E2E 합계 **549 PASS / 0 FAIL** (+ portable 63, + 라이브 73). 실행 로그: `work/pkpilot0018/suite-*.log`, 요약 JSON `work/pkpilot0018/phase3-3e-suite-{a,b,c,d}.json`, portable `phase3-3e-portable-report.json`.

재현:

```bash
export PATH="/workspace/work/node/bin:$PATH"
npx tsc --noEmit && npm test && npm run qa:stats
npm run build && npm run build:portable
node tools/run_e2e_suite.cjs          # Phase 1/2/3 브라우저 스위트 전체 (dist 기준)
node tools/e2e_portable_offline.cjs   # file:// 오프라인
node tools/perf_qa_3e.cjs             # 성능
```

> E2E 스위트는 샌드박스의 single-process headless Chromium에서 한 컨텍스트를 닫은 뒤 새 컨텍스트를 열면 브라우저가 죽는다. `run_e2e_suite.cjs`는 파트별로 프로세스를 나누고(`stage1` 5회, `ui_compact` 4회), 각 스위트가 연 정적 서버를 끝에 닫도록 고쳤다. 검사 내용은 바꾸지 않았다.

---

## 5. 성능 벤치마크

**측정 환경**: Linux x86_64 컨테이너 · Node v24.19.0 · `chrome-headless-shell 1248` 단일 프로세스 · SwiftShader(소프트웨어 GPU) · 뷰포트 1440×1000/1100 · 로컬 정적 서버가 서빙하는 `dist`(= 라이브와 동일 번들). 절대 시간은 **이 환경**의 값이며, GPU가 있는 실제 PC는 3D·차트 그리기가 더 빠르다. 원자료: `qa/reports/perf-3e.json`, `perf-3e-50k-scatter.json`, `perf-3e-50k-control.json`.

### 5.1 시작과 인터랙션

| 항목 | 값 |
| --- | --- |
| 부팅 → 메뉴바 사용 가능 (http, 중앙값 3회) | **121 ms** (114 / 121 / 214) · DOMContentLoaded 62 ms |
| 부팅 → 메뉴바 (portable `file://`) | **215 ms** · DOMContentLoaded 148 ms |
| JS 힙 (부팅 직후) | 12 MB |
| 프로파일러 슬라이더 1회: 핸들러 비용 | **1.2 ms** |
| 프로파일러 슬라이더 1회: 이벤트 → 두 프레임 페인트 | **29.3 ms** |
| 최적화 1회 (반응 2 · 인자 2 · 격자 21점) | **63 ms** (44 / 63 / 194, 중앙값 3회) |
| JS 힙 (최적화 창 + 프로파일러 열림) | 15 MB |

### 5.2 대용량 데이터

| 데이터 | 가져오기 | 기술통계 | 산점도 | I-MR 관리도 | 힙 |
| --- | --- | --- | --- | --- | --- |
| 20 000행 × 4열 | 4 328 ms | 1 340 ms | 3 342 ms (점 20 003개) | 3 534 ms | 89 MB |
| 50 000행 × 4열 | 4 385 ms | 1 637 ms | 6 724 ms (점 50 003개) | 6 944 ms | 45 MB / 212 MB |

- 20 000행 전 과정이 **page error 0건**으로 끝났고, 기술통계의 `N`이 20 000으로 확인됐다.
- 50 000행에서도 가져오기·기술통계·산점도·관리도가 각각 정상 동작했다(위 표는 각 묶음을 따로 측정한 값).
- **한계 실측**: 50 000행 산점도 직후 같은 페이지에서 50 000행 I-MR을 실행하면 **샌드박스의 단일 프로세스 Chromium이 죽었다**. 각 분석을 따로 돌리면 통과하므로, 원인은 앱의 계산이 아니라 소프트웨어 렌더러 환경의 누적 메모리로 본다. **실제 GPU 브라우저에서는 확인하지 못했으므로 "50 000행 두 분석 연속"은 UNVERIFIED다.**

### 5.3 엔진이 강제하는 상한 (코드 상수)

| 상한 | 값 | 위치 |
| --- | --- | --- |
| 산점도 조합(대화상자 1회) | 36쌍 | `src/lib/analyses.ts` `MAX_COMBOS` |
| 3D 표면 격자 | 401 × 401 | `src/lib/surface3d.ts` `SURFACE_MAX_GRID` |
| 3D 메시 축당 | 121 | `SURFACE_MESH_MAX_GRID` |
| 만족 영역 격자 | 401 | `src/lib/feasible.ts` `MAX_GRID` |
| 최적화 격자점(축당, UI) | 2 … 201 | `ResponseOptimizer.tsx` |
| 최적화 평가 예산 | 60 000 | `optimizationTypes.ts` `maxEvaluations` |
| 반응 개수 | 상한 없음(저장 모형 수만큼) — 실측 2개, QA-W 다중 반응 3개 | `optimizer.ts` |

---

## 6. 한계와 주장하지 않는 것

1. **Minitab 수치 동등성은 주장하지 않는다.** 독립 QA는 NumPy·SciPy·statsmodels로 계산한 **문서화된 정의**와 비교한다(225건). Minitab 자체와의 일치 여부는 이 저장소에서 검증되지 않았다.
2. **전역 최적 보장 없음.** `global-optimal`은 모든 자유 인자가 이산·범주형이고 전 조합을 예산 안에서 평가했을 때만 붙는다. 연속 공간은 `local-converged` 또는 `best-found`다.
3. **3D 표면 패널은 래스터.** 화면은 WebGL, Figure 내보내기는 정적 투영을 래스터로 합성한다(UI·`data-raster`로 명시). 확대 인쇄 품질은 페이지 DPI를 따른다.
4. **레이아웃 편집기의 패널은 스냅샷.** 배치 시점의 차트 사본을 그리므로 이후 재실행이 페이지 그림을 자동 갱신하지 않는다(복원 재현성을 택했다).
5. **회귀 잔차 그림의 행 매핑 없음.** `regress()`가 결측 제거 후 원본 행 인덱스를 돌려주지 않는다.
6. **오차 막대는 반복값이 있는 점에만.** 계열 전체 기준은 모든 점에 같은 구간을 그린다.
7. **Portable 빌드** — 자동 업데이트·PWA·서비스 워커 없음, 오리진이 `file://` 하나. `docs/PORTABLE_BUILD_GUIDE.md` §6.
8. **성능 수치는 이 컨테이너 환경의 값.** SwiftShader 소프트웨어 렌더러라 3D·대용량 차트는 실제 GPU보다 느리다. §5의 50 000행 연속 실행 실패도 같은 이유로 본다(미확인).

---

## 7. 산출물 경로

| 종류 | 경로 |
| --- | --- |
| Portable HTML | `dist-portable/sigrun-portable.html` (1 265 202 B, sha256 `6ce5416e…`) |
| Portable ZIP | `dist-portable/sigrun-portable.zip` · 사본 `work/pkpilot0018/sigrun-portable.zip` (367 915 B) |
| Portable 빌드 정보 | `dist-portable/build-info.json` |
| 독립 QA 결과 | `qa/reports/latest.json` · **`qa/reports/latest.html`** (사람이 보는 리포트) |
| 성능 원자료 | `qa/reports/perf-3e.json`, `perf-3e-50k-scatter.json`, `perf-3e-50k-control.json` |
| E2E 원자료 | `work/pkpilot0018/phase3-3e-portable-report.json`, `phase3-3e-suite-{a,b,c,d}.json`, `suite-*.log` |
| 스크린샷 | `work/pkpilot0018/phase3-3e-portable.png`, `phase3-3e-portable-surface.png`, `phase3-3e-portable-contour.png`, `phase3-3e-portable-optimizer.png`, `phase3-3e-portable-profiler.png`, `phase3-3e-portable-layout.png`, `phase3-3e-portable-import.png`, `phase3-3e-portable-restored.png`, `phase3-3e-portable-figure.svg`, `phase3-3e-portable-figure-300dpi.png`, `phase3-3e-perf-large.png`, `phase3-3e-perf-profiler.png` |
| 라이브 | <https://hyangdan2.github.io/PKPilot0018/> |

---

## 8. Phase 3에서 배운 것 (다음 단계에 남기는 것)

- **테스트가 먼저 실패해야 고친 것이 증명된다.** 3B·3C 교정 QA는 수정 전 기준선에서 결함별 프로브를 남기고, 교정 후 같은 프로브와 대조했다(`docs/PHASE3_3B_CORRECTIVE_QA.md`, `PHASE3_3C_CORRECTIVE_QA.md`).
- **"무엇을 답할 수 있는가"는 한 곳에서 정한다.** 3C 교정에서 예측 경로를 `predictionAdapter` 하나로 모은 뒤, 모형관리자·등고·표면·최적화가 같은 답을 내는 것을 교차검사로 확인했다.
- **정의역은 한 모듈이 소유한다.** `factorDomain`이 이산 간격·고정값·후보 검증을 모두 맡아, 격자·랜덤 시작·국소 탐색·프로파일러가 서로 다른 규칙을 쓰지 않는다.
- **배포 형태도 검증 대상이다.** Portable 빌드는 "빌드가 됐다"가 아니라 `file://`에서 63개 검사를 통과해야 끝난다. 첫 시도는 React #299(빈 화면)였고, 원인은 헤드에 놓인 클래식 스크립트였다.

---

## 9. 최종 커밋·배포 정보

| 항목 | 값 |
| --- | --- |
| Phase 3 마지막 선행 커밋 (`main`) | `e43d46f` — `docs(phase3c): point the original 3C report at the corrective contract (#25)` |
| Stage 3E 브랜치 | `feat/chart-engine-phase3-3e` (머지 후 원격 브랜치 삭제) |
| Stage 3E PR | [#26](https://github.com/HyangDan2/PKPilot0018/pull/26) — CI: `Statistics QA` **pass** (run `45382108417`) |
| Stage 3E 스쿼시 머지 커밋 | **`7ad939a`** — `feat(phase3e): WO-10 portable single-file build · integrated QA · Phase 3 final report (#26)` |
| 머지 후 CI | `Statistics QA` **success** (run `45382368695`) · `Deploy Sigrún to GitHub Pages` **success** (run `45382368687`) |
| 배포 URL | <https://hyangdan2.github.io/PKPilot0018/> (HTTP 200) |
| 배포 번들 | `assets/index-I4-C1lpF.js` (1 196 430 B) — 로컬 `dist`와 바이트 동일 |
