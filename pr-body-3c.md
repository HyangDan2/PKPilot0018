## 요약

Stage 3B 3D Surface의 WebGL 메시 렌더링 결함을 원인 규명 후 수정하고, Stage 3C(WO-05 다중 반응 최적화 · WO-06 예측 프로파일러)를 구현·검증했습니다.

## 1. 3D Surface 결함 수정 (긴급 선행)

**원인**: `surfaceGl.setGeometry`가 정점 버퍼와 **인덱스 버퍼를 모두 `ARRAY_BUFFER` 대상으로 재업로드**했습니다. WebGL 1은 버퍼 객체가 한 번 결합된 대상에 묶이므로(다른 대상으로 `bindBuffer` → `INVALID_OPERATION`), `ELEMENT_ARRAY_BUFFER`로 만들어진 인덱스 버퍼에 대한 `bufferData`가 조용히 실패하고 데이터가 **정점 버퍼에 덮어써졌습니다**. 그 결과 위치 버퍼가 인덱스 정수로 채워져 표면이 한 점으로 수렴하는 톱니·부채꼴로 그려졌습니다.

- 정점은 `ARRAY_BUFFER`, 인덱스는 `ELEMENT_ARRAY_BUFFER`로 올리도록 분리하고 업로드 결과를 `getError()`로 확인해 실패 시 정적 투영으로 폴백
- 마운트 시 같은 지오메트리를 두 번 올리던 경로를 입력 동일성 검사로 제거
- 회귀 검증: `tools/e2e_phase3_3c.cjs`가 WebGL 캔버스 픽셀 면적을 같은 카드의 정적 SVG 투영과 비교 (15.74% vs 10.57%, 수정 전 상태는 3.6%)

## 2. WO-05 다중 반응 최적화

- `desirability.ts`: Derringer–Suich 개별 만족도 (Maximize/Minimize/Target/In Range/Ignore), **Weight(곡선 모양)와 Importance(종합 비중) 분리**, 목표별 규격 판정
- `optimizer.ts`: 중요도 가중 기하평균 종합 만족도, 격자 탐색 · 다중 시작 국소 탐색 · 경계 최적화 · 이산/범주 전수 열거, `mulberry32` 시드 재현성(같은 시드 → 평가 횟수까지 동일), 평가/시간 예산, `optimal`/`best-found`/`no-feasible`/`invalid`/`limit` 상태, Top N 대안, 신뢰·예측구간, 외삽 경고, 랭크 부족 모형 거부
- `ResponseOptimizer.tsx`: 반응별 목표·한계·가중·중요도, 인자별 범위·간격·고정·유형, 탐색 설정, 결과 표(조건·예측·구간·만족도·규격·대안), 출력 카드 추가, 프로파일러 열기
- `ModelManager`의 `Response optimizer` 버튼 활성화·연동

## 3. WO-06 예측 프로파일러

- `profiler.ts` + `PredictionProfiler.tsx`: (반응 × 인자) 행렬, 인자별 슬라이더·직접 입력, 현재값 수직선, 규격선·목표선, 조건부 곡선(다른 인자 현재값 고정), 신뢰/예측구간 밴드, 개별·종합 만족도, Optimize·Reset·조건 저장, 40 ms 디바운스와 모형별 1회 컴파일

## 4. 검증

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm test` | **835 / 835 PASS** (신규 40: 최적화 29 · 프로파일러 11) |
| `npm run qa:stats` | **180 / 180 PASS, 0 FAIL** (QA-W 12건 추가: SciPy `differential_evolution`+L-BFGS-B 독립 비교, 해석적 최적점, 다중 국소 최적점, 이산/범주/고정, 만족 해 없음, 랭크 부족, 잘못된 입력, 예산) |
| `npm run build` | 성공 (외부 CDN 없음) |
| `tools/e2e_phase3_3c.cjs` | **24 / 24 PASS** (3D 표면 정합·WebGL 오류 0, 최적화 흐름, 프로파일러 슬라이더/수직선/Optimize/Reset/저장, 기존 등고선 회귀) |
| 문서 | `docs/OPTIMIZER_METHODOLOGY.md` 신규, `docs/CHART_FEATURE_GAP.md` Stage 3C 스냅샷 (`tests/gap-doc.test.ts` 6건 유지) |

허용오차는 결과 확인 전에 클래스별 수치적 이유와 함께 `qa/tolerances.json`에 기록했습니다(`optimizer_objective`, `optimizer_argmax`, `optimizer_prediction`, `optimizer_coarse_grid`). Minitab 수치 동등성은 주장하지 않습니다.
