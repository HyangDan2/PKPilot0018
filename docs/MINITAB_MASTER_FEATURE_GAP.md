# Sigrún ↔ Minitab 마스터 기능 격차 감사 (WO-01 ~ WO-08)

> **대상**: `HyangDan2/PKPilot0018` — HD2Lab Sigrún (브라우저에서만 도는 통계·품질 워크스페이스)  
> **기준 커밋**: `43b0b071cf010352d8add7600dfa29d158a2b3e3` (main, 2026-11-24 감사 시작 시점)  
> **비교 제품**: Minitab Statistical Software **22.6.x**(2026-10-21 릴리스, 감사일 현재 최신)  
> **감사일**: 2026-11-24 · **문서 접근**: `support.minitab.com` 공개 Help & How-To / Session Command Help (en-us)  

이 문서는 "무엇이 되어 있나"가 아니라 **Minitab 공개 문서의 어떤 기능이 Sigrún에서 어떤 상태인지**를 한 행씩 근거와 함께 남긴다. 모든 수치는 `docs/audit/*.json`·`.csv`·`.html`에서 기계적으로 다시 계산되며 `tools/verify_audit.mjs`가 문서·CSV·JSON·대시보드의 집계가 서로 같은지 검산한다.

## 0. 이번 감사의 정직성 경계

- **Minitab을 실행하지 않았다.** 수치 동등성(numerical equivalence)은 어디에서도 주장하지 않는다. "같은 정의를 택했다"와 "같은 값을 낸다"는 다른 말이며, 이 문서는 전자만 말한다.
- **`FULL`/`PARTIAL`은 소스로 확인한 것만 준다.** `docs/MINITAB_FEATURE_GAP.md`(Stage 2)나 `docs/CHART_FEATURE_GAP.md`에 적힌 문장은 근거로 쓰지 않았고, `src/`의 실제 심볼·레지스트리 항목·테스트 파일을 확인한 뒤에만 상태를 부여했다. 근거가 없으면 `MISSING`이다.
- **`MISSING`은 "메뉴에 없다"가 아니라 "레지스트리와 모듈 인벤토리에 항목이 없다"는 뜻이다.** Sigrún의 분석 진입점은 `src/components/MenuBar.tsx` 하나뿐이고, 그 메뉴는 `src/lib/analyses.ts`의 `ANALYSES`만 호출한다. 따라서 두 목록에 없는 기능은 도구가 없다.
- **미확인 항목은 `UNKNOWN`으로 남겼다.** 이번 감사에서는 0건이다. 대신 Predictive Analytics 모듈의 세부 옵션처럼 공개 문서만으로 옵션 전수를 확정할 수 없는 부분은 `MISSING`+`P3`(범위 밖)로 두고 그 이유를 행에 적었다.
- **분모를 공개한다**(§2). 84개(Stage 2)와 289개(이번)의 차이는 구현이 늘어서가 아니라 **세는 단위와 범위를 바꿨기 때문**이며, 그 내역을 §4에 1:1로 적었다.

## 1. 요약

- Minitab 공개 문서에서 확인한 기능 **289개**를 8개 대영역에 배치했다. Sigrún이 어떤 형태로든 제공하는 기능은 **70개(24.2%)**, 도구가 없는 기능은 **218개**다.
- 상태 분포: **FULL 2 · PARTIAL 65 · DIFFERENT 3 · MISSING 218 · NOT_APPLICABLE 1 · UNKNOWN 0** (Minitab 기능 289개 기준)
- 우선순위: **P0 0 · P1 73 · P2 199 · P3 17** — P0(기존 기능의 정확성·데이터 손실)은 없다. Stage 2에서 P0였던 입력 감사 결함 18건은 그대로 회귀 테스트로 묶여 있다.
- 후속 계획: **Phase 4 85기능 / 14개 작업지시**, **Phase 5 179기능 / 11개**, **Phase 6 25기능 / 6개**. 289개 기능 전부가 정확히 한 Phase에 배정됐다. Phase 4의 기능 수가 P1(73)보다 큰 것은, 같은 엔진을 고치는 김에 묶는 P2 항목 12개가 P1 작업지시에 함께 실렸기 때문이다(각 작업지시의 Feature IDs에 명시).
- 독립 통계 QA: **225건**(`qa/cases/`), 이번 감사에서 `npm run qa:stats`로 **225 PASS / 0 FAIL / 0 REVIEW / 0 UNVERIFIED / 0 ERROR**를 다시 확인했다. 41개 분석 + 20개 모듈 중 **38개**가 하나 이상의 독립 케이스를 갖는다.
- Sigrún 자체 인벤토리: 분석 **41개**, 독립 모듈 **20개**(모형 관리자·최적화·프로파일러·그래프 레이아웃 편집기·튜토리얼·샘플·도움말·Portable 빌드 등).

| 영역 | 항목 | FULL | PARTIAL | DIFFERENT | MISSING | N/A | 구현률 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Data & Workspace | 37 | 0 | 12 | 1 | 23 | 1 | 35.1% |
| Statistical Analysis | 52 | 0 | 11 | 0 | 41 | 0 | 21.2% |
| Statistical Modeling | 32 | 0 | 4 | 2 | 26 | 0 | 18.8% |
| Quality Engineering | 63 | 0 | 15 | 0 | 48 | 0 | 23.8% |
| DOE & Optimization | 28 | 2 | 8 | 0 | 18 | 0 | 35.7% |
| Reliability & Survival | 16 | 0 | 1 | 0 | 15 | 0 | 6.2% |
| Multivariate & Time Series | 25 | 0 | 1 | 0 | 24 | 0 | 4.0% |
| Visualization & Automation | 36 | 0 | 13 | 0 | 23 | 0 | 36.1% |
| **합계** | **289** | **2** | **65** | **3** | **218** | **1** | **24.2%** |

