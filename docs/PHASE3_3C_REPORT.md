# Sigrún Phase 3 — Stage 3C 보고서 (3D Surface 수정 · 다중 반응 최적화 · 예측 프로파일러)

> **저장소**: `HyangDan2/PKPilot0018` · 브랜치 `feat/chart-engine-phase3-3c` → PR #15 (스쿼시 머지) · 후속 `fix/optimizer-input-display` → PR #16
> **배포**: GitHub Pages (`https://hyangdan2.github.io/PKPilot0018/`) — Deploy 워크플로 success
> **일자**: 2026-11-24

## 1. 검증 요약

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm test` | **834 / 834 PASS** (Stage 3B 795 + Stage 3C 신규 39: 최적화 28 · 프로파일러 11) |
| `npm run qa:stats` | **180 / 180 PASS, 0 FAIL** (기존 168 + QA-W 12) |
| `npm run build` | 성공 — 외부 CDN·API 없음 |
| `tools/e2e_phase3_3c.cjs` (로컬) | **24 / 24 PASS** |
| `tools/e2e_phase3_3c.cjs` (라이브) | **24 / 24 PASS** (`BASE=https://hyangdan2.github.io/PKPilot0018/ SERVE=0`) |
| CI | `Statistics QA` pass (PR·main), `Deploy Sigrún to GitHub Pages` success |

재현:

```bash
npx tsc --noEmit
npm test
npm run qa:stats
npm run build
node tools/e2e_phase3_3c.cjs
BASE=https://hyangdan2.github.io/PKPilot0018/ SERVE=0 node tools/e2e_phase3_3c.cjs
```

## 2. 3D Surface WebGL 메시 결함 (긴급 선행 수정)

**증상**: `work/pkpilot0018/phase3-3b-surface.png` — 101×101 표면이 매끄러운 격자가 아니라 한 점으로 수렴하는 톱니·부채꼴로 그려짐. 같은 카드의 정적 SVG 투영(`?webgl=off`)은 정상.

**원인**: `src/lib/surfaceGl.ts`의 `setGeometry`가 **정점 버퍼와 인덱스 버퍼를 모두 `ARRAY_BUFFER` 대상으로 재업로드**했다. WebGL 1은 버퍼 객체를 최초 결합 대상에 묶으므로 `ELEMENT_ARRAY_BUFFER` 버퍼에 대한 `bindBuffer(ARRAY_BUFFER, …)`가 `INVALID_OPERATION`을 내고 뒤따르는 `bufferData`가 무시된다. 그런데 그 `bufferData`는 **직전에 결합돼 있던 정점 버퍼에 인덱스 정수 배열을 덮어썼다** → 위치 버퍼가 인덱스 값으로 오염되어 표면이 붕괴. (SwiftShader·실브라우저 공통 규칙)

**수정**
- 업로드를 대상별로 분리: 정점 → `ARRAY_BUFFER`, 삼각형·메시 인덱스 → `ELEMENT_ARRAY_BUFFER`
- 업로드 전후 `getError()` 검사 — 실패하면 렌더러를 버리고 정적 투영으로 폴백(빈 상자 대신 그림)
- 마운트 시 같은 지오메트리를 두 번 업로드하던 경로를 입력 동일성 검사로 제거
- 진단 근거: 모듈을 직접 호출해 그린 기준 렌더와 라이브 캔버스의 픽셀 면적 비교 (수정 전 라이브 3.6% vs 기준 15.7%, 수정 후 15.74% 동일). 같은 비교를 E2E가 정적 SVG 투영과 수행한다(WebGL 15.74% vs static 10.57%, 허용 60% 이내).

**결과**: `work/pkpilot0018/phase3-3b-surface-fixed.png` — 매끄러운 격자 면, 박스·눈금·색상 막대·실험점 정상, WebGL 오류 0.

## 3. WO-05 다중 반응 최적화

