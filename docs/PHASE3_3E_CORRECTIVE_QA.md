# Sigrún Phase 3E 교정 리뷰 QA 보고서 (F-01 … F-15)

> **저장소**: `HyangDan2/PKPilot0018` · 브랜치 `fix/phase3e-corrective-review`
> **기준선**: `924721b` (Phase 3E 완료 시점 `main`)
> **일자**: 2026-11-24
> **요구 사항**: "수정 전 실패 테스트와 수정 후 성공 결과를 함께 제출할 것" — 두 결과를 모두 이 문서에 남겼다(§2, §3).

## 1. 검증 요약 (최종 트리에서 실측)

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | **0 errors** |
| `npm test` | **1 049 / 1 049 PASS** (45 파일) — 기존 1 001 + 이번 교정 스위트 **48** |
| `npm run qa:stats` | **225 / 225 PASS**, FAIL 0 · REVIEW 0 · UNVERIFIED 0 · ERROR 0 (NumPy 2.5.4 · SciPy 1.18.1 · statsmodels 0.15.0) |
| `npm run build` | 성공 — `dist/assets/index-DahnW_u0.js` 1 202.87 kB (외부 CDN·API 없음) |
| `npm run build:portable` | 성공 — `sigrun-portable.html` 1 241.8 kB · `sigrun-portable.zip` 361.7 kB |
| E2E 회귀 (로컬 `dist`) | **549 / 549 PASS** — stage1 77 · stage2 37 · stage3 176 · chart_axes 6 · chart_upgrade 34 · ui_compact 63 · 3A 29 · 3B 41 · 3B 교정 13 · 3C 24 · 3D 49 |
| Portable Offline Smoke (`file://`, 네트워크 차단) | **63 / 63 PASS** |
| 신규 체크아웃 재현 (§5) | 새 디렉터리에서 `npm ci` → `npm run build:portable` → 63 / 63 PASS |
| ZIP 재현성 | 같은 `SOURCE_DATE_EPOCH`로 두 번 빌드 → **같은 SHA-256** (`54293e4d…2334`), 엔트리 날짜 유효 |

## 2. 수정 전 실패 증빙 (fail-first)

### 2.1 회귀 스위트가 기준선에서 실패한다

`tests/phase3e-corrective.test.ts`를 기준선 `924721b`에서 그대로 실행한 기록(`work/pk18-3e-logs/red-baseline.txt`):

```
FAIL  tests/phase3e-corrective.test.ts [ tests/phase3e-corrective.test.ts ]
Error: Failed to resolve import "../tools/build_manifest.mjs" from "tests/phase3e-corrective.test.ts".
 Test Files  1 failed (1)
      Tests  no tests
```

기준선에는 교정이 도입하는 모듈(`tools/build_manifest.mjs`, `src/lib/appInfo`)과 API(`localSteps`, `relativeSlack`, `CrossCheck.consistent`)가 없으므로 스위트가 **수집 단계에서 실패**한다. 즉 "수정 후에만 통과하는 테스트"임이 파일 단위로 증명된다.

### 2.2 결함별 기준선 동작 실측

행동 수준의 증빙은 기준선 체크아웃에서 측정한 프로브로 남겼다(`work/pk18-3e-logs/baseline-probe.json`). 같은 프로브를 교정 트리에서 다시 돌린 값과 대조했다.

