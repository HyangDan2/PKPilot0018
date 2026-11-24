# Sigrún ↔ Minitab · OriginLab 차트 기능 격차 감사 (Phase 1 → Stage 3E)

> **대상**: `HD2Lab Sigrún` — 브라우저에서만 도는 통계·품질 워크스페이스 (`repos/PKPilot0018`)
> **기준 커밋**: `ee1dafe` 위 Phase 1 차트 엔진 작업 (`src/lib/chartConfig.ts`, `chartStyles.ts`, `contour.ts`, `charts.ts`, `doe.ts`, `stats.ts`)
> **감사 범위**: Minitab의 Graph Editing · Scale Editing · Contour Plot · Surface Plot, OriginLab의 Plot Details · Axis Dialog · Colormap/Contour
> **감사 방법**: 각 대화상자 항목을 실제 심볼과 1:1로 대조하고, 공식 도움말 링크를 행마다 붙였다. 모든 `SUPPORTED` 행은 `tests/chart-config.test.ts`, `tests/contour-geometry.test.ts`, `tests/rsm-model.test.ts`, `tests/regression-bands.test.ts` 와 Stage 3D의 `tests/axis-advanced.test.ts`, `tests/contour-styles.test.ts`, `tests/error-bars.test.ts`, `tests/graph-layout.test.ts` 중 하나 이상이 검증한다. 인용한 심볼이 `src/`에 실제로 있는지는 `tests/gap-doc.test.ts`가 매 실행마다 확인한다.
> **분류**: `SUPPORTED` 구현·검증됨 / `PARTIAL` 일부만 / `MISSING` 없음 / `DIFFERENT` 다른 방식 / `UNKNOWN` 미확인
> **공수**: S 0.5일 이하 · M 1–2일 · L 3일 이상

## 검증 스냅샷 (2026-11-24, Stage 3E — 릴리스 자격 확인)

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm test` | **1 001 / 1 001 PASS** (44 파일) |
| `npm run qa:stats` | **225 / 225 PASS** · FAIL 0 · REVIEW 0 · UNVERIFIED 0 · ERROR 0 |
| `npm run build` | 성공 — `dist/assets/index-I4-C1lpF.js` 1 196 430 B (라이브와 바이트 동일) |
| `npm run build:portable` | 성공 — 단일 HTML 1 265 202 B · ZIP 367 915 B |
| Portable `file://` 오프라인 | `tools/e2e_portable_offline.cjs` **63 / 63 PASS**, 네트워크 시도 0건 |
| Phase 1/2/3 브라우저 회귀 | `tools/run_e2e_suite.cjs` — stage1 77 · stage2 37 · stage3 176 · ui_compact 63 · followup(svg 39) · chart_axes 6 · chart_upgrade 34 · 3A 29 · 3B 41 · 3B교정 13 · 3C 24 · 3D 49 = **549 PASS / 0 FAIL** |
| 라이브 스모크 | 3D **49 / 49**, 3C **24 / 24** (`BASE=https://hyangdan2.github.io/PKPilot0018/ SERVE=0`) |
| 감사 집계 | **Stage 3E는 차트 옵션을 새로 추가하지 않았다**(릴리스 자격 확인 단계). §1 요약·§2~9 표의 분류는 Stage 3D 그대로이며 `tests/gap-doc.test.ts` 6건이 유지된다 |
| 총괄 | `docs/PHASE3_UPGRADE_REPORT.md` (성능·한계·배포 정보) |

## 검증 스냅샷 (2026-11-24, Stage 3D)

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm test` | **913 / 913 PASS** (Stage 3C 834 + Stage 3D 신규 79: 축 고급 19 · 오차 막대 11 · 등고 스타일 13 · 인터랙션 12 · 레이아웃 24) |
| `npm run qa:stats` | **186 / 186 PASS, 0 FAIL** (180 + QA-Y 6: SciPy ddof=1 표준편차·t 분위수와 오차 막대 통계량 비교) |
| `npm run build` | 성공 (외부 CDN·API 없음 — 3D 표면·등고·내보내기 모두 브라우저 내부 계산) |
| 축 고급 옵션 | 틱 개수·지정 값·보조 눈금 개수·축 생략(절단 표시), log10·ln·대칭로그·거듭제곱, 날짜/시간 축, 눈금 길이·축선·라벨 표시, 보조 축(선·산점도 계열) |
| 등고 고급 옵션 | 사용자 색상 맵(값:색 정지점), 수준별 채움 색·선 굵기·점선·라벨 표시, 라벨 글꼴·자릿수, 색상 띠 범위, Under/Overflow 색, 마스크 영역(비움·회색·빗금) |
| 계열 고급 옵션 | 영역 채우기, 드롭 라인, 오차 막대(SD·SE·양측 t CI), 계열 순서, 개별 점 스타일, 보조 축 계열 지정 |
| 오차 막대 정의 | 표본 표준편차(n−1)·표준오차(sd/√n)·양측 Student t 구간. 값이 하나뿐인 점은 막대를 그리지 않으며 폭 0으로 그려 0인 척하지 않는다. QA-Y 6건이 SciPy와 대조 |
| 그래프 레이아웃 편집기 | 분석 결과 차트 추가·드래그·리사이즈·격자 스냅·정렬/균등 배분/같은 크기·복제·레이어·실행취소, 주석 8종(텍스트·화살표·선·사각형·원·강조 영역·그림 라벨·이미지), 페이지 프리셋 7종, SVG/PNG(150·300·600 DPI)·클립보드·레이아웃 저장/복원(.sigrun.json·프로젝트) |
| 3D 패널 처리 | 3D 표면은 래스터로 합성되는 패널임을 문서(`data-raster`)와 UI가 함께 밝히고, 벡터 차트는 벡터로 남긴다 |
| 차트 인터랙션 | 상자 확대·이동·십자선·데이터 커서(←/→)·툴팁 고정·점 선택·원본 워크시트 행 강조·선택 데이터 CSV 내보내기·연동 선택(같은 시트·같은 열 쌍일 때만) |
| 행 매핑 | 결측 제거·정렬·By 그룹 분리 뒤에도 점이 자기 워크시트 행을 들고 다닌다(산점도·히스토그램 구간·상자 그림 그룹·막대 항목). 집계 요소는 포함된 원본 행 전체를 가리킨다 |
| Stage 3D E2E | `tools/e2e_phase3_3d.cjs` **49 / 49 PASS** (고급 축·등고·계열 옵션, 확대/이동/십자선/커서/고정/선택/연동/CSV, 레이아웃 편집기 전체 흐름, 3D 회귀) |

## 검증 스냅샷 (2026-11-24, Stage 3C)

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm test` | **834 / 834 PASS** (Stage 3B 795 + Stage 3C 신규 39: 최적화 28·프로파일러 11) |
| `npm run qa:stats` | **180 / 180 PASS, 0 FAIL** (168 + QA-W 12: SciPy 기준 최적화 비교) |
| `npm run build` | 성공 (외부 CDN 없음, 최적화·프로파일러 모두 브라우저 내부 계산) |
| 3D Surface 결함 | `setGeometry`가 정점/인덱스 버퍼를 `ARRAY_BUFFER`로 재업로드해 WebGL 1의 "버퍼는 한 대상에만 결합" 규칙에 걸리던 결함을 수정 — 인덱스는 `ELEMENT_ARRAY_BUFFER`, 정점은 `ARRAY_BUFFER`로 올리고 업로드 실패 시 정적 투영으로 폴백. E2E가 WebGL 픽셀 면적을 같은 카드의 정적 SVG와 비교(15.7% vs 10.6%, 깨진 상태는 3.6%) |
| 다중 반응 최적화 | Derringer–Suich 개별 만족도 + 중요도 가중 기하평균 종합 만족도. 격자·다중 시작 국소 탐색·경계 최적화·이산/범주 전수 열거, 시드 재현성(같은 시드 → 같은 평가 횟수까지 동일), 예산 초과 시 `limit`+최선 보고 |
| 예측 프로파일러 | (반응 × 인자) 행렬, 인자별 슬라이더·직접 입력, 현재값 수직선·규격선·목표선, 조건부 곡선(다른 인자 고정), 신뢰/예측구간 밴드, 개별·종합 만족도, Optimize·Reset·조건 저장, 40 ms 디바운스 |
| 최적화 독립 검증 | QA-W 12건 — statsmodels 2차 적합 + SciPy `differential_evolution`→L-BFGS-B, 해석적 최적점, 다중 국소 최적점, 이산/범주/고정, 만족 해 없음, 랭크 부족 거부, 잘못된 입력, 평가 예산. 허용오차 클래스 4종에 수치적 이유 기록 (`qa/tolerances.json`) |
| Stage 3C E2E | `tools/e2e_phase3_3c.cjs` **24 / 24 PASS** (3D 표면 정합·WebGL 오류 0, 최적화 입력/결과/대안/출력 카드, 프로파일러 슬라이더·수직선·Optimize·Reset·조건 저장, 기존 등고선 회귀) |
| 문서 | `docs/OPTIMIZER_METHODOLOGY.md` — 만족도 정의, Weight/Importance 분리, 탐색 보장 범위, 구간·외삽·랭크 부족 규칙, 독립 검증 목록과 "주장하지 않는 것" |
| 감사 집계 | §1 요약·구역별 분류는 차트 기능(Phase 1~2) 기준이라 Stage 3C에서 바뀌지 않음. 최적화·프로파일러는 차트 옵션이 아니라 모형 사용 계층이므로 별도 방법론 문서에서 다룬다 (`tests/gap-doc.test.ts` 6건 유지) |

