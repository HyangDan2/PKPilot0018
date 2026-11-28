# Statelia Guided Tutorial System — WO-3E-11

> 저장소: `HyangDan2/PKPilot0018` · 브랜치: `feat/phase3e-guided-tutorial`
> 선행: WO-3E-09 Sample Data Library, WO-3E-10 Help Center (이 브랜치에 함께 구현)
> 최종 병합 SHA: 아래 §12 (병합 후 갱신)

---

## 1. 구현 아키텍처

튜토리얼은 **선언형 콘텐츠**다. 새 실습을 추가할 때 React 컴포넌트를 만들지 않는다.

```
src/
├── samples/                     실습 데이터 원본 + 메타데이터 (WO-3E-09)
│   ├── types.ts                 SampleDef · SampleVariable (역할·단위)
│   ├── registry.ts              SAMPLES(8) · DATASETS(호환) · 조회 함수
│   └── datasets/
│       ├── builtin.ts           기존 7종 데이터셋 (lib/datasets.ts에서 이동)
│       └── displayOptical.ts    합성 디스플레이 광학 DoE (3요인 × 4반응)
├── help/                        이론·공식·파라미터·해석·가정 (WO-3E-10)
│   ├── types.ts                 HelpEntry · HelpFormula · HelpParameter
│   ├── registry.ts              HELP_ENTRIES(23) · analysisId/helpId 조회
│   └── content/{basics,quality,doe,models}.ts
├── tutorials/
│   ├── types.ts                 Tutorial · TutorialStep · ValidationRule · WorkspaceFacts · Bridge
│   ├── define.ts                선언형 authoring → 로컬라이제이션 키 자동 생성
│   ├── localize.ts              en/ko 텍스트 레지스트리 (반쪽 번역 거부)
│   ├── registry.ts              TUTORIALS(12) · 카테고리/난이도 라벨
│   ├── actionRegistry.ts        허용 Action 13종 + 파라미터 검증 + 디스패처
│   ├── validationRegistry.ts    규칙 16종 + 예측 일관성 검사
│   ├── tutorialEngine.ts        순수 상태 전이(평가·수동완료·건너뛰기·요약)
│   ├── progressStore.ts         localStorage 진행 기록 + 실습 프로젝트 슬롯
│   ├── presets.ts               분석 프리셋 25종 (열 이름 → 활성 시트의 열 ID)
│   ├── qa.ts                    Registry QA (중복·끊긴 ID·누락 번역·프리셋 실행)
│   └── courses/{part1,part2,part3}.ts   T01–T12 콘텐츠
└── components/
    ├── tutorial/
    │   ├── TutorialLibrary.tsx  목록·검색·필터·진행률·시작/이어하기/재시작
    │   ├── TutorialRunner.tsx   우측 도크/모바일 시트 본문
    │   ├── TutorialStep.tsx     단계 지시·기대결과·힌트·검증 상태·이전/다음
    │   ├── TutorialProgress.tsx 진행 바 + 단계 칩(색 외 문자·글리프 병기)
    │   └── TutorialSummary.tsx  완료 요약 (WO-T09)
    ├── SampleLibrary.tsx        샘플 8종·변수/단위·관련 튜토리얼
    └── HelpCenter.tsx           도움말 23종·공식·파라미터·실습 링크
```

**책임 경계**

- Sample/Help/Tutorial은 서로의 데이터를 복사하지 않고 **고유 ID로만** 연결한다: `sampleId`, `helpId`, `analysisId`, `presetId`.
- 모든 통계 계산은 기존 엔진(`analyses.ts`, `modelStore.ts`, `optimizer.ts`, `profiler.ts`, `modelPredictor.ts`, `graphLayout.ts`, …)이 수행한다. 튜토리얼 전용 계산기는 없다. 검증기는 엔진을 **다시 호출해** 기대값을 만든다.
- App과 튜토리얼 사이의 유일한 통로는 `TutorialBridge`이며, `actionRegistry`의 허용 목록을 지난다. `eval`, 동적 import, 임의 JavaScript 실행 경로는 없다.

**진입점**

