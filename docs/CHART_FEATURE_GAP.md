# Sigrún ↔ Minitab · OriginLab 차트 기능 격차 감사 (Phase 1)

> **대상**: `HD2Lab Sigrún` — 브라우저에서만 도는 통계·품질 워크스페이스 (`repos/PKPilot0018`)
> **기준 커밋**: `ee1dafe` 위 Phase 1 차트 엔진 작업 (`src/lib/chartConfig.ts`, `chartStyles.ts`, `contour.ts`, `charts.ts`, `doe.ts`, `stats.ts`)
> **감사 범위**: Minitab의 Graph Editing · Scale Editing · Contour Plot · Surface Plot, OriginLab의 Plot Details · Axis Dialog · Colormap/Contour
> **감사 방법**: 각 대화상자 항목을 실제 심볼과 1:1로 대조하고, 공식 도움말 링크를 행마다 붙였다. 모든 `SUPPORTED` 행은 `tests/chart-config.test.ts`, `tests/contour-geometry.test.ts`, `tests/rsm-model.test.ts`, `tests/regression-bands.test.ts` 중 하나 이상이 검증한다.
> **분류**: `SUPPORTED` 구현·검증됨 / `PARTIAL` 일부만 / `MISSING` 없음 / `DIFFERENT` 다른 방식 / `UNKNOWN` 미확인
> **공수**: S 0.5일 이하 · M 1–2일 · L 3일 이상

