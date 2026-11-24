# Phase 3 Final Stabilization — 교정 QA

> **작업지시**: WO-FINAL-001 ("Phase 3 Final Stabilization & Enterprise Readiness")  
> **저장소**: `HyangDan2/PKPilot0018` · 브랜치 `fix/phase3-final-stabilization`  
> **기준선 커밋**: `52e8a79178c7bba2c543d4d10cafe0e59ab74922`  
> **일자**: 2026-11-25 (UTC 표기 기준 `2026-11-24T17:05Z` 빌드)  
> **산출물**: WO-01 … WO-09 커밋 + `docs/RELEASE_V1_0_0_QUALIFICATION.md` + 본 문서

## 0. 준수 사항 (작업지시 전문)

- Phase 4 신규 기능을 개발하지 않았다. UI/UX와 디자인은 바꾸지 않았다(화면 변화는 저장 실패 시의 정직한 상태 표시뿐).
- 기존 통계 알고리즘을 재설계하지 않았다. WO-02는 **판정 정책**(범위 허용오차)만 고쳤고, WO-07의 수정도 검증 로직과 허용오차의 정의에 한정했다.
- 테스트를 삭제·skip하지 않았다. 허용오차를 넓혀 통과시키지 않았다. 테스트 기대값을 코드에 하드코딩해 기능 검증을 대체하지 않았다(통계는 SciPy/statsmodels 독립 기준과 대조).
- 수행하지 않은 테스트를 PASS로 보고하지 않는다(§7).
- 사용자 데이터 보존이 우선이다: 공개판 저장 키·프로젝트 포맷·내보내기 동작을 그대로 두었고, 엔터프라이즈판은 별도 namespace를 쓴다.
- `PKPilot0018E0001` 저장소는 만들지 않았다.

## 1. 검증 요약 (교정 트리 HEAD `f83b03b` 실측)

| 항목 | 결과 | 증거 |
| --- | --- | --- |
| `npx tsc --noEmit` | **0 errors** | —— |
| `npm test` | **1,215 / 1,215** (54 파일) | §3 |
| `npm run qa:stats` | **225 / 225 PASS**, FAIL·REVIEW·UNVERIFIED·ERROR 0 | `qa/reports/latest.json` |
| 웹 튜토리얼 E2E (`qa:tutorials`) | **17/17 PASS** (12 레슨 완주, 대표 레슨 포함) · 전체 실행은 **28/28** | `docs/evidence/wo07-GREEN.log`, `docs/evidence/wo10/` |
| Portable 오프라인 E2E (`qa:portable`) | **63 / 63 PASS** | `docs/evidence/wo07-GREEN.log` |
| Portable 튜토리얼 (`qa:tutorials:portable`) | **8 / 8 PASS** | 〃 |
| 튜토리얼 가드 (`qa:guard`) | **10 / 10 PASS** | 〃 |
| 네트워크 감사 (`qa:network`) | **13 / 13 PASS** | `docs/evidence/wo05-network-audit.log` |
| 브라우저 E2E 회귀 (stage1·2·3, chart 2종, ui_compact, 3A–3D) | §4 — 일부 환경 의존 실패, 기준선·Phase 3E·라이브 사이트에서 동일 | `docs/evidence/wo07-e2e-browser.log` |
| 릴리스 검증 (`release:verify --repro`) | PASS · 11 파일 · portable HTML 바이트 동일 | `docs/RELEASE_V1_0_0_QUALIFICATION.md` |
| 감사 자산 검산 | 0 errors | `node tools/verify_audit.mjs` |

## 2. RED — 기준선에서 재현한 회귀 2건

총 3개의 교정(WO-07)은 **재현 → 원인 → 수정 → GREEN** 순서로 남겼다. RED는 7c6c0a3(WO-01~05 반영 후, WO-07 교정 전)에서 실행했다.

### 2.1 학습 저장 왕복 검사가 거짓 불일치를 보고 (Repro 1)

- 증상: 대표 레슨 `tutorial-rsm-001`의 “Save the practice project” 단계가 실패. `ROUNDTRIP false`.
- 저장 자체는 성공했다. **비교가 틀렸다**: (a) 메모리에는 `undefined`인 필드(`caption`·`chart.groups`·`chart.xDomain`)가 JSON에 쓰이면 사라지는데 이를 차이로 셈, (b) schema v2 로더가 파생하는 `columnSeq`를 원본 시트에는 없어서 차이로 셈.
- 근거: `docs/evidence/wo07-RED.log`의 MISMATCHES 줄, `docs/evidence/wo10/before-tutorial-rsm-001-roundtrip.png`(“Check failed — ROUNDTRIP false”).
- 수정: `compareProjects`가 `undefined` 값을 “없는 필드”로 취급하고(`src/lib/projectCompare.ts`), 저장 검사는 로더가 돌려줄 시트(`migrateWorksheet`)와 비교한다(`src/App.tsx`). 실제 값 차이(빈 문자열 caption, 다른 columnSeq, 차트 값)는 여전히 차이로 보고한다 — 회귀 테스트 26·27이 확인.
- GREEN: `docs/evidence/wo10/after-tutorial-rsm-001-roundtrip.png`(“Practice project saved and read back successfully.”), 웹 튜토리얼 28/28.