| 위치 | 동작 |
| --- | --- |
| 도움말 ▸ 튜토리얼 / 툴바 **스타텔리아 배우기** / `Ctrl+L` | 튜토리얼 라이브러리 |
| 도움말 ▸ 도움말 센터, 도움말 모달의 버튼 | Help Center (문서별 **실습** 버튼) |
| 샘플 데이터 메뉴 / 툴바 드롭다운 ▸ **샘플 라이브러리** | 샘플 라이브러리 (관련 튜토리얼 포함) |
| 빈 워크시트 상태 | 툴바의 **스타텔리아 배우기**가 강조 표시 |

---

## 2. Tutorial 목록

| ID | 제목 | 난이도 | 시간 | 단계 | 자동 검증 |
| --- | --- | --- | --- | --- | --- |
| `tutorial-start-001` | Getting Started with Statelia | 입문 | 5분 | 4 | 3 + 수동 1 |
| `tutorial-data-001` | Worksheet & Data Management | 입문 | 5분 | 6 | 5 + 수동 1 |
| `tutorial-normality-001` | Descriptive Statistics & Normality | 초급 | 5분 | 5 | 4 + 수동 1 |
| `tutorial-hypothesis-001` | Hypothesis Testing | 초급 | 10분 | 5 | 4 + 수동 1 |
| `tutorial-regression-001` | Regression Analysis | 초급 | 10분 | 5 | 4 + 수동 1 |
| `tutorial-anova-001` | ANOVA & GLM | 중급 | 10분 | 5 | 4 + 수동 1 |
| `tutorial-spc-001` | Statistical Process Control | 중급 | 10분 | 5 | 4 + 수동 1 |
| `tutorial-capability-001` | Capability Analysis & Sixpack | 중급 | 10분 | 6 | 5 + 수동 1 |
| `tutorial-gagerr-001` | Gage R&R | 중급 | 10분 | 4 | 3 + 수동 1 |
| `tutorial-reliability-001` | Reliability Analysis | 중급 | 15분 | 4 | 3 + 수동 1 |
| `tutorial-doe-001` | DOE & Response Surface | 고급 | 20분 | 7 | 6 + 수동 1 |
| `tutorial-rsm-001` | **Multi-Response Optimization (flagship)** | 고급 | 20분 | **12** | **12 (전 단계)** |

합계 12개 실습 · 68단계 · 사용 분석 24종(구현된 분석만). 각 실습은 7부 구조(무엇을 배우는가 / 데이터 / 분석 / 입력 조건 / 확인할 결과 / 해석 / 실무 결론)를 갖는다.

**Flagship 12단계** (`tutorial-rsm-001`, `display-optical-doe`)
1 DOE 불러오기 · 2 탐색(기술통계+산점도) · 3 반응표면 4개 적합 · 4 모형 4개 저장 · 5 등고선 · 6 3D 표면 · 7 중첩 등고선(규격 4종) · 8 반응 최적화 · 9 예측 프로파일러 · 10 그림 배치+PNG 내보내기 · 11 프로젝트 저장(왕복 검증) · 12 요약(최종 상태 재검증).

모든 단계는 **실제 분석 결과와 프로젝트 상태**로 판정한다(Level 3). 화면 강조 Overlay나 AI 코칭은 포함하지 않는다.

---

## 3. Action Registry 명세

`src/tutorials/actionRegistry.ts` — 허용된 13개 외에는 실행 경로가 없다.