## 검증 스냅샷 (2026-11-24, Stage 3B)

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm test` | **795 / 795 PASS** (Stage 3A 749 + Stage 3B 신규 46) |
| `npm run qa:stats` | **168 / 168 PASS, 0 FAIL** (Stage 3A 162 + QA-V 6) |
| `npm run build` | 성공 (외부 CDN 없음, WebGL 셰이더·색상 맵 모두 로컬) |
| 3D ↔ 2D 정합 | 같은 저장 모형을 컴파일 평가기(3D)와 행별 설계행렬(2D)로 계산해 노드별 최대차 ≤1e-10, QA-V-01/02는 차이 0을 `exact_zero`로 강제 |
| 표면 상한 | Ultra 401×401 = 160 801 정점, 정점 버퍼 5.8 MB · 인덱스 3.8 MB, 생성 4 s 이내(테스트가 측정) |
| 만족 영역 | 두 반응 규격을 21×21 격자에서 동시 판정, 격자 비율과 4배 격자 구적의 차이 ≤0.02, 수렴도 |Δ(2배 격자)|를 값으로 보고 (`tests/feasible.test.ts` 15건) |
| 구간 기준 | 공분산 없는 모형은 `intervalBlocked`로 이름을 밝히고 기준을 비활성, 신뢰구간 ≥ 예측구간 제약을 테스트가 확인 |
| 감사 집계 | 구역별 분류 집계가 §1 요약과 일치, 인용 심볼이 `src/`에 존재 (`tests/gap-doc.test.ts` 6건) |

## 검증 스냅샷 (2026-11-24, Phase 3A)

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm test` | **749 / 749 PASS** (Phase 2 661 + Stage 3A 신규 88) |
| `npm run qa:stats` | **162 / 162 PASS, 0 FAIL** (기존 156 + 저장 모형 6) |
| `npm run build` | 성공 (외부 CDN 없음) |
| PNG DPI | `pHYs` 청크 바이트 단위 검증 — 150/300/600 DPI = 5906/11811/23622 px/m, CRC-32 재계산, 중복 `pHYs` 교체 (`tests/png-dpi.test.ts` 8건) |
| Filled contour 정합성 | 평면·포물면·안장·상호작용·기울어진 안장 × 5/6/11/21 격자에서 밴드 면적 합 = 정의역 (오차 ≤ 1e-9), 밴드 꼭짓점이 자기 구간을 벗어나지 않음, 모든 등고선이 밴드 경계 위 (≤ 1.8e-12) (`tests/contour-bands.test.ts` 7건) |
| 설정 가드 | NaN·Infinity·역전 범위·0 눈금 간격·알 수 없는 enum이 렌더 좌표에 도달하지 않음 (`tests/chart-guards.test.ts` 12건) |
| 재실행 보존 | 스타일·축·RSM 뷰가 재실행 카드에 유지되고, 차트 삽입 시에도 항목별로 짝지어짐 (`tests/chart-memory.test.ts` 11건) |
| 저장 모형 | 회귀·GLM·DOE·RSM 적합을 저장/이름변경/복제/삭제/비교/재적합, Coded↔Actual 예측, 랭크 부족 거부 (`tests/model-store.test.ts` 30건) |
| 감사 집계 | 이 문서의 구역별 분류 집계가 §1 요약과 일치하고, 인용한 모든 코드 심볼이 `src/`에 존재함을 테스트가 확인 (`tests/gap-doc.test.ts` 6건) |