| 결함 | 측정 항목 | 기준선 `924721b` | 교정 후 |
| --- | --- | --- | --- |
| F-01 | 어댑터가 A=1e160에서 낸 값 | **2e160** (정상값처럼 반환) | `null` |
| F-01 | 어댑터의 오류 코드 | `model.covariance.negativeVariance` (엉뚱함) | `model.value.nonFinite` |
| F-01 | 같은 점의 모형관리자 / 서피스 | `null` · `model.value.nonFinite` | 동일 |
| F-01 | 같은 점의 최적화기 예측 | **2e160**, 코드 `negativeVariance` | 평가 불가 → `status: invalid`, `issues: [model.value.nonFinite]` |
| F-01 | 같은 점의 프로파일러 행 | **2e160**, `issues: []` | `value: null`, `issues: [model.value.nonFinite]` |
| F-01 | 공분산 곱이 넘치는 A=1e154 | 어댑터 `1e308` + `negativeVariance` | `null` + `model.value.nonFinite` |
| F-02 | `Lower=100000000.01, Step=0.1`의 k=0 | **100000000** (소수부 소실) | **100000000.01** |
| F-02 | 같은 격자의 k=1 | 100000000.1 | 100000000.11 |
| F-02 | 이산 0…1e20 step 1의 인자 문제 | `[]` (문제 없음) | `opt.issue.integerSafeRange` |
| F-02 | 1e15 + 0.1 격자 값 | `[1e15, 1e15, …, 1e15+0.4, +0.4, +0.4]` (중복) | 격자 없음(`values: []`) + `opt.issue.stepBelowPrecision` |
| F-03 | 학습 0~5, 고정값 3, 외삽 금지 | `status: best-found`, `issues: []` (외삽 표시만) | `status: invalid`, `opt.issue.fixedExtrapolation` |
| F-04 | `buildProject`가 쓰는 version | `1` | `2` |
| F-04 | version 99 / 'beta' 프로젝트 | **그대로 열림** | `file.versionNewer` / `file.versionInvalid` |
| F-05 | 손상 워크시트 1장 + 정상 1장 | **정상 1장만 복원**(손상분 소실) | `file.worksheetCorrupt` — 아무것도 열지 않음 |
| F-06 | 손상 저장모형 1건 | **0개로 복원**(소실) | `file.modelCorrupt` — 아무것도 열지 않음 |
| F-07 | `isOnStep(0, 2, 1e-9, 1.0000000003)` | **true** (비율 스케일 tolerance) | false — 격자 자신의 정밀도로 판정 |
| F-08 | 동명 인자 2개 | 이름 기준 `Set` 병합(경고 없음) | `opt.issue.factorDuplicate`, `status: invalid` |
| F-09 | 빌드/ E2E 스크립트 | `/workspace/...` 절대경로 12개 파일에 하드코딩 | 0건 (`tools/browser_env.cjs` 동적 탐색) |
| F-10 | E2E 의존성 | `package.json`에 없음(외부 설치 경로 require) | `devDependencies.playwright-core 1.64.1` |
| F-12 | ZIP 엔트리 날짜 | `(2026, 11, 24, 0, 0, 0)` 하드코딩 | `SOURCE_DATE_EPOCH`(없으면 빌드 시각), DOS 범위 1980–2107 클램프 |
| F-13 | `build-info.json` | 시각·크기·해시·node/vite (커밋·버전 없음) | 버전·커밋·phase·zipTimestamp·해시 + `source` 도구 버전, ZIP에도 동봉 |
| F-14 | `crossCheck` 반환 키 | `value, se, ciHalf, pi, delta{value,se,pi}, issues` | `delta{value,se,ci,pi,issues}` + `parallel` + `consistent` |
| F-15 | About 탭 표기 | `PHASE 1 · 2026` | `시그룬 v1.0.0 · Phase 3 · 2026` (`aboutVersionLine`) |

## 3. 결함별 조치와 증빙

### F-01 · 비유한 값 무시 제거 + 공통 예측 산술 통합 (P0)

- **원인**: `predictionAdapter.evaluate`가 계수 가중치를 합산할 때 `if (!Number.isFinite(weight)) continue`로 **비유한 항을 건너뛰고 나머지 합을 예측값으로 반환**했다. 같은 이유로 분산 계산 루프도 비유한 가중치·공분산 원소를 건너뛰어, 넘침이 `negativeVariance`로 잘못 분류됐다.
- **수정**:
  - `src/lib/modelPredictor.ts`에 **`sumDesignRow(model, weights)`** 를 추가해 ŷ 합산과 거부 규칙(비유한 가중치·비유한 계수·비유한 합)을 한 곳에 두고, `predictStoredModel`·`compileSurfaceEvaluator`·`predictionAdapter`가 모두 이 함수를 쓴다.
  - `quadraticForm`을 export해 어댑터의 분산 계산도 모형관리자와 같은 PSD·음수분산 판정을 쓰게 했다(넘침 → `model.value.nonFinite`).
  - `intervalIssues(model)` 하나로 구간 사유를 세 경로가 동일하게 표시한다.
  - 최적화기는 평가 불가 후보의 사유를 `OptimizerResult.issues`로 돌려준다(전에는 `noEvaluablePoint` 경고만 있었다).
  - 프로파일러 행·곡선이 `issues`를 싣는다(전에는 전부 `[]`).