| Action | 파라미터 | 동작 | 비고 |
| --- | --- | --- | --- |
| `load-sample` | `sampleId` | 샘플을 새 워크시트로 추가 | 기존 데이터 보존 |
| `open-help` | `helpId` | Help Center 해당 문서 열기 | 닫으면 실습 단계로 복귀 |
| `open-analysis` | `analysisId`, `presetId?` | 분석 대화상자 열기(+프리셋 채움) | 사용자가 모든 값 수정 가능 |
| `apply-preset` | `analysisId`, `presetId` | 열린/새 대화상자에 프리셋 채움 | 실행은 하지 않음 |
| `run-analysis` | `analysisId?` | **확인 후** 대화상자의 현재 값으로 실행 | 엔진이 계산; 정답 대체 없음 |
| `open-model-manager` | — | 모형 관리자 열기 | 저장은 카드의 Save model |
| `open-chart` | `chart{kind,responses,specs?}` | 저장 모형으로 등고선/3D/중첩 등고선 생성 | 엔진의 `modelSurface`·`buildOverlaidChart` |
| `open-optimizer` | `optimizer?{responses[{response,goal,lower,upper,target}]}` | 목표·한계를 채운 최적화 창 | 기본값은 모델 관측 범위 |
| `open-profiler` | — | 마지막 최적화 최선 조건에서 프로파일러 | 최적화 기록 필요 |
| `open-layout` | `layout?` | 그림 배치 편집기 | |
| `export-project` | — | 실습 프로젝트 저장 + **다시 읽어 왕복 검증** | `.sigrun.json` |
| `export-chart` | — | 배치 편집기 열기(내보내기 버튼 안내) | PNG/SVG 이벤트 기록 |
| `validate-result` | — | 현재 단계 규칙으로 즉시 재평가 | |

- 파라미터는 디스패치 전에 검증한다(누락·알 수 없는 action·잘못된 chart kind/goal → 거부).
- 실행 실패는 `{ok:false, code, message}`로 돌아오고 패널에 원인과 재시도 안내가 표시된다.
- 분석은 항상 엔진이 실행한다. 중복 실행은 버튼 비활성(`busy`)과 대화상자 흐름으로 막는다.

---

## 4. Validation Rule 명세

`src/tutorials/validationRegistry.ts` — 규칙은 작업 공간을 직접 검사한다. 부동소수점은 **절대오차 1e-9 + 상대오차 1e-6** 밴드로 비교하며, 문자열 포맷 비교는 하지 않는다.

| 규칙 | 판정 근거 |
| --- | --- |
| `sample-loaded` | 워크시트에 지정 열이 실제로 존재(+로드 이벤트) |
| `help-opened` | 열람 이벤트 기록 |
| `analysis-opened` | 대화상자 열림 이벤트 |
| `analysis-output` | 출력 카드의 `meta.analysisId`, 필요 시 모형/차트 존재, 개수 |
| `analysis-outputs` | 여러 분석·차트를 한 번에 요구(예: 기술통계 + 산점도) |
| `column-created` | 활성 시트의 새 열과 평균/표준편차(엔진 값과 허용오차 비교) |
| `model-stored` | 저장 모형의 반응·개수·R²·2차항 존재 |
| `chart` | 출력의 차트 종류·반응 이름·중첩 등고선의 실행가능 영역 |
| `optimizer-run` | 목표 설정, 복합 만족도, 종료 상태, **예측 일관성** |
| `profiler-check` | 최적화 조건에서 열렸는지, 저장 조건의 예측 일치 |
| `layout-saved` / `layout-export` | 차트 패널 수·그림 번호·내보내기 형식 |
| `chart-exported` | 내보내기 이벤트의 형식 |
| `project-saved` | 저장 파일의 왕복 읽기 결과 |
| `practice-complete` | 최종 산출물(모형·최적화·프로젝트·배치) 존재 + 예측 일관성 |
| `manual` | 자동 판정 없음(사용자가 완료 표시) |

**예측 일관성** (`checkPredictionConsistency`) — 같은 Actual Factor 조건에서
1. 최적화 해의 각 반응 예측값 ↔ 저장 모형의 `predictStoredModel` 예측값,
2. 프로파일러에 저장된 조건과 예측값 ↔ 같은 모형의 예측값,
3. 프로파일러 조건의 요인 값 ↔ 최적화 해의 요인 값,
4. 3D 표면 격자 중앙 노드 ↔ 같은 좌표에서의 저장 모형 예측값(나머지 요인은 중심 고정)

을 모두 허용오차 안에서 비교한다. 하나라도 어긋나면 해당 단계는 `FAILED`가 되고 근거가 함께 표시된다. 단위 테스트는 계수를 인위적으로 바꾼 모형과 z값을 이동시킨 표면을 넣어 이 검사가 실제로 실패하는지 확인한다.

**상태**: `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`, `SKIPPED`, `FAILED`. 검증 단계는 워크스페이스가 바뀔 때마다 재평가되며, 한때 통과했던 단계도 근거가 사라지면 완료로 남지 않는다. 수동 단계는 사용자만 완료/미완료로 바꿀 수 있고 요약에서 '자동 검증'과 분리해 집계한다.