### 2.2 설계 한계가 데이터 열 반올림으로 들어와 외삽으로 오판 (Repro 2)

- 증상: 통계 QA 225건 중 **10건 FAIL**, 전부 `opt.issue.extrapolationNotAllowed`. CCD 축점 `2^(1/4)=1.189207115002721`이 9자리 열(`1.189207115`)로 들어오면 그 차이(폭의 1.14e-12)를 넘어서는 값으로 판정했다.
- 원인: `rangeSlack`의 폭 비례 항이 `width × 1e-12`라서 반올림 오차(1.14e-12 × width)보다 작았다.
- 수정: 폭 비례 항을 `width × 1e-9`로 올렸다. **오프셋 비례가 아니므로** F-REL-04(1e8에서 폭 0.001인 범위, 0.05 이탈)는 여전히 OUTSIDE다 — ULP 항(4 ULP)이 그 경우를 지킨다. 코드에 이유를 적었다(`src/lib/factorDomain.ts`).
- RED/GREEN: 통계 QA 215/225 → **225/225**. QA-W 10건이 `invalid`에서 정상 결과로 돌아왔다.

### 2.3 추가한 회귀 테스트 (WO-07, 3건)

| 테스트 | 파일 | 고정하는 사실 |
| --- | --- | --- |
| undefined/absent 필드는 저장 전후로 같은 레코드 | `tests/release-project-integrity.test.ts` | JSON이 못 담는 값 때문에 저장이 실패하지 않는다. 빈 caption은 여전히 차이. |
| 로더가 파생한 columnSeq는 차이가 아니다 | 〃 | schema v2 마이그레이션 결과를 비교 기준으로. 원시 비교는 실패함을 함께 고정. |
| 설계 한계의 반올림은 외삽이 아니다 | `tests/release-numerical.test.ts` | ±1.189207115(데이터) vs ±1.189207115002721(한계) 허용, 1e-3 어긋난 한계는 거부. |

이 3건 외에 WO-02~05에서 추가한 회귀 스위트 5종(`tests/release-*.test.ts`, **76 tests**)이 F-REL-01…12, 프로젝트 무결성, 에디션 구성, 저장 진행 상태를 고정한다. 요구된 최소 32건을 넘는다.

## 3. 단위 스위트

```
Test Files  54 passed (54)
     Tests  1215 passed (1215)
```

- 기준선 대비 제거된 테스트는 없다. 파일 49 → 54(+5), 테스트 1,212(교정 전) → 1,215(+3 회귀).
- 저장소 감사 기준(main `43b0b07`)의 1,096건은 이 브랜치가 이미 WO-02~05 스위트를 더한 뒤의 수치와 함께 문서에 병기했다(`docs/MINITAB_MASTER_FEATURE_GAP.md` §9).

## 4. 브라우저 E2E 회귀 — 환경 한계의 정직한 기록

로컬 dist를 대상으로 11개 브라우저 스위트를 돌렸다. 전 항목의 원시 로그는
`docs/evidence/e2e/`, 요약·해설은 `docs/evidence/wo07-e2e-browser.log`에 있다.
합계 **505 / 524 실행**(19 FAIL은 전부 클립보드 계열, 25건은 하네스 중단으로
미도달). 통과 수치만 옮기면 다음과 같다.

| 스위트 | 이 브랜치 | 기준선 52e8a79 | 판정 |
| --- | --- | --- | --- |
| stage1 (워크시트·선택·메뉴) | 37 / 52 실행 · 15 FAIL | **37 · 15 FAIL**, 같은 15건 | 환경 — 기준선 동일 |
| stage2 | **37 / 37** | — | PASS |
| stage3 (레이아웃·회귀) | 172 / 176 · 4 FAIL(붙여넣기) | **172 / 176**, 같은 4건 | 환경 — 기준선 동일 |
| chart_axes | **6 / 6** | — | PASS |
| chart_upgrade | **34 / 34** | — | PASS |
| ui_compact (파트 분리) | **63 / 63** (23+26+7+7) | — | PASS |
| Phase 3A | **29 / 29** | — | PASS |
| Phase 3B | **41 / 41** | **41 / 41** | PASS |
| Phase 3B corrective | **13 / 13** | **13 / 13** | PASS |
| Phase 3C | **24 / 24** | — | PASS |
| Phase 3D | **49 / 49** | — | PASS |

