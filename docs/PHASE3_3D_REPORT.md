# Sigrún Phase 3 — Stage 3D 보고서 (그래프 레이아웃 편집기 · 고급 축/등고/계열 옵션 · 차트 인터랙션)

> **저장소**: `HyangDan2/PKPilot0018` · 브랜치 `feat/chart-engine-phase3-3d` → PR (스쿼시 머지) → 원격 브랜치 삭제
> **배포**: GitHub Pages (`https://hyangdan2.github.io/PKPilot0018/`)
> **일자**: 2026-11-24
> **작업 목록**: WO-07 Graph Layout Editor [P1] · WO-08 Advanced Scale & Contour Options [P2] · WO-09 Chart Interaction Upgrade [P2]

## 1. 검증 요약

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm test` | **913 / 913 PASS** (Stage 3C 834 + Stage 3D 신규 79) |
| `npm run qa:stats` | **186 / 186 PASS, 0 FAIL** (기존 180 + QA-Y 6) |
| `npm run build` | 성공 — 외부 CDN·API 없음 |
| `tools/e2e_phase3_3d.cjs` (로컬) | **48 / 48 PASS** |
| `tools/e2e_phase3_3d.cjs` (라이브) | **48 / 48 PASS** (`BASE=https://hyangdan2.github.io/PKPilot0018/ SERVE=0`) |
| CI | `Statistics QA` pass, `Deploy Sigrún to GitHub Pages` success |

신규 테스트 79건의 구성: `tests/axis-advanced.test.ts` 19 · `tests/error-bars.test.ts` 11 · `tests/contour-styles.test.ts` 13 · `tests/chart-interaction.test.ts` 12 · `tests/graph-layout.test.ts` 24.

재현:

```bash
export PATH="/workspace/work/node/bin:$PATH"
npx tsc --noEmit
npm test
npm run qa:stats
npm run build
node tools/e2e_phase3_3d.cjs
BASE=https://hyangdan2.github.io/PKPilot0018/ SERVE=0 node tools/e2e_phase3_3d.cjs
```

## 2. WO-07 그래프 레이아웃 편집기

복수 분석 결과를 하나의 기술보고서 Figure로 묶는 편집기. **Graph 메뉴 → Graph Layout Editor**로 열린다.

| 구성 | 내용 |
| --- | --- |
| 차트 추가 | 현재 출력의 모든 차트(카드·그리드 포함)를 목록에서 골라 페이지에 배치. 3D 표면은 래스터 패널로 표시 |
| 배치 | 드래그 이동, 8방향 핸들 리사이즈, 격자 스냅(1·2·5·10 mm), 페이지 밖으로 나가지 않는 클램프 |
| 정렬 | 왼쪽·가운데·오른쪽·위·중간·아래, 가로/세로 균등 배분, 같은 크기, 복제, 맨 앞/맨 뒤/앞으로/뒤로 |
| 이력 | 문서 단위 실행취소·재실행(최대 60단계), 같은 문서는 단계를 만들지 않음 |
| 주석 | 텍스트 상자, 화살표, 선, 사각형, 원, 강조 영역, 그림 라벨 `(a)(b)(c)`(다시 매기기), 로컬 이미지/데이터 URL 삽입 |
| 페이지 | A4 세로/가로, 발표 16:9·4:3, 단단(85×110 mm)·양단(178×120 mm), 사용자 크기 — 모두 mm 단위 |
| 스타일 통일 | 한 프리셋(7종)을 모든 차트 패널에 적용 |
| 출력 | SVG(벡터), PNG 150/300/600 DPI(`pHYs` 청크로 DPI 기록), 클립보드 복사, 레이아웃 저장/복원 |
| 저장 형식 | `sigrun-layout` v1 JSON — 페이지·격자·패널·z순서·차트 스냅샷 포함. 프로젝트 파일 `.sigrun.json`의 `figures`로도 저장된다 |
| 3D 처리 | 패널이 래스터임을 `raster` 플래그·`data-raster` 속성·UI 안내로 밝힌다. 벡터 차트는 확대해도 선명 |