---

## 5. Sample 및 Help 연결 구조

```
Tutorial ──sampleIds──▶ Sample(id, variables[], synthetic, build())
   │                         ▲
   ├──helpIds──────────▶ HelpEntry(id, analysisIds[], formulas, parameters, interpretation, assumptions)
   ├──analysisIds──────▶ AnalysisDef(id)
   └──steps[].presetId─▶ AnalysisPreset(id, analysisId, sampleId, slots{columns by name})
                              │
                              └─ resolvePreset(preset, activeSheet) → dialog values
```

- 프리셋은 **열 이름**으로 정의되어 활성 시트의 열 ID로 변환된다. 샘플을 여러 번 불러와도, 열을 복제해도 동작한다.
- `src/tutorials/qa.ts`가 다음을 검사한다: 튜토리얼/단계 ID 중복, 존재하지 않는 sample/help/analysis/preset/next 참조, 허용되지 않은 action, 프리셋의 분석·샘플 불일치, 프리셋 열 누락, **모든 프리셋의 실제 실행**, 모든 텍스트 키의 en/ko 존재, 사용되지 않는 action 경고. 오류가 0이어야 테스트가 통과한다.
- Help Center의 **실습** 버튼은 `tutorialIds`로, **샘플 불러오기**는 `sampleIds`로 연결된다. Sample Library의 관련 튜토리얼도 같은 링크를 읽는다.

---

## 6. 프로젝트 보호 방식 (WO-T06)

실습은 기본적으로 **분리된 실습 프로젝트**에서 시작한다.

1. 시작 시 현재 프로젝트 전체를 스냅샷한다: 워크시트(열 ID 포함), 활성 시트, 출력 카드, 저장 모형, 그림 배치, **undo/redo 스택**.
2. 새 실습 프로젝트를 열고(빈 워크시트 1개) 실습을 진행한다.
3. 실습 중에는 **자동 저장(IndexedDB)을 중지**한다. 사용자의 원래 자동 저장본은 그대로 남는다.
4. 종료 시 선택:
   - **실습 프로젝트 저장** — `.sigrun.json` 다운로드 + 다시 읽어 왕복 검증
   - **실습 프로젝트 내보내기** — 프로젝트 파일 + 활성 워크시트 CSV
   - **보관 후 원래 프로젝트 복귀** — 실습 프로젝트를 브라우저 슬롯에 저장하고, 스냅샷을 복원
   - **폐기(확인 필요)** — 스냅샷 복원, 실습 진행 기록 삭제
5. '현재 프로젝트에서 실습'을 고르면 **명시적 확인**을 한 번 더 받는다. 이 모드에서는 변경이 실제이며, 종료 시 '지금 상태 유지' 또는 스냅샷 복원을 선택한다.

`Tutorial Restart`는 진행 기록만 새로 만들고 실습 워크시트는 건드리지 않는다.

---

## 7. 진행 상태 저장 및 복원

- 저장 위치: `localStorage["sigrun.tutorials.progress.v1"]` — 튜토리얼별 레코드(스키마 1): `sessionId`, `practiceProjectId`, `currentStepId`, 단계별 `{status, mode, code, detail}`, `startedAt/updatedAt`, `status`.
- 저장 실패(용량/차단)는 **숨기지 않고** 패널에 알린다. 이때 진행은 창 안에서만 유지되고, 프로젝트 파일 저장이 대안으로 안내된다.
- 삭제/손상된 레코드는 복구를 시도하지 않고 새 세션으로 시작한다.
- **복원 원칙**: 진행 기록만으로 완료를 복원하지 않는다. 재개 시 모든 검증 단계를 현재 워크스페이스로 다시 평가하고, 근거가 없으면 `IN_PROGRESS`로 되돌린다. 실습 데이터가 사라진 경우(새로고침 후 등) 라이브러리에서 '이어하기'를 누르면 "실습 데이터가 없다"는 안내와 함께 다시 시작하도록 한다.
- '보관'한 실습 프로젝트가 있으면 새로고침 뒤에도 그 프로젝트를 열어 이어갈 수 있다(보관 슬롯 `sigrun.tutorials.practice.v1`).
- 튜토리얼 버전이 바뀐 기록은 재개하지 않는다(`tutorialVersion`).