### 4.1 클립보드 실패 — 왜 이 호스트 한계인가

stage1의 15건과 stage3의 4건은 모두 붙여넣기 경로다. 앱은 선택 영역을
`navigator.clipboard`에 쓰고 하네스가 읽어 확인하는데, 이 호스트의 단일
프로세스 헤드리스 Chromium에서는 앱의 쓰기가 하네스로 전달되지 않는다. 읽힌
값은 이전 클립보드 내용(`10.069`, `Line 3/Line 1`)이고, 그 뒤 복사→붙여넣기
의존 검사가 같은 이름·같은 메시지로 연쇄 실패하며 Ctrl+↓/End 계열에서 하네스가
중단된다.

확인 절차 — 같은 실패가 네 곳에서 동일하게 재현됐다:

1. 기준선 `52e8a79` (별도 워크트리에서 새로 `vite build`) — 37 · 15 FAIL
2. Phase 3E `2695b65` (별도 워크트리) — 동일
3. 라이브 Pages 사이트(`LIVE=1`) — 동일
4. 이 브랜치 — 동일

즉 이 브랜치가 만든 회귀가 아니다. 테스트를 지우거나 허용오차를 넓히지 않았고
PASS로도 세지 않았다. Linux CI(`CHROME_PATH=/usr/bin/google-chrome`)가 이
항목의 최종 판정 환경이다(WO-08 워크플로).

### 4.2 ui_compact — 샌드박스 워크어라운드

한 프로세스에서 모든 파트를 이어 돌리면 다음 컨텍스트를 여는 순간 브라우저가
닫힌다(`browserContext.newPage: … has been closed`). 하네스 헤더가 밝히는 대로
이 샌드박스는 Chromium을 단일 프로세스로 돌리며 파트 분리 실행을 전제로 한다.
`PART=ui`(23) · `PART=panels`(26), `WIDTHS=390 PART=mobile`(7),
`WIDTHS=320 PART=mobile`(7)로 나눠 돌리면 63/63이 실패 0으로 통과한다.

### 4.3 자동 저장 봉투(envelope)에 맞춘 하네스 수정

Phase 3B·3B-corrective 하네스는 앱의 자동 저장 레코드를 직접 심는다. WO-01
이후 레코드는 리비전 봉투(`{ format: 'sigrun-autosave', revision, savedAt,
payload }`)이므로, `tools/e2e_phase3_3b.cjs` · `tools/e2e_phase3_3b_corrective.cjs`
의 시딩 헬퍼가 봉투를 풀고/씌우도록 고쳤다. 검사는 하나도 지우거나 이름을
바꾸거나 완화하지 않았다 — 같은 단언(모델 2개 저장 → 차단 구간 기준)이 양쪽에서
그대로 실행된다. 수정 전 이 브랜치는 `the autosave holds both models for the
seeded state`에서 실패했고, 수정 후 41/41·13/13으로 기준선과 같은 결과다.

## 5. 화면 증거

| 시점 | 파일 | 보이는 것 |
| --- | --- | --- |
| 교정 전(기준선 빌드) | `docs/evidence/wo10/before-tutorial-rsm-001-roundtrip.png` | “Check failed … ROUNDTRIP false” — 저장은 됐지만 왕복 검사가 불일치로 끝남 |
| 교정 후(HEAD 빌드) | `docs/evidence/wo10/after-tutorial-rsm-001-roundtrip.png` | “Practice project saved and read back successfully.” · 12/12 verified |

수치 교정(§2.2)은 화면이 아니라 판정 결과의 변화다: 같은 최적화 케이스가 `invalid/extrapolationNotAllowed`에서 정상 해로 바뀌는 것을 QA 보고서(`qa/reports/latest.json`)가 케이스 단위로 남긴다.

## 6. 재현

```bash
git checkout fix/phase3-final-stabilization
npm ci
npx tsc --noEmit
npm test
npm run qa:stats           # Python 3.12.16 + numpy 2.5.4 · scipy 1.18.1 · statsmodels 0.15.0 · pandas 3.1.1 · patsy 1.0.3
npm run build && node tools/e2e_tutorials.cjs
npm run build:portable && npm run qa:portable && npm run qa:tutorials:portable
npm run qa:guard
npm run qa:network
```

## 7. 수행하지 않은 것 / 주장하지 않는 것

- **Minitab을 실행하지 않았다.** 수치 동등성은 주장하지 않는다(`docs/MINITAB_MASTER_FEATURE_GAP.md` §0).
- GitHub Actions는 이 세션에서 실행하지 못했다(원격 권한 없음). 워크플로 파일은 커밋됐고 PR 푸시 후 실행된다.
- 브라우저 E2E §4의 실패는 **이 호스트에서** 미해결이다. CI(Linux)에서의 통과 여부는 PR CI 결과가 확정한다.