## 2. 분모·범위·집계 기준 (공개)

- **분모 289개**는 Minitab 공개 문서의 분석·차트·데이터 도구·자동화 항목을 "메뉴 한 줄 = 기능 하나"로 옮긴 수다. 출처는 `docs/audit/minitab-reference-inventory.json`이며 각 항목에 `officialReferenceUrl`이 붙어 있다.
- 참조 URL **284개**(중복 제거)를 2026-11-24에 실제로 HTTPS 요청해 **284개 모두 HTTP 200**을 확인했다(`referenceUrlHttpStatus` 필드). URL 확정 방식은 사이트맵 leaf 일치 19건, 섹션 랜딩 페이지 269건, 외부 문서 1건이다.
- **제외한 범위**: Minitab Solution Center·Connect·Model Ops·Engage·Workspace·Simul8 등 다른 제품, 비공개 모듈 내부 옵션, Quality Trainer 과정. 제외 항목과 이유는 참조 인벤토리의 `meta.excluded`에 있다.
- **옵션은 행으로 세지 않았다.** Minitab 대화상자의 세부 옵션은 `Missing Parameters`·`Missing Outputs` 열에 적었다. 그래서 "기능 수"와 "옵션 수"를 더하는 이중 계산이 구조적으로 불가능하다.
- **상태 정의**(`docs/audit/minitab-gap-matrix.json` `meta.statusDefinition`):
  - `FULL` — 공개 문서의 입력·옵션·출력을 모두 제공하고 독립 검증이 있다.
  - `PARTIAL` — 도구는 있으나 공개 문서의 일부 입력·옵션·출력이 없다.
  - `MISSING` — 도구가 없다(레지스트리·모듈 인벤토리에 항목 없음).
  - `DIFFERENT` — 다른 방식으로 제공된다(예: 프로젝트 형식, 결과 카드 안의 부속 그림).
  - `NOT_APPLICABLE` — 데스크톱 전용 컨테이너·외부 앱 연동으로 브라우저 제품에 해당 없음.
  - `UNKNOWN` — 공개 문서만으로 확인하지 못한 부분이 남아 있음.
- **검증 상태 정의**:
  - `INDEPENDENT_VERIFIED` — qa/cases 의 SciPy/statsmodels 독립 기준과 대조한 케이스가 있다.
  - `UNIT_VERIFIED` — 단위 테스트만 있다.
  - `E2E_VERIFIED` — 브라우저 E2E만 있다.
  - `IMPLEMENTATION_ONLY` — 테스트 근거 없이 소스만 확인.
  - `UNVERIFIED` — 확인하지 못함.
  - `FAILED` — 검증 실패.
- `MISSING` 행의 `Verification Status`는 검증할 구현이 없다는 뜻으로 `UNVERIFIED`로 둔다(총 219행). "검증에 실패했다"는 뜻이 아니다.

## 3. 조사 방법 (재현 가능하게)

1. **Minitab 쪽**: `support.minitab.com/en-us/minitab/sitemap.xml`(2026-11-24, 5,788 URL)에서 Help & How-To·Session Command Help 트리를 받아 분석·차트·도구 목록과 URL을 확정하고, 각 항목의 입력·옵션·출력·가정을 공개 문서에서 읽어 참조 인벤토리에 옮겼다. 옵션 목록은 문서 본문을 복제하지 않고 항목명으로 요약했다.
2. **Sigrún 쪽**: `src/lib/analyses.ts`의 `ANALYSES` 41개 항목을 파싱해 슬롯·실행 함수를 뽑고, `src/lib`·`src/components`의 모듈을 열거했다. 각 기능의 근거는 `Source Evidence`(파일·심볼)와 `Test Evidence`(테스트 파일·QA 케이스 ID·E2E 스크립트) 두 열에 남겼다.
3. **대응 판정**: 기능이 있으면 실제 구현 범위를 문서와 1:1로 비교해 `FULL`/`PARTIAL`/`DIFFERENT`, 없으면 `MISSING`, 데스크톱 전용 컨테이너면 `NOT_APPLICABLE`. 판정 근거가 소스에 없으면 상태를 올리지 않았다.
4. **자동 검산**: `tools/verify_audit.mjs`가 ① 21개 필수 필드 ② 상태·검증 어휘 ③ Source Evidence의 파일·심볼 실재 ④ Test Evidence의 파일·QA 케이스 실재 ⑤ JSON↔CSV↔HTML↔이 문서의 집계 일치 ⑥ Phase 배정 완전성 ⑦ 대시보드의 외부 URL 0건을 검사한다.

## 4. Stage 2 문서(`docs/MINITAB_FEATURE_GAP.md`) 대비 변경 내역

Stage 2는 **84개 항목**을 세었고(SUPPORTED 32 · PARTIAL 17 · MISSING 31 · DIFFERENT 4), 이번 감사는 **289개**를 센다. 숫자가 커진 이유는 아래 세 가지이며, "구현이 그만큼 늘었다"는 뜻이 아니다.

1. **분모 확대**: Stage 2는 6개 영역 84항목만 봤다. 이번에는 WO-04가 요구한 8개 대영역으로 넓혀 데이터·파일·환경(37), 다변량·시계열(25), 자동화(매크로·명령)를 포함했다.
2. **세분화**: Stage 2의 "관리도" 16항목은 이번에 관리도 29항목(I-MR 계열 5, 부분군 6, 속성 6, 시간가중 3, 다변량 4, 희소 2, 수용 1, 옵션 2)으로, "공정능력"은 능력분석·식스팩·MSA·품질도구 20항목으로 나눴다.
3. **Stage 2 이후 실제로 늘어난 구현**: 아래 항목은 Stage 2 문서에 없던 것이 Stage 3에서 실제로 들어왔고, 이번 감사가 상태를 새로 매긴 것이다. 각 항목의 근거는 매트릭스 행의 `Source Evidence`에 있다.