- **증빙**: `[R1]` 6건, `[R9]` 4건 — 어댑터·모형관리자·서피스 노드/그리드·최적화기·프로파일러가 같은 점에서 같은 값/같은 코드/같은 거부를 낸다.

### F-02 · 이산형 정수 정밀도·안전 정수 범위·최소 표현 Step (P0)

- **원인**: `decimalsOf`가 `1e-9 × scale` 허용오차로 소수 자릿수를 세어, `100000000.01`의 `0.01`을 "0자릿수"로 판정 → 격자 기준값이 `100000000`으로 반올림됐다. 안전 정수 범위·표현 가능 Step 검증은 아예 없었다.
- **수정**(`src/lib/factorDomain.ts`):
  - `decimalParts`(BigInt)로 **수가 실제로 적힌 십진 자릿수**를 읽고, `discreteValueAt`은 `Lower + k × Step`을 **정수(BigInt) 덧셈**으로 계산한 뒤 십진 자릿수로 되돌린다. `discreteStepCount`도 같은 산술로 `(Upper − Lower) / Step`의 정수 몫을 구한다.
  - `discreteDomainIssue(lower, upper, step)` 하나로 **범위 역전 · 간격 오류 · 안전 정수 범위 초과(`integerSafeRange`) · 간격 수 초과(`stepCount`) · 표현 불가 Step(`stepBelowPrecision`)** 을 판정한다.
  - `doubleSpacing(value)`(ULP)로 "이 크기에서 두 배정도 수 사이 간격"을 구해, **Step이 그 간격보다 작으면** 거부한다(1e15에서 0.1 < 0.125).
  - `discreteAxis`는 값이 겹치는 격자를 내놓지 않는다(빈 격자 + 사유).
- **증빙**: `[R2]` 3건(100000000.01 보존), `[R3]` 3건(1e20 거부), `[R4]` 2건(1e15+0.1 거부·중복 없음), `[F-02]` 2건.

### F-03 · Fixed Factor 외삽 검사 (P0)

- **원인**: `buildProblem`의 외삽 검사가 `if (fitted && !factor.fixed)`로 **고정 인자를 건너뛰었다**. 고정값이 학습 범위 밖이어도 경고 없이 탐색이 끝났다.
- **수정**: 고정 인자도 모형별 적합 범위와 비교한다. 값이 **선언 범위 안이지만 학습 범위 밖**이면 `opt.issue.fixedExtrapolation`(외삽 허용 시 `opt.warn.extrapolation`). 선언 범위 밖이면 기존 `opt.issue.fixedOutside` 하나로 보고한다(중복 코드 방지).
- **증빙**: `[R5]` 3건 — 거부 / 외삽 허용 시 통과 / 범위 안 고정값은 그대로.

### F-04 · F-06 · 프로젝트 버전·스키마·Migration·데이터 누락 (P1)

- **원인**: `parseProject`가 `version`을 읽지 않았고, 워크시트는 `filter`로 조용히 버렸으며, 저장모형 파서는 잘못된 항목을 조용히 건너뛰었다.
- **수정**(`src/lib/project.ts`):
  - `CURRENT_PROJECT_VERSION = 2`, `OLDEST_PROJECT_VERSION = 0`(버전 없는 legacy `.mpx.json`).
  - 버전 판정: 없음 → legacy(0) 마이그레이션, 정수가 아님/음수 → `file.versionInvalid`, 현재보다 큼 → `file.versionNewer`.
  - **모든** 워크시트를 검사(`worksheetProblem`): id/name 타입, columns 배열, 각 컬럼의 id·값 타입, **중복 컬럼 id** → 하나라도 어긋나면 `file.worksheetCorrupt`(현재 창의 작업은 그대로).
  - 저장모형도 검사(`modelProblem`) → `file.modelCorrupt`.
  - 마이그레이션 `migrateWorksheet`: v1 시트가 잃어버린 `columnSeq`를 컬럼 id에서 복원한다(복원 후 새 컬럼 id가 기존 id와 충돌하지 않도록).
  - `ProjectState.version` / `originalVersion`으로 "읽은 파일 버전"과 "지금 스키마"를 구분한다.
  - UI(`App.tsx`)는 거부 사유 코드를 그대로 토스트로 보여준다(i18n KO/EN 추가).