검증: `tests/graph-layout.test.ts` 24건(페이지 프리셋·클램프·정렬/배분/같은 크기·레이어·복제·실행취소·직렬화·SVG 내보내기·래스터 표시)과 E2E의 편집기 흐름(차트 2개 배치 → 주석 4종 → 페이지 전환 → 드래그 → 복제/실행취소/재실행 → 정렬/같은 크기 → 스타일 통일 → SVG/PNG/레이아웃 저장 → 재열기)이 확인한다.

## 3. WO-08 고급 축 옵션

| 기능 | 구현 |
| --- | --- |
| Tick Count | `tickCount` 2–20, 계산된 nice 눈금을 그 개수로 |
| Custom Tick Values | `tickValues` 목록(범위 밖 값은 무시, 중복 제거) |
| Minor Tick Count | `minorTickCount` 1–20 — 주 눈금 사이 보조 눈금을 **표시**(격자선과 별개) |
| Axis Break | `axisBreak{from,to,size}` — 생략 구간을 `size` px 틈으로 압축하고 절단 표시 2개를 그린다. 그 구간의 주·보조 눈금은 표시하지 않는다 |
| Symmetrical Log | `symlog`: sign(x)·log10(1+abs(x)/C), C 지정 — 0과 음수도 유한 좌표 |
| Natural Log | `ln` — e^k 눈금, 2 decade 미만이면 1·2·5 배수 |
| Power Scale | `power` — 변환 공간에서 nice 눈금을 잡고 라벨은 데이터 값으로 |
| Date/Time Axis | `dateAxis{epoch,unit,format}` — 값은 기준 시각부터의 일·주·월·년 개수, 라벨은 UTC 달력(YYYY-MM-DD / Mon YYYY / YYYY). 눈금은 달력 경계에서 시작하고 최대 12개로 균등 축약하되 양 끝은 유지 |
| Tick Length | `tickLength` px (프리셋 길이를 덮어쓴다) |
| Axis Visibility | `showAxisLine`, `showTickLabels` |
| Secondary Axis 확장 | `yAxis.secondary{title,unit,min,max,decimals,showGrid}` + `seriesAdvanced.secondarySeries` — 선·산점도 계열을 오른쪽 눈금에 그린다 |

가드: NaN·역전 범위·0 눈금 간격·알 수 없는 enum은 렌더 좌표에 도달하지 않는다(`sanitizeAxisConfig` 확장, `tests/axis-advanced.test.ts`).

## 4. WO-08 등고선 고급 옵션

| 기능 | 구현 |
| --- | --- |
| Custom Color Map | `customStops[{value,color}]` 2–20개, 값 기준 선형 보간 (밴드 중앙값에서 샘플) |
| Per-Level Color | `levelStyles[index].color` — 팔레트·사용자 맵보다 우선 |
| Per-Level Line Width / Style | `levelStyles[index].lineWidth·lineDash·lineColor` |
| Per-Level Label Visibility | `levelStyles[index].showLabel` (전역 `showContourLabels`를 덮어씀) |
| Label Font | `labelFontSize`, `labelDecimals` |
| Colorbar Range | `zMin`/`zMax` (색상 띠·밴드 동시) |
| Underflow / Overflow Color | `underflowColor`(최저 밴드), `overflowColor`(최고 밴드) |
| Masked Region Style | `maskedStyle`: 비움 / 회색 / 빗금 — NaN 격자 셀을 셀 단위로 표시(등고선은 마스크를 통과하지 않는다) |

## 5. WO-08 계열 옵션 · 오차 막대