---

## 8. UI 스크린샷

`/workspace/downloads/sigrun-tutorial-shots/`

| 파일 | 화면 |
| --- | --- |
| `00-start-empty.png` | 빈 시작 화면(툴바 '스타텔리아 배우기') |
| `01-tutorial-library.png` | 튜토리얼 라이브러리(12개) |
| `01b-tutorial-search.png` | 키워드 검색('optimization') |
| `01c-tutorial-library-ko.png` | 한국어 라이브러리 |
| `02-sample-library.png` | 샘플 라이브러리(8개) |
| `02b-sample-variables.png` | 디스플레이 광학 DoE 변수·단위 |
| `03-help-center.png` | 도움말 센터(23문서) |
| `03b-help-document.png` | 반응표면 적합 문서(공식·파라미터) |
| `04-flagship-summary.png` | Flagship 완료 요약(모형·최적화 결과) |
| `05-mobile-sheet.png` | 모바일 바텀 시트 |
| `06-mobile-collapsed.png` | 모바일 접힘 상태 |
| `07-portable-tutorial.png` | `file://` 포터블 빌드에서 실습 진행 |
| `08-start-dialog-ko.png` | 시작 옵션(분리/현재 프로젝트) |
| `09-dock-ko.png` | 한국어 우측 도크 |

---

## 9. 테스트 결과

실행 환경: Node 24.11.0, Chromium(headless) 1248, 2026-11-24.

| 검사 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 통과 |
| `npm test` (vitest) | **47 파일 · 1096 테스트 전부 통과** (튜토리얼 시스템 21 포함, 병합 후 main 기준) |
| `npm run qa:stats` | **225/225 PASS** (독립 Python 참조 엔진 대조, FAIL 0) |
| `npm run build` | 통과 (dist) |
| `npm run build:portable` | 통과 (`dist-portable/sigrun-portable.html`, zip) |
| `npm run qa:tutorials` (E2E) | **23/23 통과** — 12개 실습 전체 완주, Flagship 12단계+요약/다시보기, 원본 프로젝트 비변경, 모바일 시트, 콘솔 오류 0 |
| `npm run qa:tutorials:portable` | **8/8 통과** — `file://` 부팅, 레지스트리 번들, 외부 요청 0 |

E2E가 확인한 것: 라이브러리 12개·검색, 샘플 8종, 도움말 23문서, 12개 실습의 주요 실행 경로 완주(각 단계 자동 검증), Flagship 요약에 최적화 결과·확인 실험 문구, 분리 실습 시작 시 원래 시트/출력 미변경, 종료 후 원래 프로젝트 완전 복원, 모바일 바텀 시트, 콘솔 오류 없음.

---

## 10. Portable 검증 결과

- Sample/Help/Tutorial 레지스트리는 빌드 시점에 번들된다. 런타임 fetch/JSON 로딩 없음.
- `file:///…/sigrun-portable.html`에서 실습 시작 → 샘플 로드 → 분석 실행 → 도움말 열기까지 동작.
- 네트워크 요청 모니터 결과 `file:`/`data:`/`blob:` 외 요청 **0건**.
- 진행 저장: 이 Chromium에서는 `localStorage`가 동작해 저장됨(8/8 검사 중 'saved'). 저장이 차단되는 브라우저에서는 패널이 경고를 표시하고 프로젝트 파일 저장을 대안으로 안내한다(차단 저장소 경로는 단위 테스트로 검증).

---

## 11. 알려진 한계 (UNVERIFIED 포함)

