## Stage 3A 후속 — 다항 회귀 적합

WO-02의 지원 모형 목록에 **Polynomial Regression**이 있는데, 앱에서 다항 모형을 만들 방법이 없었습니다(회귀는 1차, RSM은 교호작용 포함 2차). 이 PR이 그 구멍을 닫습니다.

### 추가된 것
- **Stat ▸ Regression ▸ Fit Polynomial Regression…** — 예측 변수마다 `x`, `x²`(2차) 또는 `x³`(3차) 항을 적합합니다. 방정식·계수표·분산분석·잔차 4-in-1을 출력하고, 결과를 `kind: 'polynomial'` 저장 모형으로 넘깁니다.
- **파생 항 처리** — `x²`·`x³`은 입력 변수가 아니라 파생 항입니다. 저장 모형의 `predictors[]`에는 `x`만 들어가고, 예측·표면·재적합에서 제곱값을 따로 입력하지 않습니다. 재적합 시 `x` 열에서 자동 재생성됩니다.
- **라벨 파서 수정** — `A²`를 `A`로 읽던 결함(지수 1)을 고쳤습니다. 같은 결함이 QA 참조 엔진에도 있어 양쪽을 함께 수정했고, `A³`까지 지원합니다. 이 수정으로 QA-J-03/04(RSM 예측)의 값이 양쪽 동일하게 갱신됩니다.

### 검증
| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm test` | **749 / 749 PASS** (신규 `tests/polyreg-model.test.ts` 5건: 2차 정확 적합, 방정식/계수표, 3차 항, 파생 항 재적합, 잔차 자유도 부족 거부) |
| `npm run qa:stats` | 162 / 162 PASS |
| `npm run build` | 성공 |
| E2E | **29 / 29** (다항 회귀 카드의 `²` 항, 저장 모형이 `Polynomial regression` 종류로 표시되는지 추가) |

문서: `docs/PHASE3_3A_REPORT.md`(3.1.1 다항 회귀), `docs/MODEL_STORE_ARCHITECTURE.md`(파생 항), `docs/CHART_FEATURE_GAP.md`(검증 스냅샷 갱신)