| 기능 | 구현 |
| --- | --- |
| Area Fill | `areaFill`, `areaOpacity` — 축 기준선(0이 범위 밖이면 축 하단)까지 채움 |
| Drop Lines | `dropLines`, `dropLineColor`, `dropLineDash` |
| Error Bars | `errorBars{kind,sd·se·ci, scope: point·series, conf, capWidth, color, series[]}` |
| Series Ordering | `order[]` — 그리는 순서와 범례 순서가 함께 바뀐다 |
| Individual Point Style | `pointStyles[index]{shape,size,color}` — 그리는 순서로 점 하나만 |
| Secondary Series | `secondarySeries[]` — 오른쪽 눈금 배정 |

**오차 막대의 정의** (전부 `src/lib/seriesStats.ts`):

```
mean  x̄ = Σxᵢ / n
sd    s  = √(Σ(xᵢ − x̄)² / (n − 1))         (표본, n − 1)
se    SE = s / √n
ci    x̄ ± t(1 − α/2, n − 1) · SE            (양측 Student t)
```

n < 2 이거나 유한하지 않은 값뿐이면 **막대를 그리지 않는다**. 폭 0인 막대를 그려 "변동 없음"처럼 보이게 하지 않는다. 축은 막대의 상·하한을 포함하도록 확장된다.

독립 검증 **QA-Y 6건** (`qa/cases/QA-Y-stage3d-errorbars.json`): SD(n−1)·SE·95% CI·99% CI·반복값 1개(그리지 않음)·결측 제외. 기준은 NumPy `std(ddof=1)`와 SciPy `t.ppf`이며 186/186 PASS. **Minitab 수치 동등성은 주장하지 않는다** — 검증 대상은 문서화된 정의와 SciPy 기준이다.

## 6. WO-09 차트 인터랙션

| 기능 | 구현 |
| --- | --- |
| Box Zoom | 플롯 위 사각형 드래그 → 그 창의 데이터 범위로 축을 다시 그린다(로그·거듭제곱 축은 변환 공간에서). 6 px 미만 드래그는 클릭으로 본다 |
| Pan | 이동 모드 드래그, 폭 유지 |
| Crosshair | 십자선 토글, 포인터 추적 |
| Data Cursor | 차트에 포커스하고 ←/→ 로 데이터 요소를 순회(끝에서 순환), 해당 점의 툴팁·행 선택 동기화 |
| Tooltip Pinning | 점 클릭으로 툴팁 고정, 빈 곳 클릭 또는 Esc로 해제 |
| Point Selection | 선택 모드에서 점/막대/상자 클릭, Shift로 추가·해제 |
| Worksheet Row Highlight | 선택된 원본 행을 워크시트에서 강조(`tr.row-highlight`) |
| Linked Selection | 같은 시트·같은 x/y 열 쌍을 읽는 차트끼리만 선택을 공유(`selectionCompatible`) |
| Export Selected Data | 선택된 원본 행을 CSV로 내려받기 |

**원본 행 매핑**: 점·막대·상자 요소가 `data-row`/`data-rows`로 원본 행을 들고 다닌다. 결측값은 값과 함께 인덱스를 버리므로 뒤따르는 점의 행이 밀리지 않고, By 그룹 분리는 그룹 행 목록을 원본 인덱스로 되돌린다. 집계 요소(히스토그램 구간·상자 그림 그룹·막대 범주)는 **포함된 원본 행 전체**를 가리킨다.
현재 행 매핑을 싣는 차트: 산점도(개별·패널·오버레이), 히스토그램, 상자 그림, 막대. 회귀 잔차 그림은 `regress()`가 내부에서 결측을 제거해 행 인덱스를 돌려주지 않으므로 이번 단계에서는 매핑하지 않는다(§8 참조).

## 7. 변경 파일