| 구성 | 내용 |
| --- | --- |
| 반응 설정 | Maximize / Minimize / Target / In Range / Ignore, Lower·Upper·Target, Weight(곡선), Importance(종합 가중) |
| 인자 설정 | Lower·Upper, Fixed(고정값) / Free, Continuous·Discrete(Step)·Categorical(수준) |
| 만족도 | Derringer–Suich, 목표별 규격 판정(최대화는 Lower 이상, 최소화는 Upper 이하, 목표·범위는 양쪽) |
| 종합 | 중요도 가중 기하평균 `D = (Π dᵢ^Iᵢ)^(1/ΣIᵢ)` — 한 반응이라도 0이면 0 |
| 탐색 | Grid / Multi-start Local Search / Bounded / Discrete·Categorical Enumeration, `mulberry32` 시드 재현, 평가·시간 예산 |
| 상태 | `optimal` · `best-found` · `no-feasible` · `invalid` · `limit` |
| 출력 | 최적 조건(설정·코딩), 반응별 예측·SE·95% CI·95% PI·만족도·규격, 종합 만족도, Top N 대안, 외삽 경고, 랭크 부족 거부 |

`ModelManager`의 `Response optimizer` 버튼이 선택한 모형들로 열린다(선택이 없으면 현재 모형 1개).

## 4. WO-06 예측 프로파일러

인자 열 × 반응 행 행렬, 인자별 슬라이더·직접 입력, 다른 인자 현재값 고정 조건부 곡선, 현재값 수직선, 규격·목표선, 신뢰/예측구간 밴드, 개별·종합 만족도, Optimize·Reset·조건 저장(출력 카드). 40 ms 디바운스, 모형별 평가기 1회 컴파일.

## 5. 독립 QA (QA-W 12건 · SciPy 기준)

| 케이스 | 검증 |
| --- | --- |
| W-01~03 | 단일/다중 반응 최적화·중요도 가중 — statsmodels 2차 적합 + SciPy `differential_evolution`→L-BFGS-B |
| W-04 | 목표값 만족도(가중 2) — 최적 인자값의 비유일성까지 명시 검증 |
| W-05 | 해석적 최적점 x=1.25, ŷ=22 |
| W-06 | 만족 해 없음 → D=0, `no-feasible` |
| W-07 | 사차 곡선의 다중 국소 최적점 |
| W-08 | 이산형 + 고정 인자 |
| W-09 | 범주형 수준 선택(대비 코딩) |
| W-10 | 랭크 부족 모형 거부 |
| W-11 | 잘못된 입력 → `invalid` + 이유 |
| W-12 | 평가 예산 초과 → 성긴 격자·최선 보고 |

허용오차 클래스 4종(`optimizer_objective` 1e-6, `optimizer_argmax` 0.005, `optimizer_prediction` 1e-3, `optimizer_coarse_grid` 2e-3)에 수치적 이유를 `qa/tolerances.json`에 기록. **Minitab 수치 동등성은 주장하지 않는다** — 검증 대상은 문서화된 Derringer–Suich 정의와 SciPy 기준 최적화다.

## 6. 산출물

- 코드: `src/lib/optimizationTypes.ts`, `desirability.ts`, `optimizer.ts`, `profiler.ts`, `src/components/ResponseOptimizer.tsx`, `PredictionProfiler.tsx`, `surfaceGl.ts`(수정), `Surface3DView.tsx`(수정), `App.tsx`·`ModelManager.tsx`(연동), `styles/app.css`
- 테스트: `tests/optimizer.test.ts`(28), `tests/profiler.test.ts`(11), `tools/e2e_phase3_3c.cjs`(24검사)
- QA: `qa/cases/QA-W-stage3c-optimizer.json`, `qa/build_cases.py`, `qa/adapters/sigrun/cli.ts`, `qa/reference/engine.py`, `qa/tolerances.json`
- 문서: `docs/OPTIMIZER_METHODOLOGY.md`, `docs/CHART_FEATURE_GAP.md`(Stage 3C 스냅샷), 본 보고서
- 스크린샷(`work/pkpilot0018/`): `phase3-3b-surface-fixed.png`, `phase3-3c-optimizer.png`, `phase3-3c-profiler.png`, `phase3-3c-manager.png`, `phase3-3c-optimizer-window.png`, `phase3-3c-profiler-window.png`, `phase3-3c-surface-page.png`, `phase3-3c-regression.png`, `phase3-3c-report.json`