| Stage 2 이후 추가된 구현 | 근거(소스) | 이번 판정에 미친 영향 |
| --- | --- | --- |
| 로그·대칭로그·거듭제곱 축, 깨진 축, 날짜 축, 보조 축 | `src/lib/axisAdvanced.ts` | Stage 2의 "로그 축 MISSING" 판정을 `M-D8-028 PARTIAL`로 바꿨다. |
| 오차 막대(SD·SE·t CI) | `src/lib/chartConfig.ts` `ErrorBarConfig` | 차트 계열 옵션군(`M-D8-027~031`)이 PARTIAL로 올라갔다. |
| 등고선 색상맵·수준별 스타일·마스크 | `src/lib/chartStyles.ts`, `src/lib/contour.ts` | `M-D5-023`·`M-D8-019`가 PARTIAL. |
| 저장 모형 계층(Model Manager·staleness·비교) | `src/lib/modelStore.ts`, `src/components/ModelManager.tsx` | `M-D3-032`·`S-MOD-07` 신규. |
| 다중 반응 최적화(Derringer–Suich) | `src/lib/optimizer.ts`, `desirability.ts` | `M-D5-022`를 **FULL**로 판정(Stage 2는 MISSING). |
| 예측 프로파일러·예측 교차검증 | `src/lib/profiler.ts`, `predictionAdapter.ts` | `M-D3-032 PARTIAL`, `S-MOD-09` 신규. |
| 중첩 등고선·실행가능영역 | `src/lib/feasible.ts`, `contour.ts` | `M-D5-025` **FULL**. |
| 3D 표면(WebGL + SVG 폴백) | `src/lib/surface3d.ts`, `surfaceGl.ts` | `M-D5-024`·`M-D8-021` PARTIAL. |
| 그래프 레이아웃 편집기(주석 9종·페이지 프리셋·DPI 내보내기) | `src/lib/graphLayout.ts`, `chartExport.ts` | `M-D8-030` PARTIAL, `S-MOD-06` 신규. |
| 차트 상호작용(확대·커서·선택·연동) | `src/lib/chartInteraction.ts` | `S-MOD-05` 신규. |
| 튜토리얼 12개·샘플 8종·도움말 23문서 | `src/tutorials`, `src/samples`, `src/help` | Sigrún 독립 계층으로 인벤토리에 등재. |
| Portable 단일 HTML 오프라인 빌드 | `tools/build_portable.mjs` | `S-MOD-17` 신규. |

**바뀌지 않은 판정도 있다.** Stage 2가 P1로 지목한 상관분석·비모수·교차표·GLM 공변량·관리도 단계·Box-Cox·부분요인·분포 ID는 이번에도 그대로 `MISSING`이며 P1이다. Stage 2의 P0 18건은 소스와 테스트로 확인했고 여전히 회귀 테스트가 지킨다.

## 5. 영역별 상세 요약

### 5.1 데이터·워크시트·파일 — 37항목 (구현 13)

| Minitab 기능 | Sigrún | 상태 | 검증 | 비고 |
| --- | --- | --- | --- | --- |
| 워크시트 구조와 다중 시트 | 워크시트 그리드·다중 시트 | PARTIAL | UNIT_VERIFIED | 동시 표시 시트 수 제한 없음(메모리 한계) |
| 데이터 유형 3종 | 워크시트 그리드·다중 시트 | PARTIAL | UNIT_VERIFIED | 날짜 산술·서식 없음 |
| 열 유형 변환 | 워크시트 그리드·다중 시트 | PARTIAL | UNIT_VERIFIED | 별도 변환 대화상자 없음 |
| 열 서식 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 조건부 서식 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 정렬 | 정렬 | PARTIAL | E2E_VERIFIED | 키 1개만 지원 |
| 순위 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| Recode (값 재코드) | 코드 변환 | PARTIAL | E2E_VERIFIED | 문자 열은 명시 거부 |
| 문자 결합 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 날짜·시간 성분 추출/반올림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 열 스택 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 워크시트 스택 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 열 Unstack | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 전치 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 부분집합 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 시트 분할 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 시트 병합 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 계산기(수식 열) | 계산기 | PARTIAL | UNIT_VERIFIED | 함수 집합 소수 |
| 패턴 데이터 생성 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 행렬 연산 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 열/행 통계량 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 표준화 | 표준화 | PARTIAL | E2E_VERIFIED | 표준화 모수 지정 없음 |
| 지시변수 생성 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 메시 데이터 생성 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 확률분포 계산 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 난수 생성 | 난수 생성 | PARTIAL | E2E_VERIFIED | 정규·균등·정수 3종만 |
| 파일 열기·가져오기 | 가져오기·내보내기 | PARTIAL | E2E_VERIFIED | 텍스트·엑셀만 지원 |
| 데이터베이스 가져오기 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 클립보드 붙여넣기 | 워크시트 그리드·다중 시트 | PARTIAL | UNIT_VERIFIED | 브라우저 클립보드 권한에 의존 |
| 저장·내보내기 | 프로젝트 파일(.sigrun.json)과 자동 저장 | DIFFERENT | E2E_VERIFIED | Minitab 형식과 호환되지 않음 |
| 그래프·보고서 내보내기 | 차트 내보내기·복사 | PARTIAL | UNIT_VERIFIED | 문서 앱 직접 전송 없음 |
| Minitab 파일 형식 | 없음 | NOT_APPLICABLE | UNVERIFIED | Minitab 데스크톱 전용 컨테이너 |
| 인쇄 | 차트 내보내기·복사 | PARTIAL | IMPLEMENTATION_ONLY | 전용 인쇄 레이아웃 없음 |
| 기본 설정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 인터페이스 사용자 설정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| exec 매크로 실행 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| Python/R 연동 | 없음 | MISSING | UNVERIFIED | 범위 밖 |

