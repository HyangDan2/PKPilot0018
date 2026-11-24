# Sigrún Phase 3 — Stage 3B 완료 보고 (3D Surface · Overlaid Contour)

> 대상: `HyangDan2/PKPilot0018` (`Sigrún`) · 브랜치 `feat/chart-engine-phase3-3b`
> 범위: WO-03 3D Surface Plot, WO-04 Overlaid Contour Plot, Stage 3A 연계 보완, 검증·QA·배포

## 1. 결과 요약

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm test` | **795 / 795 PASS** (Stage 3A 749 + Stage 3B 신규 46) |
| `npm run qa:stats` | **168 / 168 PASS**, 0 FAIL · 0 REVIEW · 0 UNVERIFIED · 0 ERROR (기존 162 + QA-V 6) |
| `npm run build` | 성공. WebGL 셰이더·색상 맵·아이콘 모두 로컬 번들, 외부 CDN·API 없음 |
| Stage 3B E2E (`tools/e2e_phase3_3b.cjs`) | **41 / 41 PASS** (로컬 dist 서버, WebGL·비WebGL 두 컨텍스트 + 390 px) |
| 회귀 E2E | Stage 3A 29/29 · Phase 2 차트 34/34 · 차트 축 6/6 · 워크스페이스 Stage 3 176/176 |
| 라이브 | GitHub Pages 배포 후 동일 E2E 재실행(§7) |

## 2. WO-03 — 3D Surface Plot

### 2.1 구조

| 층 | 파일 | 역할 |
| --- | --- | --- |
| 기하 | `src/lib/surface3d.ts` | Z 격자 → 월드 정점·평활 노멀·정점 색·삼각형/메시 인덱스. 카메라(방위·고도·줌·팬), 원근/정사영 투영, WebGL용 열우선 MVP, SVG 화가 알고리즘 정사영 |
| 렌더(대화형) | `src/lib/surfaceGl.ts` | 의존성 없는 WebGL 1 렌더러(프로그램 1개, 깊이 버퍼, 표면/와이어/바닥 등고선) |
| 컴포넌트 | `src/components/Surface3DView.tsx` | 캔버스 + 같은 카메라의 SVG 프레임(축·레이블·실험점·컬러바), 포인터·휠·핀치 조작, WebGL 실패 시 자동 정사영 |
| 정적/내보내기 | `chartStage3b.ts` → `charts.ts` `drawSurface` | 모든 SVG/PNG/인쇄 경로가 쓰는 정사영 그림 |

### 2.2 요구 기능 대응

- X/Y 요인, Z 반응, Holding Value, Coded/Actual, 표시 범위: `RsmViewConfig` + `materializeSurface()`가 저장 모형에서 격자를 다시 계산.
- Surface / Wireframe / Surface+Wireframe, 표면 불투명도, 메쉬 밀도·선 두께, 조명(방위·고도·주변광·확산광), 배경(차트/흰색/어두운색), 축 상자·레이블, 컬러바, Z 배율, 색상 맵.
- XY 바닥 등고선 투영: `marchingSquares()` + `stitchSegments()`를 그대로 재사용해 2D 등고선과 같은 위상을 갖는다.
- 실험점·정지점·최적점: RSM 페이로드의 `designPoints`·`stationary`·`optimal`을 `StoredModel.design/stationary/optimal`에 함께 저장해, 저장 모형에서 연 표면에도 표시된다.
- 인터랙션: 드래그 회전, 휠 줌(페이지 스크롤 차단), Pan(Shift+드래그·가운데 버튼), 터치(한 손가락 회전·두 손가락 핀치 줌), Reset Camera, Top/Front/Side/Isometric, Perspective/Orthographic, 드로어에서 카메라 방위·고도·줌 수치 편집.
- 해상도: Draft 41 / Standard 101 / High 201 / Ultra 401. 401은 160 801 정점(정점 버퍼 5.8 MB + 인덱스 3.8 MB)이며 `SURFACE_MAX_GRID`로 상한을 고정했다. 테스트가 Ultra 격자 생성 시간(4 s 이내)과 버퍼 바이트 수를 측정한다.
- **WebGL 불가 폴백**: 컨텍스트 생성 실패·`webglcontextlost`·헤드리스/소프트웨어 래스터 비활성 환경에서 정적 정사영 SVG로 자동 전환하고, 배지와 안내 문구(`surface3d-badge`, `surface3d-fallback`)를 표시한다. `?webgl=off`와 `window.__SIGRUN_DISABLE_WEBGL__`은 테스트용 강제 스위치다.

### 2.3 Stage 3A 연계 보완

- `buildRsmModel()`이 이제 `mse·(X'X)⁻¹` 공분산과 `dfe·mse·rank·dfModel`을 페이로드에 담는다. `draftFromRsmPayload()`는 그 대각에서 계수 SE를, 자유도에서 `dof`를 채우므로 **RSM 저장 모형도 예측 SE와 예측구간을 표시한다** (이전에는 "not available").
- `ModelManager.tsx`의 `3D surface` 진입 버튼을 활성화했다. 저장 모형의 두 수치 요인으로 표면 카드를 만들고, 실험점이 있으면 함께 그린다.
- **부수 수정(Stage 3A 결함)**: `buildRsmModel`이 이미 코드화된 설계(0에 대칭인 레벨)에 중심·반범위를 다시 적용해 요인을 두 번 코딩하고 있었다(CCD에서 ±1.189 → ±1.414). 0 대칭 설계는 변환을 항등으로 두도록 고쳤고, 그 결과 저장 모형의 `factorBounds`·Actual 표시가 설계 영역과 일치한다.

## 3. WO-04 — Overlaid Contour Plot

### 3.1 엔진

`src/lib/feasible.ts`

- 입력 검증: `commonNumericFactors()`가 이름·열 ID·단위를 대조한다. 단위나 ID가 다르면 그 요인을 제외하고 이유를 반환한다(조용히 다른 축을 그리지 않는다).
- 모든 모형을 같은 격자 좌표에서 평가: `compileSurfaceEvaluator()`가 계수 라벨을 한 번만 파싱하고 항별 `상수 × x^p × y^q`로 계산한다(101×101×반응 수에서도 즉시).
- 판정 기준: `mean`(예측 평균), `confidence`(평균의 95% CI 전체가 규격 안), `prediction`(예측구간 전체가 규격 안). 공분산·자유도가 없는 모형이 하나라도 있으면 `intervalBlocked`에 그 이름을 담고 기준을 비활성화한다(조용히 평균 기준으로 계산하지 않는다).
- 출력: 반응별 만족 마스크·영역(`overlay-region`), 규격 경계선(`spec-line`, LSL/USL 실선·Target 점선), 동시 만족 영역(`feasible-region` + 해칭), 불만족 영역 표시 옵션, 반응별 색·선 스타일·범례, 실험점, **Feasible Area Ratio**.
- 근사 고지: 면적비는 그려진 격자에서 측정한 폴리곤 면적이며, `convergenceDelta = |비율(2배 격자) − 비율(격자)|`를 함께 보고한다. 만족 격자점이 0이면 "영역이 격자점 사이로 좁을 수 있다"는 경고를 낸다.

### 3.2 UI

- 모형 관리자에서 비교용 체크박스로 2개 이상 선택 → `Overlaid contour (n)` 활성. 공통 요인이 2개 미만이면 사유를 표시하고 버튼을 비활성화한다.
- `Overlay` 탭: 요인 쌍·단위·고정값, 반응별 LSL/USL/Target 입력, 기준(평균/신뢰/예측) 선택, 알파, 해상도, 표시 토글, 만족 면적비·격자 비율·격자점 수·수렴도 요약.

## 4. 검증

### 4.1 단위 테스트 (신규 46)

| 파일 | 건수 | 내용 |
| --- | --- | --- |
| `tests/surface3d.test.ts` | 22 | 정점/삼각형 수, NaN 셀 마스킹, 정규화 상자, 메쉬 밀도, Ultra 상한·생성 시간, 카메라 중심·회전·줌·팬, **투영 함수 ↔ WebGL 행렬 일치**, 깊이 단조성, 3D↔2D 노드별 일치(≤1e-10), 정사영 SVG 역할·전체 NaN 처리, 재슬라이스 |
| `tests/feasible.test.ts` | 15 | 공통 요인(단위·ID 충돌), 반 셀 편향을 포함한 면적 측정, 모든 노드의 규격 판정 일관성, 면적비 vs 격자비, 기준별 단조성(mean ≥ confidence ≥ prediction), 공분산 없는 모형 비활성, 만족 불가 경고, 차트 렌더·재계산 |
| `tests/stage3b-linkage.test.ts` | 9 | RSM 페이로드 공분산 = mse·(X'X)⁻¹(대각 = glm.se²), 저장 모형 SE·PI·중심 대칭, 계수 SE, 구형 페이로드 호환, 새 설정 블록 기본값·가드(음수 배율·NaN·적대적 enum·스펙 항목 정리) |

### 4.2 독립 QA (QA-V 6건, `npm run qa:stats` 168/168)

| 케이스 | 기준 엔진 | 비교 |
| --- | --- | --- |
| QA-V-01/02 | statsmodels 2차 적합 → numpy 격자 예측 | 41×41·21×21 노드별 `z`, min/max, 축 범위, 중심 SE, `surface_contour_max_diff`(정확히 0) |
| QA-V-03 | 두 반응을 각각 적합해 같은 격자에서 규격 판정 | 만족 격자 비율·면적비(4배 격자 구적)·프로브 플래그·반응별 비율 |
| QA-V-04 | 같은 판정 + `cov_params` t분위수 | 신뢰구간 기준 비율·`interval_blocked` 공백 |
| QA-V-05 | 같은 판정 + `mse_resid` | 예측구간 기준 비율(신뢰구간보다 좁거나 같음) |
| QA-V-06 | 같은 판정 | 만족 격자점 0·`narrow`·면적 0 |

새 데이터셋 `qa/datasets/rsm_two.json`(시드 11022, CCD 두 반응)을 고정 골든으로 추가했다. 허용오차 클래스 `exact_zero`(두 경로 차이 0), `feasible_area`(폴리곤 vs 4배 구적, 0.02), `grid_count`(경계 노드 2개 이내 반전)는 각각 수치적 이유를 `qa/tolerances.json`에 기록했다.

### 4.3 E2E (로컬 41/41)

`tools/e2e_phase3_3b.cjs` — WebGL(SwiftShader) 컨텍스트와 WebGL 비활성 컨텍스트를 모두 띄운다.

- 저장 모형 → 3D 표면 진입 활성 → 캔버스·프레임 오버레이 렌더
- 드래그 회전(방위 −55→243, 고도 28→42), 휠 줌(1→1.43), Top(고도 89)·Side(방위 270), 투영 전환, Reset
- 드로어 3D 탭: Draft → 41×41 재생성, 렌더 모드·투영 적용
- WebGL 없음: `data-renderer=static`, 안내 문구, 정사영 SVG에 `surface-faces`/`surface-axes` 존재
- PNG 내보내기 성공
- 두 모형 → Overlaid 활성 → 동시 만족 영역·반응별 영역·면적비·격자 근사 문구 렌더
- 규격 편집(78/82) → 면적비 100%→69.9%, 신뢰구간 기준 → 46.8%(단조 감소), 범례에 기준 표기
- 공분산을 제거한 상태를 앱 자체 autosave(IndexedDB)에 심어 재시작 → 관리자 경고, 기준 선택지 1개, 비활성 사유 표시
- 390 px 뷰포트에서 가로 오버플로 0

## 5. 성능·상한

| 해상도 | 격자점 | 정점 버퍼 | 비고 |
| --- | --- | --- | --- |
| Draft | 41×41 | 60 KB | 드로어 기본 미리보기 |
| Standard | 101×101 | 364 KB | 기본값 |
| High | 201×201 | 1.4 MB | |
| Ultra | 401×401 | 5.8 MB(정점) + 3.8 MB(인덱스) | 상한. 정적 정사영은 121×121로 데시메이트해 SVG 경로 폭증을 막는다 |

## 6. 남긴 한계

- 만족 면적은 **격자 근사**다. 반 셀 편향(경계에서 0.5셀)이 존재하며 수렴도를 함께 표시한다.
- 3D 표면의 보간 방식은 쌍선형 고정이다(Minitab의 메쉬 방식 선택은 미구현, PARTIAL로 감사표에 기록).
- 실험점은 `StoredModel.design`이 있는 모형(RSM/DOE)에서만 그려진다. 회귀 모형은 설계 행이 없어 점이 없다.
- Minitab 수치 동등성은 주장하지 않는다. QA는 정의 일치(SciPy/statsmodels)만 검증한다.

## 7. 배포

- PR 스쿼시 머지 → 원격 브랜치 삭제 → GitHub Pages(`gh-pages` Actions) 배포 확인.
- 라이브 URL: <https://hyangdan2.github.io/PKPilot0018/>
- 라이브 스크린샷: `work/pkpilot0018/phase3-3b-surface.png`, `work/pkpilot0018/phase3-3b-overlaid.png` (라이브 E2E 실행에서 촬영).