- **증빙**: `[R7]` 9건. 기존 `tests/project.test.ts` 2건은 이 계약에 맞춰 갱신(버전 2, 손상 시트 거부).

### F-07 · 상대오차 허용 범위와 Step 정합성 (P1)

- **수정**:
  - `relativeSlack(...values)` — 범위 판정의 상대 허용오차를 한 함수로 모으고, `optimizer`·`profiler`·`factorDomain`의 하드코딩된 `1e-9 * Math.max(1, |x|)`를 모두 대체.
  - `latticeSlack` — "격자 위의 수인가"는 **격자 자신의 정밀도**로 판정(비율 스케일 tolerance가 큰 값에서 한 간격을 통째로 봐주던 문제 제거).
  - `localSteps(factors, settings)` — 이산 인자의 국소 탐색 Step을 **선언 Step의 정수배**로 양자화하고, 절반으로 줄일 때도 정수배를 유지한다(1 간격 아래로는 내려가지 않음 = 그 basin의 수렴).
- **증빙**: `[F-07]` 3건 + `[R7]`/`[R4]`의 격자 판정.

### F-08 · 중복 Factor Name·식별자 (P1)

- **수정**: `duplicateFactorNames` / `duplicatePredictorNames`를 추가하고 `buildProblem`이 **인자 목록의 동명 항목**과 **저장모형 안의 동명 예측변수**를 모두 `opt.issue.factorDuplicate`로 거부한다(전에는 `Set` 병합으로 조용히 한 축만 탐색).
- **증빙**: `[R6]` 3건.

### F-09 · F-11 · 빌드/E2E 환경 하드코딩 제거, 의존성 명시, CI (P1)

- **수정**:
  - `tools/browser_env.cjs` — 브라우저·라이브러리·Playwright 해석을 한 곳으로. 우선순위: `CHROME_PATH` → 설치된 Playwright가 기대하는 리비전의 headless shell → 브라우저 다운로드 디렉터리(최신 리비전) 순, 라이브러리는 `CHROME_LIBS` → 저장소 옆 `chrome-libs` → `~/chrome-libs` → `/opt/chrome-libs`. 모든 E2E/샷 스크립트가 이 모듈을 쓰고, `OUT` 기본값도 저장소 기준 상대경로로 바꿨다(`/workspace/...` 문자열 **0건**).
  - `package.json` `devDependencies`에 **`playwright-core 1.64.1`** 추가, `package-lock.json` 갱신 → `npm ci`만으로 E2E 재현.
  - `.github/workflows/deploy.yml`: `npm install` → **`npm ci`**, npm 캐시 추가.
  - `.github/workflows/portable.yml` 신규: `npm ci` → `playwright-core install --with-deps chromium-headless-shell` → `build` → `build:portable`(SOURCE_DATE_EPOCH) → `e2e_portable_offline.cjs` → 산출물 업로드.
- **증빙**: `[R8]` 5건 + §5 신규 체크아웃 재현.

### F-12 · F-15 · ZIP 날짜, Build Manifest, CrossCheck, About (P2)

- **F-12 ZIP 날짜**: `tools/build_manifest.mjs`의 `resolveBuildDate`가 `SOURCE_DATE_EPOCH`(없으면 빌드 시각)를 초 단위로 자르고 **1980-01-01 … 2107-12-31**로 클램프한다. ZIP 엔트리 3개(HTML·README·build-info)가 같은 시각을 쓰고 `external_attr`을 고정해 재현 가능하다. 실측: 같은 epoch로 두 번 빌드 → 동일 SHA-256, 엔트리 `(2025, 11, 24, 16, 0, 0)`.
- **F-13 Build Manifest**: `build-info.json`에 `name·version·phase·commit·builtAt·zipTimestamp·file·bytes·sha256·zip{…}·jsBytes·cssBytes·format·tools{node,vite}`를 기록하고 **ZIP 안에도 동봉**한다. `SOURCE_DATE_EPOCH`는 CI에서 `github.event.repository.pushed_at`로 공급.
- **F-14 CrossCheck 검증 범위**: `crossCheck`가 값·표준오차·신뢰구간 반폭·예측구간·**issue 코드 목록**을 모두 비교하고, `parallel`(양쪽이 함께 말하는 PI)과 `consistent`(1e-12 상대 허용)를 반환한다. 한쪽만 구간을 말하는 경우도 불일치로 잡는다.
- **F-15 About**: `src/lib/appInfo.ts`의 `APP_VERSION`(=`package.json` version)·`APP_PHASE`·`aboutVersionLine(lang)`을 `HelpModal` About 탭이 사용한다(`PHASE 1 · 2026` 제거, `시그룬 v1.0.0 · Phase 3 · 2026`).
- **증빙**: `[F-12/F-13]` 3건, `[R9]` 4건, `[F-15]` 2건.