### 5.2 기초 통계 — 52항목 (구현 11)

| Minitab 기능 | Sigrún | 상태 | 검증 | 비고 |
| --- | --- | --- | --- | --- |
| 기술통계량 | 기술통계량 | PARTIAL | INDEPENDENT_VERIFIED | 통계량 선택 불가 |
| 기술통계량 저장 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 그래픽 요약 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 정규성 검정 | 정규성 검정 | PARTIAL | INDEPENDENT_VERIFIED | 검정 방법 선택 없음 |
| 이상치 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 1표본 Z 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 1표본 t 검정 | 1표본 t | PARTIAL | INDEPENDENT_VERIFIED | 요약 입력 없음 |
| 2표본 t 검정 | 2표본 t | PARTIAL | INDEPENDENT_VERIFIED | 요약 입력 없음 |
| 대응표본 t 검정 | 대응 t | PARTIAL | INDEPENDENT_VERIFIED | 요약 입력 없음 |
| 1비율 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 2비율 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 1표본 포아송 비율 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 2표본 포아송 비율 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 1분산 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 2분산 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 상관분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 공분산 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 포아송 적합도 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 빈도 집계 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 교차표·카이제곱 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 카이제곱 적합도 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 카이제곱 독립성 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 표 요약 통계량 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 1표본 부호 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 1표본 Wilcoxon | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| Mann–Whitney 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| Kruskal–Wallis 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| Mood 중앙값 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| Friedman 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 런 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 쌍별 평균·차이·기울기 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 1표본 동등성 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 2표본 동등성 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 대응 동등성 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 2×2 교차설계 동등성 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 검정력·표본크기(1표본 t) | 검정력과 표본 크기 — 1표본 t | PARTIAL | INDEPENDENT_VERIFIED | 표 반올림 차이 |
| 검정력·표본크기(2표본 t) | 검정력과 표본 크기 — 2표본 t | PARTIAL | INDEPENDENT_VERIFIED | 표 반올림 차이 |
| 검정력·표본크기(대응 t) | 검정력과 표본 크기 — 대응표본 t | PARTIAL | INDEPENDENT_VERIFIED | 표 반올림 차이 |
| 검정력·표본크기(1표본 Z) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 검정력·표본크기(1비율) | 검정력과 표본 크기 — 1 비율 | PARTIAL | INDEPENDENT_VERIFIED | 정규근사만 |
| 검정력·표본크기(2비율) | 검정력과 표본 크기 — 2 비율 | PARTIAL | INDEPENDENT_VERIFIED | 정규근사만 |
| 검정력·표본크기(포아송 비율) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 검정력·표본크기(2 포아송) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 검정력·표본크기(1분산) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 검정력·표본크기(2분산) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 검정력·표본크기(일원 ANOVA) | 검정력과 표본 크기 — 일원배치 ANOVA | PARTIAL | INDEPENDENT_VERIFIED | 표 반올림 차이 |
| 검정력·표본크기(2수준 요인) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 검정력·표본크기(PB 설계) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 검정력·표본크기(일반 요인) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 추정용 표본 크기 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 공차구간용 표본 크기 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 검정력·표본크기(동등성) | 없음 | MISSING | UNVERIFIED | 도구 없음 |

### 5.3 통계 모델링 — 32항목 (구현 6)

| Minitab 기능 | Sigrún | 상태 | 검증 | 비고 |
| --- | --- | --- | --- | --- |
| 일원배치 분산분석 | 일원배치 분산분석 | PARTIAL | INDEPENDENT_VERIFIED | Tukey만 |
| 평균 분석(ANOM) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 균형 분산분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 일반선형모형(GLM) | 일반선형모형 | PARTIAL | INDEPENDENT_VERIFIED | 공변량·랜덤효과 없음 |
| 혼합효과모형 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 완전 중첩 분산분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 다변량 분산분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 등분산 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 구간 그림 | 일원배치 분산분석 | DIFFERENT | INDEPENDENT_VERIFIED | 독립 도구 아님 |
| 주효과 그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 교호작용 그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 적합선 그림 | 산점도 | DIFFERENT | E2E_VERIFIED | 적합선 그림 전용 도구 아님 |
| 다중회귀분석 | 회귀분석 | PARTIAL | INDEPENDENT_VERIFIED | 범주·선택 알고리즘 없음 |
| 최적 부분집합 회귀 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 비선형 회귀 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 직교 회귀 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 부분최소제곱(PLS) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 이진 로지스틱 회귀 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 순서형 로지스틱 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 명목형 로지스틱 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 포아송 회귀 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 이진 적합선 그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 안정성 연구 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 안정성 시험 시트 생성 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| CART 회귀 | 없음 | MISSING | UNVERIFIED | 범위 밖 |
| TreeNet 회귀 | 없음 | MISSING | UNVERIFIED | 범위 밖 |
| 랜덤 포레스트 | 없음 | MISSING | UNVERIFIED | 범위 밖 |
| MARS 회귀 | 없음 | MISSING | UNVERIFIED | 범위 밖 |
| 최적 모형 탐색 | 없음 | MISSING | UNVERIFIED | 범위 밖 |
| 분류 모형(CART/TreeNet/RF) | 없음 | MISSING | UNVERIFIED | 범위 밖 |
| 사후 다중비교 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 예측(적합 모형) | 예측 프로파일러 | PARTIAL | INDEPENDENT_VERIFIED | 시트 저장 없음 |

### 5.4 품질 엔지니어링 — 63항목 (구현 15)