1. **브라우저 E2E는 CI에서 실행되지 않는다.** GitHub Actions(`deploy.yml`)는 `tsc --noEmit`, `npm test`, `npm run build`를, `qa-stats.yml`은 `qa:stats`를 실행한다. `qa:tutorials`는 이 리비전에서 로컬로 실행해 통과했으며, CI 워크플로에는 넣지 않았다.
2. E2E 브라우저는 이 이미지에 GTK 계열 라이브러리가 없어 `tools/e2e_browser.cjs`가 (선택적) `@sparticuz/chromium`으로 대체한다. `CHROME_LIBS`/`CHROME_PATH`로 실제 Chromium을 지정할 수 있다. `@sparticuz/chromium`은 `package.json`에 선언하지 않았다(설치돼 있을 때만 사용).
3. **실습 워크스페이스는 새로고침을 넘기지 못한다.** 진행 기록은 남지만 실습 데이터는 사라지므로, 이어하기는 재시작을 안내한다(의도된 동작: 기록만으로 완료를 복원하지 않음). '보관'한 실습 프로젝트는 예외.
4. 실습 중 자동 저장이 중지되므로, 브라우저가 비정상 종료되면 **실습 작업**은 잃는다(원래 프로젝트의 자동 저장본은 보존). 실습을 남기려면 저장/보관해야 한다.
5. 수업 본문에 적힌 수치(예: Cp 1.069, %GRR 26.0 %, 최적화 예측값)는 현재 샘플 빌드에서 엔진으로 계산한 값이다. 검증은 이 수치를 정답 키로 쓰지 않고 **매번 엔진으로 다시 계산**한다. 엔진이 바뀌면 본문 수치와 검증 기준이 함께 갱신돼야 한다.
6. 프로파일러 단계는 '열린 조건'과 '저장한 조건'의 예측 일치를 검증한다. 슬라이더를 끄는 모든 중간 상호작용을 개별 검증하지는 않는다.
7. 화면 읽기 프로그램으로 실제 낭독을 확인하지는 않았다. 키보드 이동·`aria-label`·색 외 상태 표기는 구현되어 있으나 전문 접근성 감사는 UNVERIFIED.
8. 3D 표면의 WebGL 렌더 자체는 GPU/소프트웨어 렌더러에 따라 다르다. 검증은 표면이 담고 있는 **격자 수치**를 모형 예측과 비교하며, 픽셀은 비교하지 않는다.
9. 한국어/영어 외 언어는 지원하지 않는다(i18n 구조상 추가 가능).

---

## 12. 최종 Commit SHA

- PR: [#32](https://github.com/HyangDan2/PKPilot0018/pull/32) — `feat/phase3e-guided-tutorial` → `main` (squash merge)
- **병합 커밋 (main): `b3a792f8b6deff4b0347b1a1b2767a125910389e`** — `feat(phase3e): WO-3E-11 guided tutorial system with sample library and help center (#32)`
- 병합 시각: 2026-11-24T14:04:29Z
- GitHub Actions (main, 병합 커밋):
  - `Deploy Statelia to GitHub Pages` — **success** (run 45410062875)
  - `Statistics QA (independent reference)` — **success** (run 45410062728)
  - PR 검사 `qa-stats` — **success** (run 45409791603)
- 배포 확인: <https://hyangdan2.github.io/PKPilot0018/> 에서 라이브러리 12개·실습 시작·샘플 로드 검증 통과 (`10-live.png`)
- 원격 브랜치 삭제는 자격 증명 범위 제한(HTTP 403)으로 실패해 `feat/phase3e-guided-tutorial`이 원격에 남아 있다.

## Corrective pass (T-01 … T-13, 2026-11-25)

The tutorial system above is unchanged in structure. The corrective pass hardened
what a step is allowed to conclude and what happens to the reader's own project:

- the original project is written to `sigrun.tutorials.original.v1` and read back
  before any practice replaces it; a refused store stops the start and offers an
  explicit project backup (`tools/probe_tutorial_guard.cjs` measures this),
- settings and custom chart styles are part of the practice snapshot,
- samples are identified by row count and values, not by column names,
- analysis steps verify input columns, dialog parameters and a produced result,
- stored models are counted per response; the profiler must carry every factor and
  be saved before a "consistent" verdict,
- practice projects are kept per tutorial and session with their evidence, and a
  resumed lesson is re-evaluated,
- the project round trip is compared record by record (`src/lib/projectCompare.ts`),
- endings are separated into verified / manual / skipped, and the status bar reads
  the stage from `APP_PHASE`.

Full report and the per-defect before/after assertions: `docs/TUTORIAL_CORRECTIVE_QA.md`.