## 검증 스냅샷 (2026-11-24, Phase 2)

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm test` | **661 / 661 PASS** (Phase 1 635 + Phase 2 신규 26) |
| `npm run qa:stats` | **156 / 156 PASS, 0 FAIL** |
| `npm run build` | 성공 (201 modules, gzip JS 262.55 kB, 외부 CDN 없음) |
| 콘투어 벤치마크 | 41: 4.7–8.5 ms · **101: 19.7–30.2 ms** · 201: 33.9–50.7 ms · 401: 92.7–100.9 ms (5회 중앙값, 560×300, filled-lines 10밴드) / 출력 57,935 · 135,063 · 263,130 · 519,965 B |
| 브라우저 실측 (E2E) | 41: 521 ms · 101: 482 ms · 201: 555 ms · **401: 702 ms** (드로어에서 해상도 전환 후 SVG 재생성, Playwright 4190 포트) |
| Phase 2 E2E | `tools/e2e_chart_upgrade.cjs` **36 / 36 PASS** (데스크톱 1440×900 + 모바일 390×844, 기준선 빌드 없이 34) |
| 기존 E2E 회귀 | `e2e_chart_axes.cjs` 6/6 · `e2e_stage3.cjs` 176/176 PASS |

벤치마크 재현: `PATH="/workspace/node/bin:$PATH" node_modules/.bin/vite-node tools/contour_benchmark.ts` (560×300 SVG, filled-lines 10밴드, 1회 워밍업 + 5회 중앙값).
**기본 해상도 결정: `standard` = 101×101.** 201×201은 1.4배 시간에 2배 바이트지만 560 px 플롯에서 셀당 2.8 px로 육안 차이가 거의 없고, 101은 셀당 5.5 px로 등고선이 매끄럽다. `high`/`ultra`는 사용자가 명시할 때만 쓴다.

---

## 1. 요약
| 영역 | 항목 | SUPPORTED | PARTIAL | MISSING | DIFFERENT | P1 | P2 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Minitab — 그래프 편집 (Edit Graph) | 8 | 7 | 1 | 0 | 0 | 4 | 4 |
| Minitab — 축·눈금 편집 (Scale Editing) | 14 | 14 | 0 | 0 | 0 | 3 | 11 |
| Minitab — Contour Plot | 16 | 15 | 0 | 0 | 1 | 7 | 9 |
| Minitab — Surface Plot | 5 | 4 | 1 | 0 | 0 | 2 | 3 |
| OriginLab — Plot Details | 12 | 9 | 3 | 0 | 0 | 6 | 6 |
| OriginLab — Axis Dialog | 11 | 10 | 1 | 0 | 0 | 2 | 9 |
| OriginLab — Colormap / Contour | 11 | 7 | 1 | 3 | 0 | 5 | 6 |
| **합계** | **77** | **66** | **7** | **3** | **1** | **29** | **48** |

- **P0(정확성) 격차 없음.** Phase 1 [P0] 항목 — 등고선 16-case·안장 판정, 렌더 컨텍스트 격리, 축 정밀도, XML 이스케이프 — 은 모두 구현·검증됐다.
- Stage 3D에서 **SUPPORTED 66 / PARTIAL 7 / MISSING 3 / DIFFERENT 1**로 올라섰다(Phase 2: 39 / 23 / 8 / 1). 축 눈금·변환·생략·보조 축, 등고 수준별 색·선·라벨·마스크·색상 맵, 계열 영역/드롭라인/오차 막대/개별 점, 주석·도형·자유 배치는 이제 모두 화면에서 편집되고 테스트가 검증한다.
- 남은 **MISSING 3건**은 범례 쪽 수준별 세부(3색 혼합의 한계 밖 항목)와 데이터 기반 경계 마스크, 그리고 그리드 라인·삼각분할 표시다. **PARTIAL 7건**은 여백 드래그, 채우기 패턴·투명도, 라벨 서식, 레이어 축 그룹처럼 Minitab/Origin이 대화상자 안에서만 하는 세부 조작이다.
- **DIFFERENT 1건**은 등고선 메쉬 보간 방식이다. Minitab은 방식을 고르게 하지만 Sigrún은 쌍선형 Marching Squares + 점근 판정기로 고정한다 — 결과가 해석적으로 정확한 쪽을 택했다.
- **오차 막대는 정의된 통계량만 그린다**: 반복값이 없는 점에는 막대를 그리지 않고, QA-Y가 SciPy의 `std(ddof=1)`·`t.ppf`와 대조한다. Minitab의 화면 기본값과 수치 동등성은 주장하지 않는다(입력이 다르면 결과도 다르다).

---

## 2. Minitab — 그래프 편집 (Edit Graph)

공식: [Edit graphs](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-editing-basics/edit-graphs/)

| 항목 | Minitab | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 | 공수 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 그래프 편집 대화상자 | 그래프 더블클릭 → Options pane → Edit Graph | 더블클릭 → 7탭 속성 드로어(일반·축·계열·스타일·참조선·범례·내보내기), 실시간 미리보기·적용/취소·실행취소 | SUPPORTED | `ChartPropertiesDrawer.tsx`, `chartConfigOps.ts` | 위 링크 | P1 | S |
| 제목·부제 | 제목/부제 텍스트·위치 | `appearance.title` / `subtitle`, `chart-title` 그룹 | SUPPORTED | `titleBlock()` (`charts.ts`), `ChartAppearance` | 위 링크 | P1 | S |
| 글꼴·크기 | 글꼴·스타일·색 | `fontFamily`, `fontSize`, 프리셋별 서체 | SUPPORTED | `resolveChartStyle()` (`chartStyles.ts`) | 위 링크 | P2 | S |
| 배경·플롯 색 | 그래프/데이터 영역 채우기 | `chartBg`, `plotBg`, 프리셋 7종 | SUPPORTED | `background()`, `plotBackground()` | [Edit Background](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-editing-basics/edit-graphs/) | P2 | S |
| 여백·크기 | 그래프 크기·여백 드래그 | `width`/`height`/`aspectRatio`/`margins` — 명시할 때만 적용 | PARTIAL | `createContext()`, `ctx.rawConfig.appearance?.margins` | 위 링크 | P2 | S |
| 주석·도형·텍스트 상자 | 자유 주석, 선·화살표·사각형 | Graph Layout Editor의 주석 도구 — 텍스트 상자, 화살표, 선, 사각형, 원, 강조 영역, 그림 라벨 `(a)(b)(c)`, 로컬 이미지/데이터 URL 삽입 | SUPPORTED | `GraphLayoutEditor.tsx`, `graphLayout.ts` (`addPanel`) | 위 링크 | P2 | M |
| 다중 그래프 배치 | 그래프 여러 개 배치·정렬 | 레이아웃 편집기에서 분석 결과 차트를 페이지에 자유 배치, 드래그·리사이즈·격자 스냅, 정렬 6종·균등 배분·같은 크기·복제·레이어 순서·실행취소, 페이지 프리셋 7종(A4·16:9·4:3·단단·양단·사용자) | SUPPORTED | `layoutSvg()`, `alignPanels()`, `PAGE_PRESETS` | 위 링크 | P1 | M |
| 그래프 파일 저장 | Save Graph As (PNG/JPG/…) | Export 탭에서 SVG/PNG, 150/300/600 DPI, mm·in×DPI→픽셀, 투명/흰색/현재 배경, 제목·범례 포함 여부, 단일 내려받기·클립보드 복사·카드 전체 일괄 내보내기 | SUPPORTED | `chartExport.ts`, `ChartPropertiesDrawer.tsx` | [Save graphs](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-editing-basics/edit-graphs/) | P1 | S |

---

## 3. Minitab — 축·눈금 편집 (Scale Editing)

공식: [Continuous scale](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-framework-and-scale/continuous-scale/) · [Transform scale](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-framework-and-scale/transform-scale/) · [Secondary scale](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-framework-and-scale/secondary-scale/)

| 항목 | Minitab | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 | 공수 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 축 범위 자동/수동 | Auto 해제 후 Min/Max 입력 | `AxisConfig.min/max/autoRange`, `axisMargin` | SUPPORTED | `makeAxis()` (`charts.ts`) | [Change scale range](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-framework-and-scale/continuous-scale/) | P2 | S |
| 주 눈금 위치 | 자동 / 개수 / 값 목록(`5:30/5`) | `majorInterval`, `tickCount`(2–20), `tickValues`(값 목록) | SUPPORTED | `axisTicks()` (`charts.ts`), `AxisConfig.tickCount` | 위 링크 | P1 | S |
| 보조 눈금 개수 | 주 눈금 사이 개수 | `minorTickCount`(주 눈금 사이 개수), `minorInterval`, 보조 눈금 표시 | SUPPORTED | `minorTickValues()` (`axisAdvanced.ts`), `drawAxes()` | 위 링크 | P2 | S |
| 눈금 라벨 서식 | 자릿수·과학 표기·날짜 | `decimals`/`scientific`/`thousandsSep` + 정밀도 자동 상향 | SUPPORTED | `formatTickValue()` + `computeAxisTicks()` | [Change tick labels](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-framework-and-scale/continuous-scale/) | P1 | S |
| 축 반전 | Reverse | `reverse` (tick·데이터 동시 반전) | SUPPORTED | `makeAxis({ reverse })` | 위 링크 | P2 | S |
| 로그·거듭제곱 변환 | Logarithm / Power | `log10`, `ln`, 대칭로그(`symlog`, 0·음수 허용), 거듭제곱(`power`, 지수 지정) | SUPPORTED | `mapScaleValue()`, `buildAxisMap()` (`axisAdvanced.ts`), `AxisScale` | [Transform scale](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-framework-and-scale/transform-scale/) | P2 | M |
| 보조 축 | 같은 그래프에 두 번째 Y축 | `secondarySeries`로 계열을 오른쪽 눈금에 그리고, 보조 축 제목·단위·범위·자릿수·격자를 따로 지정 (선·산점도) | SUPPORTED | `SecondaryAxisConfig`, `drawLine()` y2Axis, `SeriesAdvancedConfig` | [Secondary scale](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-framework-and-scale/secondary-scale/) | P1 | M |
| 축 표시 요소 | 축선·라벨·눈금 표시/숨김 | `showAxisLine`·`showTickLabels`·`showMajorGrid`·`showMinorGrid` | SUPPORTED | `drawAxes()` (`charts.ts`), `AxisConfig.showAxisLine` | [Continuous scale](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-framework-and-scale/continuous-scale/) | P2 | S |
| 눈금 방향·길이 | 방향·길이·굵기 | `tickDirection`(in/out/both/none), `tickLength`(px), 축선 굵기 `borderWidth` | SUPPORTED | `AxisConfig.tickLength`, `ResolvedChartStyle.tickLength` | 위 링크 | P2 | S |
| 축 교차 위치 | 0 또는 지정 값에서 교차 | `crossAt`: `'auto'` / `'zero'` / 지정 값 | SUPPORTED | `axisLinePixel()` | 위 링크 | P2 | S |
| 범주 축 순서 | 범주 순서·정렬 지정 | `categoryOrder` (Pareto/Bar) | SUPPORTED | `drawPareto()` | [Categorical scale](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-framework-and-scale/categorical-scale/) | P2 | S |
| 축 제목·단위 | 제목/단위/글꼴 | `title` + `unit` → `제목 (단위)` | SUPPORTED | `drawAxes()` titles | 위 링크 | P2 | S |
| 날짜·시간 축 | Date/Time scale | `dateAxis{epoch,unit,format}` — 값은 기준 시각부터의 일·주·월·년 개수, 라벨은 UTC 달력 날짜 | SUPPORTED | `DateAxisConfig`, `dateTickValues()` (`axisAdvanced.ts`) | 위 링크 | P2 | S |
| 축 생략 표시 | Broken axis marks | 생략 구간 폭(px)만큼 틈을 두고 절단 표시 2개, 그 구간 눈금 제외 | SUPPORTED | `buildAxisMap()`, `insideBreak()` | 위 링크 | P2 | S |

> **정밀도 규칙 (WO-11)**: 눈금 라벨은 값의 크기와 *눈금 간격*을 함께 본다. `1.2e-6 … 1.8e-6`은 `1.2e-6` 꼴로, `1000000.001 … 1000000.005`는 소수 셋째 자리를 유지하며, `M` 약어는 간격도 10⁵ 이상일 때만 쓴다. 라벨이 겹치면 자릿수를 올려 고유하게 만들고, 눈금은 최대 64개로 제한한다 (`computeAxisTicks`).

---

## 4. Minitab — Contour Plot

공식: [Contour display options](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/display-options/contour-plot/) · [Contour levels, areas, lines and labels](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/display-options/contour-levels-areas-lines-and-labels/) · [Specify settings](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/using-fitted-models/how-to/contour-plot/perform-the-analysis/specify-settings/) · [Define contour values](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/using-fitted-models/how-to/contour-plot/perform-the-analysis/define-the-contour-values/) · [Default options](https://support.minitab.com/en-us/minitab/help-and-how-to/minitab-environment/settings-and-defaults/individual-graphs/contour-plots/options/)

| 항목 | Minitab | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 | 공수 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 면 / 선 / 기호 표시 | Area, Contour lines, Symbols | `renderMode`: lines·filled·filled-lines·heatmap(continuous/discrete), `showPoints` | SUPPORTED | `drawContour()` (`charts.ts`), `ContourRenderMode` | [Display options](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/display-options/contour-plot/) | P1 | S |
| 등고 수준 자동/개수/값 | Automatic / Number(2–11) / Values | `levelMode`: auto·manual(간격)·custom(값 목록) | SUPPORTED | `computeContourLevels()` (`contour.ts`) | [Levels](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/display-options/contour-levels-areas-lines-and-labels/) | P1 | S |
| 수준 최대 개수 | 2–11 | 2–50 (기본 10) | SUPPORTED | `computeContourLevels` 상한 50 | [Define contour values](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/using-fitted-models/how-to/contour-plot/perform-the-analysis/define-the-contour-values/) | P2 | S |
| 영역 색 | Spectrum / 1색·2색 램프 | 지각 균일 9 팔레트 + 사용자 색상 맵(`customStops`, 값·색 지점 2–20개 선형 보간) | SUPPORTED | `COLORMAPS`, `contourBandFill()`, `sampleCustomStops()` | [Area colours](https://support.minitab.com/en-us/minitab/help-and-how-to/minitab-environment/settings-and-defaults/individual-graphs/contour-plots/options/) | P1 | S |
| 수준별 개별 색 | Custom colors per area | `levelStyles[index].color` — 밴드별 채움 색이 팔레트·사용자 맵보다 먼저 적용 | SUPPORTED | `ContourLevelStyle`, `contourBandFill()` | 위 링크 | P2 | M |
| 등고선 라벨 | Show / No labels / 글꼴 | `showContourLabels` + 수준별 `showLabel`, `labelFontSize`, `labelDecimals` | SUPPORTED | `drawContour()` label 루프, `ContourConfig.labelFontSize` | [Contour labels](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/display-options/contour-levels-areas-lines-and-labels/) | P2 | S |
| 등고선 속성 | 자동/검정/변형/사용자 지정 | 전역 `lineWidth`·`lineColor`, 수준별 `lineWidth`·`lineDash`·`lineColor`, 목표 수준 강조 | SUPPORTED | `ContourConfig`, `contourLineLook()` (`charts.ts`) | 위 링크 | P2 | M |
| 메쉬 보간 방식 | Mesh 방법 선택 | 쌍선형 + 점근 판정기 고정 (선택 불가) | DIFFERENT | `marchingSquares()`, `saddleValue()` | [Mesh](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/display-options/contour-levels-areas-lines-and-labels/) | P2 | S |
| 다른 요인 고정값 | Hold continuous/categorical at | `RsmViewConfig.holdingValues` (coded) | SUPPORTED | `rsmPredictSurface()` (`doe.ts`) | [Specify settings](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/using-fitted-models/how-to/contour-plot/perform-the-analysis/specify-settings/) | P1 | S |
| Coded / Uncoded 단위 | 요인 단위 전환 | `unitMode`, `actualTransform` | SUPPORTED | `RsmViewConfig`, `codedToActual()` | 위 링크 | P1 | S |
| Z 최소/최대 | Z 범위 지정 | `zMin` / `zMax` (컬러바·밴드 동시) | SUPPORTED | `computeContourLevels()` | [Define contour values](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/using-fitted-models/how-to/contour-plot/perform-the-analysis/define-the-contour-values/) | P1 | S |
| 스펙 영역·목표값 | Overlaid contour의 feasible region | 축 눈금 ▸ Z 탭에서 목표값·허용폭·LSL/USL·만족 영역 음영을 직접 편집 | SUPPORTED | `ContourConfig`, `drawContour()`, `ChartPropertiesDrawer` | 위 링크 | P1 | S |
| 다중 응답 오버레이 | Overlaid Contour Plot | 저장 모형 복수 선택 → 공통 요인 격자에서 반응별 규격 판정, 동시 만족 영역(Feasible Region), 반응별 영역·경계선·범례, Feasible Area Ratio, 예측 평균/신뢰구간/예측구간 기준 전환 | SUPPORTED | `buildOverlaid()`, `drawOverlaid()`, `FeasibleConfig`, `commonNumericFactors()` | [Overlaid contour](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/using-fitted-models/how-to/contour-plot/before-you-start/overview/) | P2 | M |
| 해상도(격자) | (없음) | 41/101/201/401 프리셋 | SUPPORTED | `CONTOUR_RESOLUTIONS`, `resolutionPoints()` | — | P2 | S |
| Under/Overflow 색 | 범위 밖 영역 색 | `underflowColor`(최저 밴드), `overflowColor`(최고 밴드) | SUPPORTED | `contourBandFill()`, `ContourConfig.underflowColor` | 위 링크 | P2 | S |
| 마스크 영역 표시 | (없음) | NaN 격자 셀을 `maskedStyle`(비움·회색·빗금)로 표시, 등고선은 마스크를 통과하지 않음 | SUPPORTED | `maskedRegion()` (`charts.ts`), `MaskedRegionStyle` | — | P2 | S |

> **기하 검증**: `tests/contour-geometry.test.ts` 가 해석적 평면 `Z = X + Y`, 포물면 `Z = X² + Y²`, 안장 `Z = X² − Y²`, 상호작용 `Z = XY`, 상수면, NaN 마스크를 정확해와 대조한다. 16개 케이스 전부와 두 안장 케이스의 두 선분, 꼭짓점 접점의 결정론적 처리도 포함한다.

> **Stage 3A (WO-01/8) — Filled Contour 정합성**: 밴드 폴리곤이 셀 사각형을 선형으로만 잘라내던 방식은 **안장 셀에서 이웃 밴드와 겹쳤다**(최대 셀 면적의 100%, 정의역의 5.5%). 이제 밴드는 등고선과 **같은 `saddleValue` 판정과 같은 교차점**으로 셀을 분해하고(안장이면 두 조각), 두 임계값이 모두 평범하면 기존 이중 클리핑을 쓴다. 하한을 strict로 잘라 값이 정확히 경계인 셀이 두 밴드에 동시에 속하지 않게 했고, 평평한 셀은 `break`로 한 밴드만 차지한다. 결과: 평면·포물면·안장·상호작용·기울어진 안장 × 5/6/11/21 격자에서 밴드 면적 합 = 정의역(오차 ≤ 1e-9), 밴드 꼭짓점이 자기 구간을 벗어나지 않음(0), 모든 등고선이 밴드 경계 위(≤ 1.8e-12). 검증은 `tests/contour-bands.test.ts`.

---

## 5. Minitab — Surface Plot

공식: [3D Surface Plot overview](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/3d-surface-plot/before-you-start/overview/) · [Surface Plot (fitted model)](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/using-fitted-models/how-to/surface-plot/before-you-start/overview/) · [Contour vs 3D surface](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/using-fitted-models/supporting-topics/graphs/contour-plots-and-3d-surface-plots/)

| 항목 | Minitab | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 | 공수 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3D Surface Plot | 매끈한 3D 곡면 | 저장 모형 → `surface3d` 차트, WebGL 캔버스(로컬 번들), 표면/와이어프레임/둘 다, 컬러바, Z 배율, Coded/Actual, 고정값, 실험점·정지점·최적점 | SUPPORTED | `drawSurface()`, `buildSurfaceGeometry()`, `SurfaceViewConfig` | [Overview](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/3d-surface-plot/before-you-start/overview/) | P1 | L |
| 3D Wireframe | 격자 와이어프레임 | `renderMode: wireframe` (메쉬 간격·선 두께 조절) | SUPPORTED | `SurfaceViewConfig`, `buildSurfaceGeometry()` | 위 링크 | P2 | S |
| 회전·조명·시점 | 마우스 회전, 조명 | 드래그 회전·휠 줌·Pan·터치 제스처, Top/Front/Side/Isometric, Perspective/Orthographic, 광원 방위·고도·주변광·확산광, 카메라 초기화 | SUPPORTED | `Surface3DView`, `cameraBasis()`, `cameraMatrix()` | 위 링크 | P2 | L |
| 메쉬·보간 | Mesh 설정 | 메쉬 밀도·선 두께·불투명도·바닥 등고선 투영은 편집 가능, 보간 방식(쌍선형 고정)은 선택 불가 | PARTIAL | `SurfaceViewConfig.meshDensity`, `buildSurfaceGeometry()` | 위 링크 | P2 | M |
| 저장된 모형 표면 | Stored model → surface | 모형 관리자에서 3D 표면 진입(활성), 드로어에서 요인 쌍·고정값·범위·단위 재슬라이스, 실험점·정지점 표시 | SUPPORTED | `materializeSurface()`, `buildModelSurface()`, `RsmModelPayload` | [Surface Plot](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/using-fitted-models/how-to/surface-plot/before-you-start/overview/) | P1 | M |

> **Stage 3B 구현** — 3D 표면은 WebGL(로컬 셰이더, 외부 CDN 없음)로 그리고, 같은 기하를 SVG 정사영으로도 그린다. WebGL을 쓸 수 없는 환경(헤드리스·소프트웨어 폴백·컨텍스트 상실)에서는 자동으로 정사영으로 넘어가고 화면에 그 사실을 안내한다. 내보내기(SVG/PNG/인쇄)는 항상 정사영 경로를 쓴다. 해상도 Draft 41 / Standard 101 / High 201 / Ultra 401이며 401 격자는 160 801 정점·약 10 MB로 상한이다. `tests/surface3d.test.ts`가 2D 등고선과 노드별 일치(≤1e-10)·초고해상도 격자 생성 시간·카메라 행렬과 투영 함수의 일치를 검증한다.

---

## 6. OriginLab — Plot Details

공식: [Plot Details controls](https://docs.originlab.com/origin-help/plot-details-controls/)

| 항목 | Origin | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 | 공수 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 선 색·굵기·스타일 | Line 탭 | `SeriesStyle` + `perSeries` | SUPPORTED | `ChartConfig.series`, `seriesColor()` | [Plot Details](https://docs.originlab.com/origin-help/plot-details-controls/) | P1 | S |
| 마커 모양·크기 | Symbol 탭 | 6종(circle/square/triangle/diamond/cross/none) | SUPPORTED | `MarkerShape`, `marker()` | 위 링크 | P1 | S |
| 계열별 개별 설정 | Individual series | `perSeries: Record<number, …>` (색·선·마커·표시) | SUPPORTED | `SeriesStyle.perSeries` | 위 링크 | P1 | S |
| 채우기 패턴·투명도 | Pattern / Transparency | `fillOpacity` 전역, 패턴 없음 | PARTIAL | `SeriesStyle.fillOpacity` | 위 링크 | P2 | M |
| 드롭라인·영역 채우기 | Drop Lines / Fill Area | `seriesAdvanced.areaFill`·`areaOpacity`, `dropLines`·`dropLineColor`·`dropLineDash` (선·시계열 차트) | SUPPORTED | `SeriesAdvancedConfig`, `drawLine()`, `drawTimeseries()` | 위 링크 | P2 | M |
| 데이터 라벨 | Label 탭 | `showDataLabels` (scatter/line/bar/SPC) | SUPPORTED | `ScatterOptions`, `LineBarParetoOptions` | 위 링크 | P1 | S |
| 라벨 서식·위치 | 폰트·회전·오프셋 | 값만 표시, 서식 없음 | PARTIAL | `drawScatter()` label 루프 | 위 링크 | P2 | S |
| 레이어·축 그룹 | Multi-layer, axis grouping | 블록 단위 다중 차트만 | PARTIAL | `chartgrid` | 위 링크 | P2 | L |
| 보조 축 계열 | Right Y axis | `seriesAdvanced.secondarySeries` — 계열 인덱스로 오른쪽 눈금 배정(선·산점도) | SUPPORTED | `SeriesAdvancedConfig.secondarySeries`, `drawScatter()` y2Axis | 위 링크 | P1 | M |
| 테마 일괄 적용 | Theme / Format 복사 | 7 프리셋 + 사용자 스타일 + 레이아웃 전체 통일(`unifyChartStyle`) | SUPPORTED | `CHART_STYLE_PRESETS`, `saveCustomStyle()`, `unifyChartStyle()` | 위 링크 | P1 | S |
| 오차 막대 | Error Bars | `errorBars{kind,scope,conf,capWidth}` — SD·SE·양측 t 신뢰구간, 점별 반복값 또는 계열 전체 기준 | SUPPORTED | `errorBarFor()` (`seriesStats.ts`), `ErrorBarConfig` | 위 링크 | P2 | M |
| 개별 점 스타일 | Individual point | `pointStyles[index]{shape,size,color}` — 그리는 순서로 한 점만 바꾼다 | SUPPORTED | `SeriesAdvancedConfig.pointStyles`, `pointLook()` | 위 링크 | P2 | S |

---

## 7. OriginLab — Axis Dialog

공식: [Axis Dialog](https://docs.originlab.com/origin-help/general-axis-dialog/) · [Scale tab](https://docs.originlab.com/origin-help/axesref-scale/)

| 항목 | Origin | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 | 공수 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| From / To / Rescale | 수동 범위, Rescale 모드 | `min`/`max`/`autoRange`/`axisMargin` | SUPPORTED | `AxisConfig`, `makeAxis()` | [Scale tab](https://docs.originlab.com/origin-help/axesref-scale/) | P1 | S |
| Scale Type | Linear·Log10·Probability·Probit·ln·log2·Custom… | Linear·Log10·ln·대칭로그·거듭제곱 (확률·Probit 축은 확률 플롯 전용) | SUPPORTED | `AxisScale`, `mapScaleValue()` | [Scale tab](https://docs.originlab.com/origin-help/axesref-scale/) | P2 | M |
| Symmetrical Log | 음수 허용 로그 | `symlog`: sign(x)·log10(1+abs(x)/C), 상수 C 지정, 0·음수도 유한 좌표 | SUPPORTED | `mapScaleValue()` (`axisAdvanced.ts`) | 위 링크 | P2 | M |
| Reverse | 축 반전 | `reverse` | SUPPORTED | `makeAxis()` | 위 링크 | P2 | S |
| Major Ticks | Increment / Count / Custom / Min&Max | `majorInterval`(증분), `tickCount`(개수), `tickValues`(사용자 값 목록) | SUPPORTED | `axisTicks()`, `AxisConfig.tickValues` | 위 링크 | P2 | S |
| Minor Ticks | Count / Custom | `minorTickCount`(주 눈금 사이 개수), `minorInterval`(증분) | SUPPORTED | `minorTickValues()` (`axisAdvanced.ts`) | 위 링크 | P2 | S |
| 눈금 라벨 서식 | 숫자·날짜·사용자 | 숫자(소수·과학·천단위) | SUPPORTED | `formatTickValue()` | 위 링크 | P2 | S |
| 축 제목·단위 | Title / Unit / Font | `title`+`unit`, 글꼴은 프리셋 | SUPPORTED | `drawAxes()` | 위 링크 | P2 | S |
| 축 분리(Breaks) | Broken axis | `axisBreak{from,to,size}` — 생략 구간을 좁은 틈과 절단 표시 2개로 그리고 그 안의 눈금은 버린다 | SUPPORTED | `buildAxisMap()`, `AxisBreakConfig`, `drawAxes()` breakMarks | [Axis dialog](https://docs.originlab.com/origin-help/general-axis-dialog/) | P2 | M |
| 다중 축(상·하·좌·우) | Top/Right 축 별도 설정 | 좌·하 기본 + Line 보조 Y | PARTIAL | `drawAxes()`, y2Axis | 위 링크 | P1 | M |
| Rescale Margin | % 여백 | `axisMargin` (0–1 비율) | SUPPORTED | `AxisConfig.axisMargin` | [Scale tab](https://docs.originlab.com/origin-help/axesref-scale/) | P2 | S |

---

## 8. OriginLab — Colormap / Contour

공식: [Plot Details Color Map/Contours tab](https://docs.originlab.com/origin-help/pd-dialog-colormapcontour-tab/) · [Customizing plot colors](https://docs.originlab.com/origin-help/customize-plotcolor/)

| 항목 | Origin | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 | 공수 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Level 편집 | Set Levels: From/To/Increment/Count | `zMin`/`zMax`/`levelInterval`/`levelCount`/`customLevels` | SUPPORTED | `computeContourLevels()` | [Color Map tab](https://docs.originlab.com/origin-help/pd-dialog-colormapcontour-tab/) | P1 | S |
| Fill 팔레트·보간 | Palette, limited mixing, 3-color | 9 지각 팔레트 + 선형 보간, 사용자 다색 정지점(`customStops`)으로 3색 이상 혼합 | SUPPORTED | `COLORMAPS`, `sampleColormap()`, `sampleCustomStops()` | 위 링크 | P1 | M |
| 수준별 Line | Show/hide, 속성 | 수준별 `lineWidth`·`lineDash`·`lineColor`, 전역 기본값과 함께 | SUPPORTED | `ContourLevelStyle`, `contourLineLook()` | 위 링크 | P2 | M |
| 수준별 Label | 개별 on/off | `levelStyles[index].showLabel` + 전역 `showContourLabels`, 글꼴 크기·자릿수 | SUPPORTED | `drawContour()` label 루프 | 위 링크 | P2 | S |
| Fill to Contour vs Grid | 두 채우기 방식 | `filled`(경계 보간) vs `heatmap-*`(셀 격자) | SUPPORTED | `bandPolygons()` vs `drawContour()` heatmap | 위 링크 | P1 | S |
| Colorbar | 위치·눈금·제목 | `colorbarPosition`(right/bottom/left), continuous/discrete, title/unit | SUPPORTED | `colorbar()` (`charts.ts`) | 위 링크 | P1 | S |
| 데이터 점 표시 | XYZ Contour의 Show Data Points | `showPoints` (설계점·정상점·최적점) | SUPPORTED | `RsmViewConfig`, `drawContour()` | 위 링크 | P1 | S |
| Grid lines·삼각분할 | Show Grid Lines | 없음 | MISSING | — | 위 링크 | P2 | M |
| Smoothing parameter | XYZ 보간 평활 | 없음 (격자 해상도로만) | MISSING | — | 위 링크 | P2 | M |
| Custom boundary | 경계 데이터로 마스크 | 없음 | MISSING | — | 위 링크 | P2 | L |
| 사용자 팔레트 관리 | Color Manager | 사용자 스타일 팔레트(계열 색)만, 등고 팔레트 편집 없음 | PARTIAL | `saveCustomStyle()`, `CustomChartStyle` | [Customizing colors](https://docs.originlab.com/origin-help/customize-plotcolor/) | P2 | M |

> **Origin의 Fill to Contour Lines**는 Sigrún의 `filled`/`filled-lines`와 같은 방식(격자 셀 값을 선형 보간해 불규칙한 등고선까지 채움)이고, **Fill to Grid Lines**는 `heatmap-discrete`/`heatmap-continuous`와 같다. 두 방식을 모두 제공하므로 이 항목은 `SUPPORTED`다.

---

## 9. Phase 2 인계 — 엔진은 있고 화면이 없는 항목

Phase 1은 *모델과 렌더러*를 끝냈다. 아래는 P1인데 UI만 남은 것들이며, Phase 2 Drawer/ContextMenu가 직접 연결할 지점이다.

| Phase 2 작업 | 연결할 심볼 | 비고 |
| --- | --- | --- |
| 차트 더블클릭 → 스타일/축 Drawer | `ChartConfig`, `CHART_STYLE_PRESETS`, `loadCustomStyles()` | `spec.config` 를 그대로 편집·저장 |
| 스타일 선택 카드(7종 + 사용자) | `resolveChartStyle()`, `saveCustomStyle()` | 프로젝트 파일에도 `customChartStyles` 로 저장 |
| 축 범위·로그·반전 편집 | `AxisConfig` (`min`/`max`/`scale`/`reverse`/`majorInterval`) | `getChartWarnings()` 로 비양수 경고 표시 |
| RSM 뷰 전환(요인 쌍·고정값·단위) | `rsmModel` on `contour` spec → `rsmPredictSurface()`, `buildAllPairContours()` | 재적합 없이 즉시 재슬라이스 |
| 등고 옵션(해상도·렌더모드·팔레트·수준) | `ContourConfig` | 기본 `standard`/`filled-lines`/10밴드 |
| 툴팁·표 데이터 연동 | `data-chart-role="chart-point"` + `data-x`/`data-y`/`data-z`/`data-label` | 점 요소에 이미 부착 |
| 확대·이동(Zoom/Pan) | `renderChart(spec, { width, height })` + viewBox | 렌더러는 매 호출 독립 컨텍스트 |
| 내보내기(SVG/PNG, DPI·물리 크기) | `resolveStandaloneSvg()`, `ExportConfig`, `svgToPng()` | 내보낸 SVG에 `var(--…)` 0개 보장 |
| 컨텍스트 메뉴(계열 숨김·색 변경) | `SeriesStyle.perSeries` | 차트 우클릭 메뉴(축·모양·내보내기·속성·확대·전체화면·스타일 복사/붙여넣기·전체 적용·PNG 복사·초기화) 및 계열 탭의 계열별 표시/색 |

**Stage 3D에서 닫힌 것**: 축 분리(생략 구간), 수준별 개별 색·라벨·선 스타일, 주석/도형/텍스트/그림 라벨, 자유 레이아웃(그래프 레이아웃 편집기), 보조 축 확장, 오차 막대·영역 채우기·드롭 라인. 3D Surface/Wireframe(§5)과 다중 응답 오버레이는 Stage 3B에서 구현됐다.

---

## 10. 재현·검증 명령

```bash
cd repos/PKPilot0018
export PATH="/workspace/node/bin:$PATH"
npx tsc --noEmit
npm test
npm run qa:stats
npm run build
node_modules/.bin/vite-node tools/contour_benchmark.ts
node tools/e2e_phase3_3d.cjs
BASE=https://hyangdan2.github.io/PKPilot0018/ SERVE=0 node tools/e2e_phase3_3d.cjs
```

관련 테스트(Stage 3D): `tests/axis-advanced.test.ts` (스케일·눈금·생략·날짜·가드), `tests/error-bars.test.ts` (오차 막대 통계), `tests/contour-styles.test.ts` (색상 맵·수준별 스타일·마스크·계열 옵션), `tests/chart-interaction.test.ts` (확대·이동·선택·연동·CSV), `tests/graph-layout.test.ts` (레이아웃 모델·정렬·내보내기·저장/복원).

기존 테스트: `tests/chart-config.test.ts` (모델·프리셋·축 정밀도·이스케이프·프로젝트 호환), `tests/contour-geometry.test.ts` (16-case·안장·해석적 곡면·밴드·팔레트), `tests/rsm-model.test.ts` (모형 페이로드·슬라이스·단위·전 요인 쌍), `tests/regression-bands.test.ts` (statsmodels 대조).

---

## 11. Stage 3A — 저장 모형 계층 (WO-02)

차트 격차 감사와 별개로, 적합 모형을 후속 실행에서 재사용하기 위한 계층이 추가됐다. 상세 설계는 `docs/MODEL_STORE_ARCHITECTURE.md`.

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 모형 저장·이름변경·복제·삭제·비교 | SUPPORTED | `src/lib/modelStore.ts`, `src/components/ModelManager.tsx` |
| 다항 회귀(2·3차) 적합·저장 | SUPPORTED | `runPolyRegression()` (`analyses.ts`), `tests/polyreg-model.test.ts` |
| 저장 정보(계수·공분산·잔차분산·자유도·요인범위·코딩변환·범주수준·학습데이터·진단·버전·시각) | SUPPORTED | `StoredModel`, `draftFromGlm()`, `draftFromRegression()`, `draftFromRsmPayload()` |
| 모형 예측(단위 전환·SE·예측구간) | SUPPORTED | `predictStoredModel()` |
| 랭크 부족 시 추정 불가 표시 | SUPPORTED | `nonEstimable`, QA-J-06 |
| 원본 데이터 변경 시 Stale 표시·재적합 | SUPPORTED | `modelStaleness()`, `refitStoredModel()` |
| 모형 기반 후속 진입점 | PARTIAL | `modelSurface()` → 등고선 활성, 표면·최적화는 Stage 3B–3C |

## 12. Phase 2 반영 — 화면이 붙은 항목

Phase 2는 엔진 심볼을 UI에 연결하고, 내보내기와 검증을 마쳤다. 아래 항목은 Phase 1에서 엔진만 있던 것이 이제 화면에서 직접 편집·검증된다.

| Phase 2 산출물 | 연결한 심볼 | 검증 |
| --- | --- | --- |
| 7탭 차트 속성 드로어 (일반·축 눈금·계열·스타일·참조선·범례·내보내기) | `ChartConfig`, `ChartConfigHistory` | `tests/chart-drawer.test.ts`, E2E `drawer_*` 35/35 |
| 실시간 미리보기 + 적용/취소/초기화 + Ctrl+Z/Y | `ChartConfigHistory`, `materializeRsm()` | E2E `a scale change previews live` |
| 축 눈금 편집(X/Y/Z/Y2) | `AxisConfig` (`min`/`max`/`majorInterval`/`scale`/`reverse`/`tickDirection`/`crossAt`) | `tests/chart-config.test.ts`, E2E |
| RSM 뷰 전환(요인 쌍·고정값·단위·표시 범위·실험/정상/최적점) | `rsmPredictSurface()`, `resliceRsm()` | `tests/chart-drawer.test.ts` |
| 전 요인 쌍 등고선 생성 | `allPairSurfaces()`, `C(k,2)` | E2E `Generate all factor-pair contours` |
| 등고 옵션(해상도 41/101/201/401·5 렌더 모드·9 팔레트·수준·컬러바) | `ContourConfig`, `CONTOUR_RESOLUTIONS` | E2E 5모드·4해상도, `contour_*.png` |
| 범례 오른쪽/아래 여백 확보 | `legendReserve()`, `legendGeometry()` | `tests/chart-drawer.test.ts` 4건 |
| 더블클릭 라우팅(축·컬러바·제목·범례·플롯) | `data-chart-role` | E2E `double-clicking the Y axis` |
| 차트 우클릭 전용 메뉴 | `ContextMenu` | E2E `right-click opens a chart context menu` |
| 점/등고선 호버·탭 값 읽기 | `data-point`, `data-plot-box`, `probeContour()` | E2E `hovering a point`, `chart-tip` |
| 확대·전체화면 뷰어 | `ChartViewer` | E2E `chart_zoom.png` |
| SVG/PNG 내보내기(DPI·물리 크기·배경·제목/범례) | `chartSvgDocument()`, `svgToPngWithConfig()` | `tests/chart-export.test.ts` 9건, E2E 1890×1181 / 3780×2362 |
| 스타일 복사/붙여넣기·전체 적용 | `packChartStyle()`, `applyStylePack()` | `tests/chart-drawer.test.ts` |
| 재실행 시 차트 설정 보존 | `chartConfigMemory` (`App.tsx`) | E2E `a re-run keeps the chart style` (Dark 프리셋이 재실행 카드에 유지) |

**남은 항목**: Stage 3D에서 축 분리·수준별 색/라벨·주석/도형·자유 레이아웃이 모두 닫혔다. 남은 것은 데이터 기반 경계 마스크, 그리드 라인·삼각분할 표시, 채우기 패턴 같은 세부 항목이다. 드로어는 해당 차트 종류에서만 관련 탭을 노출한다(Stage 3B의 `3D`·`Overlay` 탭, Stage 3D의 고급 눈금/생략/날짜/보조 축/수준별 스타일 그룹이 그 예).