| Minitab 기능 | Sigrún | 상태 | 검증 | 비고 |
| --- | --- | --- | --- | --- |
| I-MR 관리도 | I-MR 관리도 | PARTIAL | INDEPENDENT_VERIFIED | 단계·규칙 선택 없음 |
| 개별값 관리도 | I-MR 관리도 | PARTIAL | INDEPENDENT_VERIFIED | 개별값 단독 도구 아님 |
| 이동범위 관리도 | I-MR 관리도 | PARTIAL | INDEPENDENT_VERIFIED | MR 단독 도구 아님 |
| I-MR-R/S 관리도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| Z-MR 관리도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| Xbar-R 관리도 | Xbar-R 관리도 | PARTIAL | INDEPENDENT_VERIFIED | ID 열 없음 |
| Xbar-S 관리도 | Xbar-S 관리도 | PARTIAL | INDEPENDENT_VERIFIED | 단계 없음 |
| Xbar 관리도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| R 관리도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| S 관리도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 존 관리도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| P 관리도 | P 관리도 | PARTIAL | INDEPENDENT_VERIFIED | Laney·단계 없음 |
| NP 관리도 | NP 관리도 | PARTIAL | INDEPENDENT_VERIFIED | 단계 없음 |
| C 관리도 | C 관리도 | PARTIAL | INDEPENDENT_VERIFIED | 단계 없음 |
| U 관리도 | U 관리도 | PARTIAL | INDEPENDENT_VERIFIED | Laney·단계 없음 |
| Laney P′ 관리도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| Laney U′ 관리도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| CUSUM 관리도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| EWMA 관리도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 이동평균 관리도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| T² 관리도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 일반화 분산 관리도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| T² + 일반화 분산 결합 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 다변량 EWMA | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| G 관리도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| T 관리도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 수용 관리도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 관리도 옵션 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 관리도 Box-Cox 변환 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 개별 분포 식별 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| Johnson 변환 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 파레토 차트 | 파레토 차트 | PARTIAL | INDEPENDENT_VERIFIED | 가중치 없음 |
| 특성요인도(피시본) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 다변량 차트 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 런 차트 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 대칭 그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 변동 차트 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 공차구간(정규) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 공차구간(비정규) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 정규 공정능력 분석 | 공정능력 보고서 | PARTIAL | INDEPENDENT_VERIFIED | 경계·과거 모수 없음 |
| 비정규 공정능력 분석 | 비정규 공정능력 분석 | PARTIAL | INDEPENDENT_VERIFIED | 3종만 |
| 비모수 공정능력 분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 군간/군내 공정능력 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 이항 공정능력 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 포아송 공정능력 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 정규 능력 식스팩 | 공정능력 Sixpack | PARTIAL | INDEPENDENT_VERIFIED | 비정규·B/W 변형 없음 |
| 비정규 능력 식스팩 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 군간/군내 식스팩 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 다변수 능력 분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 자동 능력 분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 교차 Gage R&R | Gage R&R 연구 | PARTIAL | INDEPENDENT_VERIFIED | Xbar-R 방법 없음 |
| 중첩 Gage R&R | Gage R&R 연구 | PARTIAL | INDEPENDENT_VERIFIED | - |
| 확장 Gage R&R | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| Type 1 Gage Study | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 직선성·편의 연구 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 속성 일치도 분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 속성 Gage 연구(해석적) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 속성 시료 채취 | 없음 | MISSING | UNVERIFIED | 범위 밖 |
| 계량 시료 채취(합격/불합격) | 없음 | MISSING | UNVERIFIED | 범위 밖 |
| 계량 시료 채취(계획 생성·비교) | 없음 | MISSING | UNVERIFIED | 범위 밖 |
| 식스 시그마 공정 보고서 | 없음 | MISSING | UNVERIFIED | 범위 밖 |
| 식스 시그마 제품 보고서 | 없음 | MISSING | UNVERIFIED | 범위 밖 |
| Gap Pool 계산 | 없음 | MISSING | UNVERIFIED | 범위 밖 |

### 5.5 DOE·최적화 — 28항목 (구현 10)

| Minitab 기능 | Sigrún | 상태 | 검증 | 비고 |
| --- | --- | --- | --- | --- |
| 2수준 요인 설계 생성 | 요인설계 생성 | PARTIAL | INDEPENDENT_VERIFIED | 부분요인·블록 없음 |
| 2수준 요인 설계(2~15요인) | 요인설계 생성 | PARTIAL | INDEPENDENT_VERIFIED | 부분요인 없음 |
| Definitive Screening 설계 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| Plackett–Burman 설계 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 사용자 정의 요인 설계 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 최적 설계 선택 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 설계 표시·수정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 요인 설계 분석 | 요인설계 분석 | PARTIAL | INDEPENDENT_VERIFIED | 축소 없음 |
| 요인 설계 이진 반응 분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 요인 설계 변동 분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 반응표면 설계 생성 | 반응표면 설계 생성 | PARTIAL | INDEPENDENT_VERIFIED | 블록·α 선택 없음 |
| 반응표면 분석 | 반응표면 분석 | PARTIAL | INDEPENDENT_VERIFIED | 축소·다중 반응 없음 |
| 반응표면 이진 반응 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 혼합물 설계 생성 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 혼합물 분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 심플렉스 설계 그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 반응 trace 그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 다구찌 설계 생성 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 다구찌 분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 다구찌 예측 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 빠른 설계(2수준/일반 요인) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 반응 최적화(다중 반응) | 다중 반응 최적화(Response Optimizer) | FULL | INDEPENDENT_VERIFIED | 외삽은 거부로 처리(경고 아님) |
| 등고선도 | 등고선·실행가능영역 | PARTIAL | INDEPENDENT_VERIFIED | 나머지 요인은 중심 고정 |
| 3D 표면도 | 3D 표면(WebGL) | PARTIAL | INDEPENDENT_VERIFIED | 래스터 합성 패널 |
| 중첩 등고선 | 등고선·실행가능영역 | FULL | INDEPENDENT_VERIFIED | 3요인 동시 슬라이스 없음 |
| 큐브 그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 요인 그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 효과 그림 | 요인설계 분석 | PARTIAL | INDEPENDENT_VERIFIED | 주효과/교호작용 그림 없음 |