- 모델: `src/lib/chartConfig.ts`(Axis/Contour/SeriesAdvanced 확장), `src/types.ts`(ChartSource, row·replicates, 패널 rows)
- 엔진: `src/lib/axisAdvanced.ts`(신규), `src/lib/seriesStats.ts`(신규), `src/lib/charts.ts`(축·등고·계열·보조 축·시계열 옵션), `src/lib/chartGuards.ts`(가드)
- 상호작용: `src/lib/chartInteraction.ts`(신규), `src/components/ChartFrame.tsx`
- 레이아웃: `src/lib/graphLayout.ts`(신규), `src/components/GraphLayoutEditor.tsx`(신규)
- 연결: `src/components/OutputPanel.tsx`, `WorksheetGrid.tsx`, `ChartPropertiesDrawer.tsx`, `MenuBar.tsx`, `App.tsx`, `src/lib/project.ts`(`figures`), `src/lib/analyses.ts`(행·출처), `src/lib/i18n.ts`, `src/styles/app.css`
- 테스트: `tests/axis-advanced.test.ts`, `error-bars.test.ts`, `contour-styles.test.ts`, `chart-interaction.test.ts`, `graph-layout.test.ts` (+ `scatter-stage2.test.ts`의 시트 id 비교 정규화)
- QA: `qa/cases/QA-Y-stage3d-errorbars.json`, `qa/build_cases.py`, `qa/adapters/sigrun/cli.ts`, `qa/reference/engine.py`
- E2E: `tools/e2e_phase3_3d.cjs` (48검사)
- 문서: `docs/CHART_FEATURE_GAP.md`(Stage 3D 스냅샷·집계 갱신 — SUPPORTED 39→66, MISSING 8→3), 본 보고서

## 8. 알려진 한계 / 주장하지 않는 것

1. **회귀 잔차 그림의 행 매핑 없음** — `regress()`가 결측 제거 후 원본 행 인덱스를 반환하지 않는다. 잔차 산점도·잔차 히스토그램에서 점을 선택하면 차트 안 선택만 되고 워크시트 행은 강조되지 않는다.
2. **오차 막대는 반복값이 있는 점에만** — 현재 분석 중 점별 반복값을 만들어 넘기는 것은 없다. 계열 전체 기준(scope=series)은 계열의 모든 점에 같은 구간을 그리며, 이는 "집단 평균만 있을 때"의 관행과 같다는 것을 문서화했다. 화면 기본값과 Minitab의 수치 동등성은 주장하지 않는다.
3. **레이아웃 편집기의 차트 패널은 스냅샷** — 패널은 배치 시점의 차트 사본을 그린다. 이후 분석을 다시 실행해도 페이지의 그림은 자동으로 갱신되지 않는다(복원 시 그대로 재현하는 쪽을 택했다).
4. **3D 표면 패널은 래스터** — 화면은 WebGL, Figure 내보내기는 정적 투영을 래스터로 합성한다. 확대 인쇄 품질은 페이지 DPI에 따른다(UI·문서에 명시).
5. 축 생략은 한 구간만 지원한다(다중 생략 구간은 없음). 날짜 축은 UTC로만 라벨을 찍는다(시간대 변환 없음).
6. 차트 간 연동 선택은 **같은 시트의 같은 열 쌍**일 때만 동작하며, 집계 그래프와 원자료 그래프 사이의 연결은 하지 않는다(원본 참조가 호되지 않으므로).

## 9. 산출물

- 스크린샷(`work/pkpilot0018/`): `phase3-3d-layout.png`(레이아웃 편집기), `phase3-3d-layout-arranged.png`, `phase3-3d-interaction.png`(선택·확대), `phase3-3d-zoom.png`, `phase3-3d-selection.png`, `phase3-3d-axis-break.png`, `phase3-3d-contour-styles.png`, `phase3-3d-series-options.png`, `phase3-3d-secondary-axis.png`, `phase3-3d-figure.svg`, `phase3-3d-figure-300dpi.png`, `phase3-3d-layout.sigrun.json`, `phase3-3d-report.json`