## 4. 필수 회귀 테스트 9종 ↔ 스위트 대응

| # | 요구 사항 | 테스트 |
| --- | --- | --- |
| R1 | 다항식 Overflow 시 모든 예측 경로가 동일하게 오류 | `[R1]` 6건 |
| R2 | `Lower=100000000.01, Step=0.1`에서 기준값 소수부 보존 | `[R2]` 3건 |
| R3 | 안전 정수 범위 초과 이산형 입력 검증 | `[R3]` 3건 |
| R4 | 큰 Offset + 작은 Step 중복 격자 검사 | `[R4]` 2건 |
| R5 | 외삽 금지 상태의 학습 범위 밖 Fixed Factor 거부 | `[R5]` 3건 |
| R6 | 중복 인자 정의 거부 | `[R6]` 3건 |
| R7 | 잘못된 프로젝트 버전·손상 워크시트 복원 방지 | `[R7]` 9건 |
| R8 | 신규 환경 `npm ci` 후 Portable Build·E2E 재현 | `[R8]` 5건 (정적 계약) + §5 실측 |
| R9 | Model Manager / Contour / Surface / Optimizer / Profiler 일치 | `[R9]` 4건 |

## 5. 신규 체크아웃 재현 실측 (R8)

`node_modules`·`dist`·`.git`이 없는 새 디렉터리에 트리를 복사한 뒤:

```
npm ci                       → 77 패키지 설치(경고 0, lockfile 그대로)
npm run build:portable       → sigrun-portable.html / .zip 생성
node tools/e2e_portable_offline.cjs → 63 / 63 PASS
```

이 샌드박스는 시스템 라이브러리가 없어 `CHROME_LIBS`로 `chrome-libs` 경로를 지정했다(문서화된 오버라이드). CI(`portable.yml`)는 `playwright-core install --with-deps`로 같은 일을 한다.

## 6. 배포

- PR: (머지 후 기입) · 머지 커밋: (기입)
- GitHub Pages: https://hyangdan2.github.io/PKPilot0018/ — 번들 해시와 라이브 확인 결과는 머지 후 이 절에 기록한다.
- Portable ZIP 사본: `/workspace/work/pkpilot0018/sigrun-portable.zip`

## 7. 한계와 미확인 (UNVERIFIED)

1. **Minitab 실측 대조 없음** — 이번 교정은 정밀도·오류 전파·스키마 규칙을 다루므로 Minitab 수치 동등성을 새로 주장하지 않는다. 수치 QA는 NumPy/SciPy/statsmodels 참조(225건)까지다.
2. **ZIP 재현성의 범위** — 같은 커밋 + 같은 `SOURCE_DATE_EPOCH` + 같은 `build-info.json` 입력일 때만 바이트 동일하다. 서로 다른 체크아웃은 `commit` 필드가 달라(또는 `unknown`) 2바이트 차이가 난다. 이는 의도된 정보다.
3. **CI 워크플로 실제 실행 미확인** — `portable.yml`은 이번 작업에서 GitHub Actions에서 실행해 보지 않았다(푸시 권한·러너 환경). 워크플로 문법과 명령은 로컬에서 같은 순서로 실행해 검증했다.
4. **브라우저 범위** — E2E는 Chromium headless shell 1248 기준. Edge·실창 Chrome·Firefox·Safari는 직접 실행하지 않았다(기존 Stage 3E 보고와 같은 한계).