### 5.6 신뢰성·생존 — 16항목 (구현 1)

| Minitab 기능 | Sigrún | 상태 | 검증 | 비고 |
| --- | --- | --- | --- | --- |
| 모수 분포 분석(우측 중도절단) | Weibull 분포 분석 | PARTIAL | INDEPENDENT_VERIFIED | 2모수·우측 중도절단만 |
| 분포 ID 도표 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 분포 개요 도표 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 비모수 분포 분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 가속 수명 시험 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 시험 계획(추정) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 시험 계획(입증) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 시험 계획(가속) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 성장 곡선(모수) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 성장 곡선(비모수) | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 수명 데이터 회귀 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| Cox 비례위험 회귀 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 프로빗 분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 보증 데이터 전처리 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 보증 예측 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 안정성(수명) 분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |

### 5.7 다변량·시계열 — 25항목 (구현 1)

| Minitab 기능 | Sigrún | 상태 | 검증 | 비고 |
| --- | --- | --- | --- | --- |
| 주성분 분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 요인 분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 관측치 군집 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 변수 군집 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| K-평균 군집 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 판별 분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 문항 분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 단순 대응분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 다중 대응분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 시계열 그림 | 시계열 그림 | PARTIAL | E2E_VERIFIED | 단일 열만 |
| 자기상관 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 부분자기상관 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 교차상관 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| ARIMA 모형 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 최적 ARIMA 자동 선택 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| ADF 단위근 검정 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 시계열 분해 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 차분 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 시차 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 이동평균 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| SES 지수평활 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| DES 지수평활 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| Winters 계절 지수평활 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 추세 분석 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 시계열 Box-Cox | 없음 | MISSING | UNVERIFIED | 도구 없음 |

### 5.8 시각화·자동화 — 36항목 (구현 13)

| Minitab 기능 | Sigrún | 상태 | 검증 | 비고 |
| --- | --- | --- | --- | --- |
| 산점도 | 산점도 | PARTIAL | E2E_VERIFIED | By 별도 그래프 분리 없음 |
| 구간 산점도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 상자그림 | 상자그림 | PARTIAL | INDEPENDENT_VERIFIED | 중첩·구간 없음 |
| 히스토그램 | 히스토그램 | PARTIAL | INDEPENDENT_VERIFIED | By 패널 없음 |
| 개별값 그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 구간 그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 선 그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 막대 그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 원그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 산점도 행렬 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 상관도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 버블 그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 주변 그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 확률도 | 정규성 검정 | PARTIAL | INDEPENDENT_VERIFIED | 정규만 |
| 경험적 CDF | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 확률분포도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 시계열 그림 | 시계열 그림 | PARTIAL | E2E_VERIFIED | 동일 |
| 히트맵 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 등고선도 | 등고선·실행가능영역 | PARTIAL | INDEPENDENT_VERIFIED | 2요인만 |
| 3D 산점도 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 3D 표면도 | 3D 표면(WebGL) | PARTIAL | INDEPENDENT_VERIFIED | - |
| 평행좌표 그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 점 그림·줄기잎 그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 영역 그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 웨이퍼 그림 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 그래프 내 표 요약 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 그래프 편집 | 차트 속성 드로워(축·계열·등고·표시) | PARTIAL | UNIT_VERIFIED | 캔버스 직접 편집 없음 |
| 축·눈금 프레임 편집 | 차트 속성 드로워(축·계열·등고·표시) | PARTIAL | UNIT_VERIFIED | 눈금 값 편집 없음 |
| 그룹·다중 그래프 | 차트 속성 드로워(축·계열·등고·표시) | PARTIAL | UNIT_VERIFIED | - |
| 레이블·선·주석 | 그래프 레이아웃 편집기 | PARTIAL | E2E_VERIFIED | 차트 카드 자체 주석 없음 |
| 표시 옵션 | 차트 속성 드로워(축·계열·등고·표시) | PARTIAL | UNIT_VERIFIED | - |
| 중요 데이터 강조 | 없음 | MISSING | UNVERIFIED | 도구 없음 |
| 매크로 언어 | 없음 | MISSING | UNVERIFIED | 범위 밖 |
| 매크로 라이브러리 | 없음 | MISSING | UNVERIFIED | 범위 밖 |
| 명령줄·히스토리 | 없음 | MISSING | UNVERIFIED | 범위 밖 |
| 세션 출력 저장 | 프로젝트 파일(.sigrun.json)과 자동 저장 | PARTIAL | IMPLEMENTATION_ONLY | 세션 로그 형식 없음 |

## 6. 독립 통계 QA 커버리지 (WO-05)

- 하네스: `qa/cases/*.json`(225건) → `qa/adapters/sigrun/cli.ts`(출하 엔진 직접 호출) → `qa/reference`(SciPy 1.18.1·statsmodels 0.15.0) → `qa/compare.py`. Sigrún 코드로 만든 기대값은 쓰지 않는다.
- 오늘 실행 결과: **225 cases → PASS 225 · FAIL 0 · REVIEW 0 · UNVERIFIED 0 · ERROR 0**, 통과율 PASS/(PASS+FAIL)=100.0%.
- 판정 규칙: REVIEW·UNVERIFIED는 PASS로 합산하지 않는다. 허용오차를 넓혀 통과시키지 않으며, 모든 비기본 허용오차는 수치적 이유를 `qa/tolerances.json`에 먼저 적는다.

