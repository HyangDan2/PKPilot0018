# Sigrún — Stage 3A 보고서 (Phase 3 Foundation)

- 저장소: `HyangDan2/PKPilot0018` (HD2Lab Sigrún)
- 브랜치: `feat/chart-engine-phase3-3a` → `main` (스쿼시 머지)
- 범위: **WO-01** Phase 2 잔여 결함·안정성 8항목, **WO-02** Stored Model Manager
- 라이브: https://hyangdan2.github.io/PKPilot0018/

---

## 1. 요약

| 검증 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm test` | **735 / 735 PASS** (24 → 30 테스트 파일, 661 → 735건) |
| `npm run qa:stats` | **162 / 162 PASS, 0 FAIL** (156 → 162, 저장 모형 6건 추가) |
| `npm run build` | 성공, 외부 CDN 없음 |
| Stage 3A E2E `tools/e2e_phase3_3a.cjs` | **27 / 27 PASS** (데스크톱 1440×900 + 모바일 390×844) |
| 회귀 E2E | `e2e_chart_axes.cjs` 6/6 · `e2e_chart_upgrade.cjs` 34/34 · `e2e_stage3.cjs` 176/176 |
| 콘투어 벤치마크 | 41: 15.8 ms · 101: 17.9 ms · 201: 39.2 ms · 401: 109.2 ms (5회 중앙값, 출력 바이트 동일) |

---

## 2. WO-01 — 잔여 결함과 안정성

### 2.1 감사 집계와 실제 구현 일치 (`WO-01/1`)

`docs/CHART_FEATURE_GAP.md`의 §1 요약은 구역별 표와 이미 어긋나 있었다.

| 영역 | 문서가 말하던 값 | 표가 실제로 담고 있던 값 |
| --- | --- | --- |
| Minitab 그래프 편집 | SUPPORTED 3 / PARTIAL 3 / MISSING 2 | **5 / 2 / 1** |
| Minitab Contour Plot | 7 / 4 / 2 / 1 | **8 / 3 / 2 / 1** |
| 합계 | 31 / 25 / 14 / 1 | **34 / 23 / 13 / 1** |

요약표를 실제 표에 맞춰 고쳤고, 같은 드리프트가 다시 생기지 않도록 `tests/gap-doc.test.ts`가 문서를 파싱해 (a) 구역별 분류 집계 = §1 요약, (b) 합계 = 구역 합, (c) 분류·우선순위·공수 어휘, (d) **인용한 모든 코드 심볼이 `src/`에 존재**, (e) 재현 명령 4종 존재를 검사한다.

### 2.2 PNG DPI 메타데이터 (`WO-01/2`)

캔버스로 만든 PNG에는 해상도 정보가 없어 300 DPI로 저장한 그림이 인쇄에서 72 DPI로 열렸다. `src/lib/pngDpi.ts`가 PNG 청크를 바이트 단위로 읽고 `pHYs`를 **IHDR 바로 뒤에 정확히 하나** 넣는다.

| DPI | 기록되는 px/m | 검증 |
| --- | ---: | --- |
| 150 | 5906 | `tests/png-dpi.test.ts` |
| 300 | 11811 | CRC-32 재계산, IHDR 뒤 위치, 기존 pHYs 교체, IDAT 바이트 보존 |
| 600 | 23622 | 단위 바이트 1(미터), 비-PNG·비정상 DPI 거부 |

`svgToPngWithConfig()`가 래스터화 직후 `pngBlobWithDpi()`로 스탬프를 찍는다. E2E가 실제 내려받은 PNG에서 pHYs를 되읽어 **299.9994 DPI**(정수 px/m 반올림)를 확인했다.

### 2.3 분석 재실행 시 설정 유지 (`WO-01/3`)

`App.tsx` 안에만 있던 재실행 설정 기억 로직을 `src/lib/chartMemory.ts`로 분리했다. 슬롯 키는 **종류 + 게시 캡션**이고, 복원은 ① 같은 항목 → ② 같은 종류·같은 위치 → ③ 같은 종류 순으로 짝지으며 **한 슬롯은 한 번만** 쓰인다. 스타일·축 범위·로그축·RSM 요인 쌍·고정값·단위 모드가 모두 유지된다(`tests/chart-memory.test.ts` 11건, E2E `a re-run keeps the chart style`).

### 2.4 다중 차트 설정 전이 (`WO-01/4`)

기존 구현은 **위치로만** 짝지어서, 앞에 차트가 하나 삽입되면(요인 쌍 등고선, 4-in-1 잔차 그림) 뒤 차트의 설정이 이웃으로 밀렸다. 그리고 저장된 설정 객체를 두 카드에 그대로 넘겨 한쪽 편집이 다른 쪽에 보일 수 있었다.

- identity 기반 매칭 + 슬롯 1회 소비 + 복원 시 deep copy로 둘 다 제거.
- E2E: 차트 하나만 Dark로 바꾼 뒤 `data-chart-style`이 정확히 1개만 dark인지 확인.

### 2.5 UI E2E 재실행·보강 (`WO-01/5`)

`tools/e2e_phase3_3a.cjs`(27 검사)를 추가하고 기존 3종을 재실행했다. E2E는 자체 정적 서버를 같은 프로세스에서 띄운다(별도 셸 서버는 셸이 끝나면 죽어 `ERR_CONNECTION_REFUSED`가 났다 — `tools/serve_inline.cjs`).

### 2.6 차트 설정 저장·복원 (`WO-01/6`)

프로젝트 저장이 `customChartStyles`를 넘기지 않아 사용자 스타일과 모형이 파일에 실리지 않았다. 이제 `.sigrun.json`에 **출력(차트 설정)·사용자 스타일·저장 모형**이 함께 실리고, 열 때 스타일·모형은 기존 것을 지우지 않고 병합한다(`tests/model-store.test.ts` 프로젝트 왕복).

### 2.7 비정상 입력 방어 (`WO-01/7`)

`src/lib/chartGuards.ts`가 렌더러 진입점(`createContext`)에서 모든 설정을 검증한다.

| 입력 | 처리 |
| --- | --- |
| 축 min ≥ max, NaN, ±Infinity | 두 끝을 유지해 드로어에 그대로 보이되 렌더러는 데이터 범위로 대체 |
| `majorInterval` 0·음수·NaN | 무시(자동 눈금) |
| `axisMargin` Infinity, `decimals` 999 | 0.5, 12로 상한 |
| 알 수 없는 프리셋·컬러맵·렌더 모드 | 기본값 |
| 등고 `zMin ≥ zMax`, `lsl ≥ usl` | 데이터 범위로 대체(빈 화면 금지) |
| `levelCount` NaN·9999 | 10, 50 |
| 극단 범위(±1e308) | 눈금 step을 유한하게 재계산 |

추가로 **모든 셀이 NaN인 등고선 격자**가 "Constant surface 0"으로 그려지던 결함을 고쳤다(`gridFiniteCells()` → "No finite values to contour"). 테스트는 5종 차트를 적대적 설정으로 렌더해 `NaN`·`Infinity`·`undefined` 토큰 0과 모든 좌표의 유한성을 확인한다.

### 2.8 안장점·Filled Contour 경계 정합성 (`WO-01/8`)

**결함**: 채움 밴드는 셀 사각형을 선형으로 잘라 만들었고, 등고선은 점근 판정기(asymptotic decider)로 그렸다. 안장 셀에서 두 방식의 연결 방식이 달라 밴드가 이웃 밴드와 겹쳤다.

측정값(수정 전 → 수정 후):

| 표면 | 격자 | 정의역 대비 밴드 면적 오차 |
| --- | ---: | ---: |
| `xy` | 6×6 | +2.0 % → **0** |
| `x²−y²` | 4×4 | −5.6 % → **0** |
| `0.3x + xy` | 11×11 | +1.0 % → **0** |
| 평면·포물면 | 4…11 | 0 → 0 |

수정 내용:
- 셀을 `saddleValue` 판정으로 위/아래 영역으로 나누고(`cellRegions`), 위는 아래 영역의 **여집합**으로 만들어 두 밴드가 같은 영역을 동시에 갖지 않게 했다.
- 두 임계값이 모두 안장이 아니면 기존 이중 클리핑(정확·안정)을 그대로 사용.
- 하한 클리핑을 strict(`v > lo`)로 바꿔 값이 정확히 경계인 꼭짓점이 위쪽 밴드 하나에만 속하게 했다.
- 평평한 셀이 두 밴드에 모두 "전체 셀"로 잡히던 이중 계상을 `break`로 막았다.
- 꼭짓점 중복·미세 조각을 정리(`cleanPolygon`).

검증(`tests/contour-bands.test.ts`, 7건): 5개 해석 곡면 × 4개 격자에서 ① 밴드 면적 합 = 정의역(≤ 1e-9), ② 밴드 꼭짓점이 자기 구간 안, ③ 모든 등고선 선분이 밴드 경계 위(≤ 1.8e-12), ④ 안장 셀은 두 조각, ⑤ 경계에 놓인 평평한 셀은 한 밴드만, ⑥ 전면 NaN 격자는 아무것도 그리지 않음, ⑦ NaN 셀은 어떤 밴드에도 들어가지 않음.

---

## 3. WO-02 — Stored Model Manager

설계 전문: `docs/MODEL_STORE_ARCHITECTURE.md`.

### 3.1 저장되는 것

| 출처 | 종류 | 계수 | 공분산 | 비고 |
| --- | --- | --- | --- | --- |
| Fit Regression Model | linear / multiple | O | O (`mse·(X'X)⁻¹`) | R²(pred)까지 |
| GLM / ANOVA | glm | O | O (`xtxInv`) | 범주 수준·sum-to-zero |
| Analyze Factorial Design | doe | O | O | 코딩 단위 계수 |
| Analyze Response Surface | rsm | O | **없음(payload에 없음)** | S·R²·N만, df 없음 |

없는 값은 `null`로 두고 UI가 "없음"이라 표시한다. 공분산이 없으면 SE·예측구간을 계산하지 않는다.

### 3.2 기능

저장 / 이름 변경 / 복제 / 삭제 / 2개 이상 선택 비교(N·dfe·S·R²·R²adj·R²pred·별칭·공분산 유무), 모형별 예측(실제·코딩 단위 전환, SE, 95% 예측구간), Stale 표시와 재적합, 프로젝트·자동 저장 왕복(하위 호환), `modelSurface()`를 통한 등고선 후속 실행 진입(표면·최적화는 Stage 3B–3C 자리).

### 3.3 예측 규칙

- 설계행을 **계수 라벨에서** 재구성한다(`A`, `A×B`, `A²`, `Machine[Line A]`). 해석 불가 라벨은 0을 곱하지 않고 중단.
- 변수 호환성: 이름·열 ID·단위·범주 수준을 검사하고, 열이 사라지거나 형이 바뀌면 관리자에 경고.
- **랭크 부족**: 별칭 계수에 0이 아닌 가중치로 의존하는 예측은 값을 내지 않고 `null` + 해당 항 목록(`not estimable`).

### 3.4 검증

- 단위: `tests/model-store.test.ts` 30건 — 저장 필드, 예측=적합값, SE=s/√n(중심), Coded↔Actual 동등성, 랭크 부족 거부, Stale/재적합, 프로젝트 왕복, 비교표.
- 통계 QA: `qa/cases/QA-J-models.json` 6건 — NumPy·SciPy로 독립 재계산(X'β, x'Σx, t 예측구간)한 값과 최대 상대오차 **1.3e-12**, 랭크 부족은 양쪽 모두 `model.nonEstimable`로 거부.
- E2E: 카드 → 저장 → 관리자 → 예측 → 단위 전환 → 이름 변경 → 복제 → 비교 → 등고선 생성 → 삭제 → 데이터 변경(stale) → 재적합 27/27.

---

## 4. 알려진 한계

| 항목 | 내용 |
| --- | --- |
| RSM payload 공분산 | 엔진 payload에 `(X'X)⁻¹`이 없어 저장 모형의 SE·예측구간이 "없음"이다. 필요하면 Stage 3B에서 `buildRsmModel`이 공분산을 함께 넘기도록 확장한다. |
| 3D 표면·최적화 | 관리자에 자리만 있고 비활성(Stage 3B–3C). |
| `tools/e2e_stage1.cjs` | 스크린샷 단계에서 두 번째 페이지를 열 때 단일 프로세스 Chromium이 종료된다(Phase 2 보고서에 기록된 환경 한계와 동일). 기능 검사는 그 전까지 전부 PASS. |
| 등고선 위상 | 인접 밴드의 경계선은 같은 교차점·같은 판정을 쓰지만, 안장 셀 내부는 여전히 직선 근사(점근 판정기)다. 해석적 쌍곡선 대비 시각적 근사이며 Phase 1의 검증된 규약을 유지했다. |

---

## 5. 배포

| 항목 | 값 |
| --- | --- |
| Pages | https://hyangdan2.github.io/PKPilot0018/ |
| 브랜치 | `feat/chart-engine-phase3-3a` → `main` 스쿼시 머지 후 원격 브랜치 삭제 |
| 워크플로 | `Deploy`, `qa-stats` — 머지 커밋에서 success 확인 |
| 라이브 스모크 | 라이브 URL에서 `tools/e2e_phase3_3a.cjs` 재실행 + 스크린샷 `work/pkpilot0018/phase3-3a-pc.png` |

재현:

```bash
export PATH="/workspace/node/bin:$PATH"
npx tsc --noEmit
npm test
npm run qa:stats
npm run build
node tools/e2e_phase3_3a.cjs          # 자체 정적 서버 사용
```