## 검증 스냅샷 (2026-11-24)

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm test` | **635 / 635 PASS** (기존 583 + Phase 1 신규 52) |
| `npm run qa:stats` | **156 / 156 PASS, 0 FAIL** |
| `npm run build` | 성공 (196 modules, gzip JS 240.41 kB, 외부 CDN 없음) |
| 콘투어 벤치마크 | 41: 14–18 ms · **101: 22–33 ms** · 201: 43–49 ms · 401: 110–125 ms (5회 중앙값, 560×300, filled-lines 10밴드) / 출력 58,052 · 135,204 · 263,271 · 520,106 B |

벤치마크 재현: `PATH="/workspace/node/bin:$PATH" node_modules/.bin/vite-node tools/contour_benchmark.ts` (560×300 SVG, filled-lines 10밴드, 1회 워밍업 + 5회 중앙값).
**기본 해상도 결정: `standard` = 101×101.** 201×201은 1.4배 시간에 2배 바이트지만 560 px 플롯에서 셀당 2.8 px로 육안 차이가 거의 없고, 101은 셀당 5.5 px로 등고선이 매끄럽다. `high`/`ultra`는 사용자가 명시할 때만 쓴다.

---

## 1. 요약

| 영역 | 항목 | SUPPORTED | PARTIAL | MISSING | DIFFERENT | P1 | P2 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Minitab 그래프 편집 | 8 | 3 | 3 | 2 | 0 | 2 | 6 |
| Minitab 축·눈금 편집 | 12 | 7 | 5 | 0 | 0 | 3 | 9 |
| Minitab Contour Plot | 14 | 7 | 4 | 2 | 1 | 7 | 7 |
| Minitab Surface Plot | 5 | 0 | 1 | 4 | 0 | 2 | 3 |
| Origin Plot Details | 10 | 5 | 4 | 1 | 0 | 6 | 4 |
| Origin Axis Dialog | 11 | 5 | 4 | 2 | 0 | 2 | 9 |
| Origin Colormap/Contour | 11 | 4 | 4 | 3 | 0 | 5 | 6 |
| **합계** | **71** | **31** | **25** | **14** | **1** | **27** | **44** |

- **P0(정확성) 격차 없음.** Phase 1 [P0] 항목 — 등고선 16-case·안장 판정, 렌더 컨텍스트 격리, 축 정밀도, XML 이스케이프 — 은 모두 구현·검증됐다. 남은 것은 전부 UI 연결(P1)과 편의 기능(P2)이다.
- **P1 27건**의 절반은 *엔진은 있고 화면이 없는* 항목이다. 모델(`ChartConfig`, `RsmViewConfig`)과 렌더러는 완성됐고 Phase 2 Drawer/ContextMenu가 이를 편집하면 된다(§9).
- **MISSING 14건**은 대부분 3D Surface Plot(4), 축 분리·대칭로그(2), 다중 응답 오버레이(1), 수준별 개별 색(1)처럼 새 렌더러가 필요한 기능이다.
- **DIFFERENT 1건**은 등고선 메쉬 보간 방식이다. Minitab은 방식을 고르게 하지만 Sigrún은 쌍선형 Marching Squares + 점근 판정기로 고정한다 — 결과가 해석적으로 정확한 쪽을 택했다.

---

## 2. Minitab — 그래프 편집 (Edit Graph)

공식: [Edit graphs](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-editing-basics/edit-graphs/)

| 항목 | Minitab | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 | 공수 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 그래프 편집 대화상자 | 그래프 더블클릭 → Options pane → Edit Graph | 편집 UI 없음. `config` 객체로만 지정 | MISSING | `ChartConfig` (`src/lib/chartConfig.ts`) — UI는 Phase 2 | 위 링크 | P1 | M |
| 제목·부제 | 제목/부제 텍스트·위치 | `appearance.title` / `subtitle`, `chart-title` 그룹 | SUPPORTED | `titleBlock()` (`charts.ts`), `ChartAppearance` | 위 링크 | P1 | S |
| 글꼴·크기 | 글꼴·스타일·색 | `fontFamily`, `fontSize`, 프리셋별 서체 | SUPPORTED | `resolveChartStyle()` (`chartStyles.ts`) | 위 링크 | P2 | S |
| 배경·플롯 색 | 그래프/데이터 영역 채우기 | `chartBg`, `plotBg`, 프리셋 7종 | SUPPORTED | `background()`, `plotBackground()` | [Edit Background](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-editing-basics/edit-graphs/) | P2 | S |
| 여백·크기 | 그래프 크기·여백 드래그 | `width`/`height`/`aspectRatio`/`margins` — 명시할 때만 적용 | PARTIAL | `createContext()`, `ctx.rawConfig.appearance?.margins` | 위 링크 | P2 | S |
| 주석·도형·텍스트 상자 | 자유 주석, 선·화살표·사각형 | 없음 | MISSING | — | 위 링크 | P2 | M |
| 다중 그래프 배치 | 그래프 여러 개 배치·정렬 | `chartgrid` 블록으로 나란히 출력, 자유 배치는 없음 | PARTIAL | `Block` (`src/types.ts`) `chartgrid` | 위 링크 | P2 | M |
| 그래프 파일 저장 | Save Graph As (PNG/JPG/…) | SVG 직렬화·PNG 래스터 함수 있음, 저장 UI는 Phase 2 | PARTIAL | `resolveStandaloneSvg()`, `svgToPng()` (`OutputPanel.tsx`) | [Save graphs](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-editing-basics/edit-graphs/) | P1 | S |

---

## 3. Minitab — 축·눈금 편집 (Scale Editing)

공식: [Continuous scale](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-framework-and-scale/continuous-scale/) · [Transform scale](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-framework-and-scale/transform-scale/) · [Secondary scale](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-framework-and-scale/secondary-scale/)

| 항목 | Minitab | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 | 공수 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 축 범위 자동/수동 | Auto 해제 후 Min/Max 입력 | `AxisConfig.min/max/autoRange`, `axisMargin` | SUPPORTED | `makeAxis()` (`charts.ts`) | [Change scale range](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-framework-and-scale/continuous-scale/) | P2 | S |
| 주 눈금 위치 | 자동 / 개수 / 값 목록(`5:30/5`) | `majorInterval` 지원, 값 목록·개수 지정은 없음 | PARTIAL | `computeAxisTicks({ step })` | 위 링크 | P1 | S |
| 보조 눈금 개수 | 주 눈금 사이 개수 | `minorInterval` 또는 5등분, 개수 지정은 없음 | PARTIAL | `minorGrid()` (`charts.ts`) | 위 링크 | P2 | S |
| 눈금 라벨 서식 | 자릿수·과학 표기·날짜 | `decimals`/`scientific`/`thousandsSep` + 정밀도 자동 상향 | SUPPORTED | `formatTickValue()` + `computeAxisTicks()` | [Change tick labels](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-framework-and-scale/continuous-scale/) | P1 | S |
| 축 반전 | Reverse | `reverse` (tick·데이터 동시 반전) | SUPPORTED | `makeAxis({ reverse })` | 위 링크 | P2 | S |
| 로그·거듭제곱 변환 | Logarithm / Power | `log10` 지원, `ln`·거듭제곱 없음 | PARTIAL | `AxisScale`, `mapScale()` | [Transform scale](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-framework-and-scale/transform-scale/) | P2 | M |
| 보조 축 | 같은 그래프에 두 번째 Y축 | Line 계열 `axis: 'secondary'` + `chart-axis-y2` 그룹, 산점도 다중 Y는 없음 | PARTIAL | `drawLine()` y2Axis | [Secondary scale](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-framework-and-scale/secondary-scale/) | P1 | M |
| 축 표시 요소 | 축선·라벨·눈금 표시/숨김 | `showMajorGrid`/`showMinorGrid`/`tickDirection`, 축선은 항상 표시 | SUPPORTED | `drawAxes()` | [Continuous scale](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-framework-and-scale/continuous-scale/) | P2 | S |
| 눈금 방향·길이 | 방향·길이·굵기 | `tickDirection`(in/out/both/none)·프리셋 굵기, 길이는 고정 | PARTIAL | `AxisConfig.tickDirection`, `ResolvedChartStyle.tickLength` | 위 링크 | P2 | S |
| 축 교차 위치 | 0 또는 지정 값에서 교차 | `crossAt`: `'auto'` / `'zero'` / 지정 값 | SUPPORTED | `axisLinePixel()` | 위 링크 | P2 | S |
| 범주 축 순서 | 범주 순서·정렬 지정 | `categoryOrder` (Pareto/Bar) | SUPPORTED | `drawPareto()` | [Categorical scale](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/graph-framework-and-scale/categorical-scale/) | P2 | S |
| 축 제목·단위 | 제목/단위/글꼴 | `title` + `unit` → `제목 (단위)` | SUPPORTED | `drawAxes()` titles | 위 링크 | P2 | S |

> **정밀도 규칙 (WO-11)**: 눈금 라벨은 값의 크기와 *눈금 간격*을 함께 본다. `1.2e-6 … 1.8e-6`은 `1.2e-6` 꼴로, `1000000.001 … 1000000.005`는 소수 셋째 자리를 유지하며, `M` 약어는 간격도 10⁵ 이상일 때만 쓴다. 라벨이 겹치면 자릿수를 올려 고유하게 만들고, 눈금은 최대 64개로 제한한다 (`computeAxisTicks`).

---

## 4. Minitab — Contour Plot

공식: [Contour display options](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/display-options/contour-plot/) · [Contour levels, areas, lines and labels](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/display-options/contour-levels-areas-lines-and-labels/) · [Specify settings](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/using-fitted-models/how-to/contour-plot/perform-the-analysis/specify-settings/) · [Define contour values](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/using-fitted-models/how-to/contour-plot/perform-the-analysis/define-the-contour-values/) · [Default options](https://support.minitab.com/en-us/minitab/help-and-how-to/minitab-environment/settings-and-defaults/individual-graphs/contour-plots/options/)

| 항목 | Minitab | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 | 공수 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 면 / 선 / 기호 표시 | Area, Contour lines, Symbols | `renderMode`: lines·filled·filled-lines·heatmap(continuous/discrete), `showPoints` | SUPPORTED | `drawContour()` (`charts.ts`), `ContourRenderMode` | [Display options](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/display-options/contour-plot/) | P1 | S |
| 등고 수준 자동/개수/값 | Automatic / Number(2–11) / Values | `levelMode`: auto·manual(간격)·custom(값 목록) | SUPPORTED | `computeContourLevels()` (`contour.ts`) | [Levels](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/display-options/contour-levels-areas-lines-and-labels/) | P1 | S |
| 수준 최대 개수 | 2–11 | 2–50 (기본 10) | SUPPORTED | `computeContourLevels` 상한 50 | [Define contour values](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/using-fitted-models/how-to/contour-plot/perform-the-analysis/define-the-contour-values/) | P2 | S |
| 영역 색 | Spectrum / 1색·2색 램프 | 지각 균일 9 팔레트(viridis·cividis·plasma·inferno·turbo·coolwarm·RdBu·grayscale·Sigrún) | PARTIAL | `COLORMAPS`, `bandColor()` | [Area colours](https://support.minitab.com/en-us/minitab/help-and-how-to/minitab-environment/settings-and-defaults/individual-graphs/contour-plots/options/) | P1 | S |
| 수준별 개별 색 | Custom colors per area | 레벨별 개별 지정 없음(팔레트만) | MISSING | — | 위 링크 | P2 | M |
| 등고선 라벨 | Show / No labels / 글꼴 | `showContourLabels` (값 표시, 글꼴 편집 없음) | PARTIAL | `drawContour()` label 루프 | [Contour labels](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/display-options/contour-levels-areas-lines-and-labels/) | P2 | S |
| 등고선 속성 | 자동/검정/변형/사용자 지정 | `lineWidth`, `lineColor`, 목표 수준 강조, 수준별 속성은 없음 | PARTIAL | `ContourConfig`, `drawContour()` | 위 링크 | P2 | M |
| 메쉬 보간 방식 | Mesh 방법 선택 | 쌍선형 + 점근 판정기 고정 (선택 불가) | DIFFERENT | `marchingSquares()`, `saddleValue()` | [Mesh](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/general-graph-options/display-options/contour-levels-areas-lines-and-labels/) | P2 | S |
| 다른 요인 고정값 | Hold continuous/categorical at | `RsmViewConfig.holdingValues` (coded) | SUPPORTED | `rsmPredictSurface()` (`doe.ts`) | [Specify settings](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/using-fitted-models/how-to/contour-plot/perform-the-analysis/specify-settings/) | P1 | S |
| Coded / Uncoded 단위 | 요인 단위 전환 | `unitMode`, `actualTransform` | SUPPORTED | `RsmViewConfig`, `codedToActual()` | 위 링크 | P1 | S |
| Z 최소/최대 | Z 범위 지정 | `zMin` / `zMax` (컬러바·밴드 동시) | SUPPORTED | `computeContourLevels()` | [Define contour values](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/using-fitted-models/how-to/contour-plot/perform-the-analysis/define-the-contour-values/) | P1 | S |
| 스펙 영역·목표값 | Overlaid contour의 feasible region | `specLsl`/`specUsl`/`targetValue`/`targetTolerance` 엔진 지원 | PARTIAL | `ContourConfig`, `drawContour()` | 위 링크 | P1 | S |
| 다중 응답 오버레이 | Overlaid Contour Plot | 없음(단일 응답) | MISSING | — | [Overlaid contour](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/using-fitted-models/how-to/contour-plot/before-you-start/overview/) | P2 | L |
| 해상도(격자) | (없음) | 41/101/201/401 프리셋 | SUPPORTED | `CONTOUR_RESOLUTIONS`, `resolutionPoints()` | — | P2 | S |

> **기하 검증**: `tests/contour-geometry.test.ts` 가 해석적 평면 `Z = X + Y`, 포물면 `Z = X² + Y²`, 안장 `Z = X² − Y²`, 상호작용 `Z = XY`, 상수면, NaN 마스크를 정확해와 대조한다. 16개 케이스 전부와 두 안장 케이스의 두 선분, 꼭짓점 접점의 결정론적 처리도 포함한다.

---

## 5. Minitab — Surface Plot

공식: [3D Surface Plot overview](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/3d-surface-plot/before-you-start/overview/) · [Surface Plot (fitted model)](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/using-fitted-models/how-to/surface-plot/before-you-start/overview/) · [Contour vs 3D surface](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/using-fitted-models/supporting-topics/graphs/contour-plots-and-3d-surface-plots/)

| 항목 | Minitab | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 | 공수 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3D Surface Plot | 매끈한 3D 곡면 | 없음 (2D 등고선만) | MISSING | — | [Overview](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/3d-surface-plot/before-you-start/overview/) | P1 | L |
| 3D Wireframe | 격자 와이어프레임 | 없음 | MISSING | — | 위 링크 | P2 | L |
| 회전·조명·시점 | 마우스 회전, 조명 | 없음 | MISSING | — | 위 링크 | P2 | L |
| 메쉬·보간 | Mesh 설정 | 없음 | MISSING | — | 위 링크 | P2 | M |
| 저장된 모형 표면 | Stored model → surface | 2D 등고선으로 대체(`rsmModel` 전달) | PARTIAL | `RsmModelPayload`, `buildAllPairContours()` | [Surface Plot](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/using-fitted-models/how-to/surface-plot/before-you-start/overview/) | P1 | M |

> 3D 표면은 Phase 1 범위 밖이다. `RsmModelPayload` 가 이미 임의 격자 예측을 제공하므로(`rsmPredictSurface`) Phase 3에서 정사영 렌더러만 얹으면 된다.

---

## 6. OriginLab — Plot Details

공식: [Plot Details controls](https://docs.originlab.com/origin-help/plot-details-controls/)

| 항목 | Origin | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 | 공수 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 선 색·굵기·스타일 | Line 탭 | `SeriesStyle` + `perSeries` | SUPPORTED | `ChartConfig.series`, `seriesColor()` | [Plot Details](https://docs.originlab.com/origin-help/plot-details-controls/) | P1 | S |
| 마커 모양·크기 | Symbol 탭 | 6종(circle/square/triangle/diamond/cross/none) | SUPPORTED | `MarkerShape`, `marker()` | 위 링크 | P1 | S |
| 계열별 개별 설정 | Individual series | `perSeries: Record<number, …>` (색·선·마커·표시) | SUPPORTED | `SeriesStyle.perSeries` | 위 링크 | P1 | S |
| 채우기 패턴·투명도 | Pattern / Transparency | `fillOpacity` 전역, 패턴 없음 | PARTIAL | `SeriesStyle.fillOpacity` | 위 링크 | P2 | M |
| 드롭라인·영역 채우기 | Drop Lines / Fill Area | 없음 | MISSING | — | 위 링크 | P2 | M |
| 데이터 라벨 | Label 탭 | `showDataLabels` (scatter/line/bar/SPC) | SUPPORTED | `ScatterOptions`, `LineBarParetoOptions` | 위 링크 | P1 | S |
| 라벨 서식·위치 | 폰트·회전·오프셋 | 값만 표시, 서식 없음 | PARTIAL | `drawScatter()` label 루프 | 위 링크 | P2 | S |
| 레이어·축 그룹 | Multi-layer, axis grouping | 블록 단위 다중 차트만 | PARTIAL | `chartgrid` | 위 링크 | P2 | L |
| 보조 축 계열 | Right Y axis | Line 계열 `axis: 'secondary'` | PARTIAL | `drawLine()` y2Axis | 위 링크 | P1 | M |
| 테마 일괄 적용 | Theme / Format 복사 | 7 프리셋 + 사용자 스타일 | SUPPORTED | `CHART_STYLE_PRESETS`, `saveCustomStyle()` | 위 링크 | P1 | S |

---

## 7. OriginLab — Axis Dialog

공식: [Axis Dialog](https://docs.originlab.com/origin-help/general-axis-dialog/) · [Scale tab](https://docs.originlab.com/origin-help/axesref-scale/)

| 항목 | Origin | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 | 공수 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| From / To / Rescale | 수동 범위, Rescale 모드 | `min`/`max`/`autoRange`/`axisMargin` | SUPPORTED | `AxisConfig`, `makeAxis()` | [Scale tab](https://docs.originlab.com/origin-help/axesref-scale/) | P1 | S |
| Scale Type | Linear·Log10·Probability·Probit·ln·log2·Custom… | Linear·Log10만 | PARTIAL | `AxisScale` | [Scale tab](https://docs.originlab.com/origin-help/axesref-scale/) | P2 | M |
| Symmetrical Log | 음수 허용 로그 | 없음(비양수는 경고 후 제외) | MISSING | `getChartWarnings()` | 위 링크 | P2 | M |
| Reverse | 축 반전 | `reverse` | SUPPORTED | `makeAxis()` | 위 링크 | P2 | S |
| Major Ticks | Increment / Count / Custom / Min&Max | `majorInterval`만 | PARTIAL | `computeAxisTicks({ step })` | 위 링크 | P2 | S |
| Minor Ticks | Count / Custom | `minorInterval` 또는 5등분 | PARTIAL | `minorGrid()` | 위 링크 | P2 | S |
| 눈금 라벨 서식 | 숫자·날짜·사용자 | 숫자(소수·과학·천단위) | SUPPORTED | `formatTickValue()` | 위 링크 | P2 | S |
| 축 제목·단위 | Title / Unit / Font | `title`+`unit`, 글꼴은 프리셋 | SUPPORTED | `drawAxes()` | 위 링크 | P2 | S |
| 축 분리(Breaks) | Broken axis | 없음 | MISSING | — | [Axis dialog](https://docs.originlab.com/origin-help/general-axis-dialog/) | P2 | L |
| 다중 축(상·하·좌·우) | Top/Right 축 별도 설정 | 좌·하 기본 + Line 보조 Y | PARTIAL | `drawAxes()`, y2Axis | 위 링크 | P1 | M |
| Rescale Margin | % 여백 | `axisMargin` (0–1 비율) | SUPPORTED | `AxisConfig.axisMargin` | [Scale tab](https://docs.originlab.com/origin-help/axesref-scale/) | P2 | S |

---

## 8. OriginLab — Colormap / Contour

공식: [Plot Details Color Map/Contours tab](https://docs.originlab.com/origin-help/pd-dialog-colormapcontour-tab/) · [Customizing plot colors](https://docs.originlab.com/origin-help/customize-plotcolor/)

| 항목 | Origin | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 | 공수 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Level 편집 | Set Levels: From/To/Increment/Count | `zMin`/`zMax`/`levelInterval`/`levelCount`/`customLevels` | SUPPORTED | `computeContourLevels()` | [Color Map tab](https://docs.originlab.com/origin-help/pd-dialog-colormapcontour-tab/) | P1 | S |
| Fill 팔레트·보간 | Palette, limited mixing, 3-color | 9 지각 팔레트 + 선형 보간, 3색 혼합 없음 | PARTIAL | `COLORMAPS`, `sampleColormap()` | 위 링크 | P1 | M |
| 수준별 Line | Show/hide, 속성 | 전역 `lineWidth`/`lineColor`, 수준별 없음 | PARTIAL | `ContourConfig` | 위 링크 | P2 | M |
| 수준별 Label | 개별 on/off | 전역 `showContourLabels` | PARTIAL | `drawContour()` | 위 링크 | P2 | S |
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
| 컨텍스트 메뉴(계열 숨김·색 변경) | `SeriesStyle.perSeries` | `perSeries[i].visible` 지원 |

**Phase 2에서 새로 만들어야 하는 것**: 3D Surface/Wireframe(§5), 축 분리, 다중 응답 오버레이, 수준별 개별 색·라벨, 주석/도형, 자유 레이아웃. 이들은 모두 P2 이상이며 Phase 1의 P0/P1 엔진 항목과 충돌하지 않는다.

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
```

관련 테스트: `tests/chart-config.test.ts` (모델·프리셋·축 정밀도·이스케이프·프로젝트 호환), `tests/contour-geometry.test.ts` (16-case·안장·해석적 곡면·밴드·팔레트), `tests/rsm-model.test.ts` (모형 페이로드·슬라이스·단위·전 요인 쌍), `tests/regression-bands.test.ts` (statsmodels 대조).