| 기능 | QA 케이스 수 | 케이스 ID(앞 6개) |
| --- | ---: | --- |
| 다중 반응 최적화(Response Optimizer) | 29 | QA-W-01, QA-W-02, QA-W-03, QA-W-04, QA-W-05, QA-W-06 … |
| 등고선·실행가능영역 | 23 | QA-V-03, QA-V-04, QA-V-05, QA-V-06, QA-V-07, QA-V-08 … |
| Weibull 분포 분석 | 13 | QA-F-01, QA-F-02, QA-F-03, QA-F-04, QA-F-05, QA-F-06 … |
| 워크시트 그리드·다중 시트 | 9 | QA-U-01, QA-U-02, QA-U-03, QA-U-04, QA-U-05, QA-U-06 … |
| 공정능력 보고서 | 7 | QA-D-01, QA-D-02, QA-D-03, QA-D-04, QA-D-05, QA-D-06 … |
| Gage R&R 연구 | 7 | QA-E-01, QA-E-02, QA-E-03, QA-E-04, QA-E-05, QA-E-06 … |
| 기술통계량 | 6 | QA-A-01, QA-A-02, QA-A-03, QA-A-04, QA-A-05, QA-A-06 |
| 검정력과 표본 크기 — 1표본 t | 6 | QA-G-01, QA-G-02, QA-G-03, QA-G-16, QA-G-18, QA-G-20 |
| 검정력과 표본 크기 — 1 비율 | 6 | QA-G-10, QA-G-11, QA-G-12, QA-G-17, QA-G-21, QA-G-19 |
| 차트 속성 드로워(축·계열·등고·표시) | 6 | QA-Y-01, QA-Y-02, QA-Y-03, QA-Y-04, QA-Y-05, QA-Y-06 |
| 저장 모형 관리자(Model Manager) | 6 | QA-J-01, QA-J-02, QA-J-03, QA-J-04, QA-J-05, QA-J-06 |
| 1표본 t | 5 | QA-A-11, QA-A-12, QA-A-13, QA-A-14, QA-X-04 |
| 공정능력 Sixpack | 5 | QA-D-08, QA-D-09, QA-D-10, QA-D-11, QA-D-17 |
| 비정규 공정능력 분석 | 5 | QA-D-12, QA-D-13, QA-D-14, QA-D-15, QA-D-16 |
| 일반선형모형 | 5 | QA-B-02, QA-B-03, QA-B-04, QA-B-05, QA-B-06 |
| 정규성 검정 | 4 | QA-A-07, QA-A-08, QA-A-09, QA-A-10 |
| 2표본 t | 4 | QA-A-15, QA-A-16, QA-A-17, QA-X-05 |
| 대응 t | 4 | QA-A-18, QA-A-19, QA-A-20, QA-X-06 |
| 회귀분석 | 4 | QA-A-23, QA-A-24, QA-X-02, QA-X-03 |
| Xbar-R 관리도 | 4 | QA-C-03, QA-C-04, QA-C-05, QA-C-16 |
| 계산기 | 4 | QA-I-01, QA-I-02, QA-I-03, QA-I-04 |
| 요인설계 생성 | 4 | QA-H-01, QA-H-02, QA-H-03, QA-H-10 |
| 일원배치 분산분석 | 3 | QA-A-21, QA-A-22, QA-B-01 |
| I-MR 관리도 | 3 | QA-C-01, QA-C-02, QA-C-14 |

- QA 케이스가 없는 기능은 **23개**다. 대부분 화면·레이아웃 계층(S-MOD-05·06·12·13·16·17·18·19)이며, 이들은 E2E·단위 테스트로만 검증된다는 사실을 매트릭스의 `Verification Status`에 그대로 적었다.

### 6.1 방법론 차이 (WO-05 요구 10항목)

- **Default method** — Minitab은 대화상자 기본값(예: 2표본 t의 Welch 여부, 정규성 검정 3종)을 제품 설정에 따라 적용한다. Sigrún은 슬롯 기본값을 코드에 고정하고 화면에 표시한다(예: t2의 Welch 기본 켜짐).
- **Quantile definition** — Sigrún은 type-6(h=(n+1)p) 사분위를 쓴다. QA는 NumPy quantile(method="weibull")로 대조한다.
- **Degrees of freedom** — Welch–Satterthwaite df, pooled df=n₁+n₂−2, Tukey df=MSW df. Minitab 문서와 같은 정의를 택했으나 표 반올림 차이는 남는다.
- **Missing value policy** — 행 단위 제외(열별 유효값). Minitab의 "*" 결측과 같은 결과를 노리지만 셀 표시는 공백이다.
- **Confidence interval method** — t 분위수 기반 정확 구간(비율은 정규근사). Minitab의 정확 이항 구간과 다르다.
- **Hypothesis direction** — two-sided/less/greater 3종. 단측에서 반대 방향 효과는 검정력 α로 떨어지는 것을 QA-G-16·17이 고정한다.
- **P-value approximation** — AD 정규성 p는 근사식, Weibull CI는 프로파일 우도. 검정력은 비중심 t·F 분포의 CDF(`src/lib/dist.ts`의 `nctCdf`·`ncfCdf`: Simpson 수치 적분·Poisson 혼합 불완전 베타)로 그대로 계산하며, Minitab 표와는 반올림 자리에서만 다를 수 있다. Minitab의 표·정확 방법과 수치 동등성은 주장하지 않는다.
- **Numerical stability** — ULP 격자 허용오차, s=0·n<3 등 퇴화 입력은 NaN/명시 오류로 처리하고 0으로 위장하지 않는다.
- **Distribution fitting** — Weibull·로그정규·감마 3종 MLE. Minitab 11종과 범위가 다르다.
- **Optimization criteria** — Derringer–Suich 만족도 + 중요도 가중 기하평균, 격자+다국소 탐색. Minitab의 최적화 알고리즘과 동일하다고 주장하지 않는다(QA-W가 SciPy differential_evolution+L-BFGS-B로 독립 확인).

## 7. 우선순위별 격차와 Phase 계획

| 우선순위 | 정의 | 기능 수 |
| --- | --- | ---: |
| P0 | 기존 구현의 정확성·데이터 손실 | 0 |
| P1 | Minitab 사용자의 일상 흐름이 끊기는 지점 | 73 |
| P2 | 있으면 좋은 편의·표현 옵션 | 199 |
| P3 | 별도 모듈·브라우저 제품 범위 밖 | 17 |

| Phase | 기능 수 | 작업지시 | 문서 |
| --- | ---: | ---: | --- |
| Phase 4 | 85 | 14 | `docs/PHASE4_BACKLOG.md` |
| Phase 5 | 179 | 11 | `docs/PHASE5_BACKLOG.md` |
| Phase 6 | 25 | 6 | `docs/PHASE6_BACKLOG.md` |

각 작업지시는 12개 필수 필드(Work Order ID, Feature IDs, Priority, Implementation Scope, Mathematical Requirements, Input/Output Contract, Dependencies, Implementation Complexity, Independent Reference, Acceptance Criteria, Required Sample/Help/Tutorial, Regression Test Requirements)를 모두 채웠다. 중복 기능은 같은 엔진(예: `lib/stats.ts`·`lib/dist.ts`·`lib/doe.ts`)으로 묶어 한 작업지시 안에서 통합한다.

**Phase 4 착수 순서(요약)**

1. **WO-P4-01** 상관·교차표·카이제곱: 기초 통계의 빈 자리 채우기 — 7기능 · M
2. **WO-P4-02** 비모수 검정 6종 — 6기능 · M
3. **WO-P4-03** 워크시트 재구조화: Stack·Unstack·Transpose·Subset·Split·Merge — 8기능 · M
4. **WO-P4-04** 열 메타데이터: 서식·유형 변환 보고·순위·지시변수·조건부 서식 — 5기능 · S
5. **WO-P4-05** 관리도 단계·한계 고정·규칙 선택 — 10기능 · M
6. **WO-P4-06** 정규성 확장과 변환: Box-Cox·Johnson·분포 식별 — 6기능 · L
7. **WO-P4-07** 회귀·GLM 모형 언어: 공변량·범주·단계적·최적부분집합 — 3기능 · L
8. **WO-P4-08** DOE 스크리닝: 부분요인·Plackett–Burman·Definitive Screening·블록 — 4기능 · L

## 8. 미확인 항목과 조사 한계

- Minitab 미실행: 수치 동등성·화면 동작 동등성은 주장하지 않는다. 문서에 적힌 정의와 옵션만 비교했다.
- 공개 문서에 없는 데스크톱 UI 전용 옵션(예: 일부 대화상자의 세부 체크박스)은 열거하지 못했다. 그런 항목은 `Missing Parameters`에 "공개 문서 기준"으로 적었다.
- Minitab Web App의 명령 제한 목록(`Commands that are unavailable in the web app`)은 항목별로 전수 대조하지 않았다.
- Predictive Analytics 모듈(별도 유료)의 옵션 전수는 공개 문서로 확정하지 못해 6개 기능을 `MISSING`+`P3`로 두고 "모듈 내부 옵션 미확인"을 한계로 적었다.
- Sigrún 쪽은 소스를 읽어 확인했지만, 브라우저·기기별 성능 차이(대용량·WebGL)는 벤치마크 문서(`docs/PHASE3_UPGRADE_REPORT.md`)의 범위를 넘지 않는다.

## 9. 검증 스냅샷 (이번 감사 실행)

| 항목 | 결과 |
| --- | --- |
| 기준 커밋 | `43b0b071cf010352d8add7600dfa29d158a2b3e3` |
| Minitab 참조 URL | 284개 요청 · HTTP 200 284 · 실패 0 |
| 독립 QA | 225/225 PASS (`npm run qa:stats`) |
| 단위 테스트 | `npm test` — 47 파일 1,096건 통과(감사 시작 기준) · 2026-11-25 WO-FINAL-001 재검증 54 파일 1,215건 |
| 감사 자산 검산 | `node tools/verify_audit.mjs` — 0 errors(2026-11-25 재실행 포함) |

## 10. 산출물

| 파일 | 내용 |
| --- | --- |
| `docs/audit/minitab-reference-inventory.json` | Minitab 기능 289개 · 16개 추출 필드 + 공식 URL |
| `docs/audit/sigrun-feature-inventory.json` | Sigrún 분석 41개 + 모듈 20개 · 증빙 12필드 |
| `docs/audit/minitab-gap-matrix.json` / `.csv` | 대응 매트릭스 300행 × 21필드 |
| `docs/audit/qa-coverage.json` | 225케이스의 분석별 매핑 + 방법론 차이 10항목 |
| `docs/audit/audit-summary.json` | 모든 집계의 단일 출처 |
| `docs/audit/phase-backlog.json` | Phase 4~6 작업지시 원본 |
| `docs/audit/minitab-gap-dashboard.html` | 오프라인 단일 HTML 대시보드 |
| `docs/PHASE4_BACKLOG.md`·`PHASE5_BACKLOG.md`·`PHASE6_BACKLOG.md` | 개발 계획 |
| `tools/verify_audit.mjs` | 자동 검산(0 errors) |

## 11. 재현

```bash
npm test            # 54 파일 / 1,215건 (감사 시작 시 47 파일 / 1,096건)
npm run qa:stats    # 225/225 PASS
npx tsc --noEmit    # 0 errors
node tools/verify_audit.mjs   # 감사 자산 정합성 0 errors
```

> 이 감사는 문서·JSON·CSV·HTML만 만들었고 **신규 통계 기능을 개발하지 않았다**. 코드 변경은 `tools/verify_audit.mjs`와 `docs/audit/*` 뿐이다.
