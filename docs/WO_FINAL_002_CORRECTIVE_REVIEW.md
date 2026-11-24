# WO-FINAL-002 — 최종 RC 교정 감리

> **작업지시**: WO-FINAL-002 "Final RC Corrective Review"  
> **기준선**: `d88f012` (`fix/phase3-final-stabilization`, PR #35)  
> **일자**: 2026-11-25  
> **제약**: 신규 기능·아키텍처 변경 없음. 테스트 삭제·skip·허용오차 확대 없음. 정식 Release 발행·`PKPilot0018E0001` 생성 없음.

## 0. 준수 사항

- 신규 기능을 만들지 않았다. Q-01·Q-02는 **이미 있는 복원 경로의 저장 보장**을 고쳤고, Q-03은 판정 정책, Q-04·Q-05·Q-06은 릴리스 도구·CI 범위다.
- 기존 UI/UX·통계 알고리즘·프로젝트 포맷·저장 키를 바꾸지 않았다. 사용자 데이터 보존이 우선이다.
- 테스트를 지우거나 skip하지 않았다. 허용오차를 넓히지 않았다. 기준선의 1,215 테스트는 전부 그대로 통과하며, 새 테스트 25건이 정책을 고정한다(**1,240 / 1,240**, 57 파일).
- 실행하지 않은 검사를 PASS로 세지 않았다(§8).

## 1. 요약

| 항목 | 판정 | 핵심 증거 |
| --- | --- | --- |
| Q-01 원본 영구 복원 보장 | **교정 완료** | `src/lib/restorePolicy.ts`, `src/App.tsx` — 영구 저장 + read-back + 구조 비교 후에만 가드 제거. 6개 경로 동일 정책. `tests/release-restore-policy.test.ts` 12건 |
| Q-02 Custom Chart Style 복원 | **교정 완료** | `applyProjectState`·`resumeTutorial`·핑거프린트에 스타일 포함. 빈 목록도 기록. 같은 스위트 3건 |
| Q-03 Range Intersection | **교정 완료** | `rangeIntersection`이 역전 구간을 반환하지 않음. 근접 경계 정책 명시. `tests/release-numerical.test.ts` |
| Q-04 Release ID | **교정 완료** | 태그·버전·ID 삼자 일치 강제. 정식/RC 채널 구분. `tests/release-identity.test.ts` 7건 |
| Q-05 License Qualification | **교정 완료** | 라이선스 전문·NOTICE·1자 콘텐츠 고지. 미확인 라이선스는 빌드 중단. `tests/release-license-report.test.ts` 5건 |
| Q-06 Release CI | **교정 완료(원격 실행 대기)** | `deploy.yml`·`release.yml`에 통계 QA·portable 튜토리얼·가드·네트워크 감사 추가. PR은 배포 없이 동일 게이트. 클립보드 스위트는 Linux 잡으로 CI에 연결(§7.3) |

수치 검증(이 호스트, HEAD 실측): `tsc` 0 errors · unit **1,240/1,240** · 통계 QA **225/225** · portable offline **63/63** · portable 튜토리얼 **8/8** · 가드 **10/10** · 네트워크 감사 **13/13** · `release:verify --repro` PASS · 11 파일.

## 2. Q-01 — 원본 프로젝트 영구 복원 보장

### 2.1 결함

기준선에서는 원본을 되돌리는 경로가 **메모리 복원 성공만으로 완료**로 간주됐다.

1. 시작 시 가드 복원(`loadProjectJson`)은 상태를 화면에 올린 뒤 가드를 바로 지웠다. 자동 저장이 실패해도(용량 초과·사생활 보호 모드) 가드가 사라져 새로고침 한 번에 원본이 사라질 수 있었다.
2. 실습 종료·다음 튜토리얼 전환(`onExitedTutorial`)도 같은 구조였다.
3. 반대로 자동 저장 레코드가 원본 가드보다 오래된 경우(저장 실패 후 재시작), **최신 원본 대신 오래된 자동 저장이 복원**될 수 있었다.
4. 실습 재개 후 복원, 가드 복원, 세션 종료가 각각 다른 기준을 썼다.

### 2.2 정책 (한 곳에 정의)

`src/lib/restorePolicy.ts`가 네 가지를 제공한다.

| 이름 | 계약 |
| --- | --- |
| `stateFromProject(project)` | 프로젝트 파일이 복원해야 할 상태(시트·활성 시트·출력·모델·그림·사용자 스타일) |
| `stateFromAutosave(payload)` | 자동 저장 payload가 유효할 때만 상태로. 빈 시트 배열은 “상태 없음” |
| `restoredStateMatches(expected, stored)` | 로더 마이그레이션(`migrateWorksheet`)을 거친 양쪽을 `compareProjects`로 **구조 비교**. 필드·배열 순서·수치 정밀도까지 |
| `originalBackupWins(original, record, loadedPrint, practicePrints)` | 가드 핑거프린트 ≠ 현재 상태이고, (a) 현재 상태가 실습 slot이거나 (b) 가드 저장 시각이 자동 저장보다 새롭거나 (c) 자동 저장 시각이 없으면 **가드가 이긴다** |

`src/App.tsx`에 `persistWorkspaceVerified(expected)`를 두어 복원을 다음 순서로만 완료 처리한다.

```
saveProjectState(expected)            → 저장 자체가 실패하면 'unsaved'
loadAutosaveRecord()                  → 디스크에서 다시 읽음
stateFromAutosave(payload)            → 읽을 수 없으면 'mismatch'
restoredStateMatches(expected, readback) → 'verified' | 'mismatch'
```

가드 제거 조건은 **'verified' 단 하나**다. `'unsaved'`는 `tut.originalNotPersisted`, `'mismatch'`는 `tut.originalUnverified`를 보여주고 가드를 유지한다. 두 문구는 en/ko 모두 `src/lib/i18n.ts`에 있다.

### 2.3 적용 경로 (동일 정책)

| 경로 | 위치 | 처리 |
| --- | --- | --- |
| 시작 시 가드 복원 | hydration effect → `restoreGuardedAtStartup` | 복원 → `persistWorkspaceVerified` → verified일 때만 제거 |
| 자동 저장보다 최신 가드 | hydration effect → `originalBackupWins` | 현재 상태가 다르면 가드 복원을 먼저 시도 |
| 실습 재개 | `resumeTutorial` | 재개 전 원본 가드 유지(변경 없음) |
| 실습 저장 후 복원 | `keepPractice` → `restoreAfterPractice` | 기대 상태 캡처 → 세션 종료 → 복원 → 검증 → 조건부 제거 |
| 내보내기 후 복원 | `exportFailedPractice` | 〃 |
| 실습 폐기 | `discardPractice` | 진행 기록을 **먼저** 지우고 복원(복원된 저장본이 실습 핑거프린트와 매칭되는 일 방지) |
| 다음 튜토리얼 전환 | `onExitedTutorial` | 격리 세션이면 스냅숏 복원, 아니면 현재 상태 저장 → 검증 → 조건부 제거 |

### 2.4 회귀 고정 (12건)

`tests/release-restore-policy.test.ts` — 상태 추출, 구조 비교(마이그레이션 수용·셀 차이·스타일 속성 차이), 가드 우선순위 5경우(최신 가드 승, 저장 시각 없는 자동 저장, 오래된 가드 패배, 실습 핑거프린트 승, 동일 핑거프린트는 교체 안 함), 빈 스타일 목록이 라이브러리를 비우는지.

기준선에는 이 모듈이 없으므로 RED는 실행 로그가 아니라 **기준선 코드 경로 분석**(위 2.1의 1~4)으로 남긴다. 새 테스트는 정책의 계약을 고정한다.

## 3. Q-02 — Custom Chart Style 복원

- `applyProjectState(parsed)`가 시트·출력·모델·그림과 함께 `writeCustomStyles(parsed.customChartStyles ?? [])`를 적용한다. `loadProjectJson`과 가드 복원이 같은 함수를 쓴다.
- `resumeTutorial`이 복원 직후 스타일을 명시적으로 기록한다.
- 빈 배열도 **기록**한다(`?? []`) — 이전 세션의 사용자 스타일이 복원된 프로젝트에 남지 않는다. 스타일 목록이 없는 구버전 파일도 같다.
- 핑거프린트(시작 시 가드 비교, 실습 slot 비교)가 `customChartStyles`를 포함해, 스타일만 다른 프로젝트를 같은 것으로 오판하지 않는다.
- 고정: `tests/release-restore-policy.test.ts`의 “an empty style list clears the library” 및 스타일 속성 차이 보고 테스트.

## 4. Q-03 — Numerical Range Intersection

기준선은 근접 경계에서 `[lower, upper]`(lower > upper)를 반환할 수 있었다.

```ts
const usable = ranges.filter(...).map(([a, b]) => [Math.min(a, b), Math.max(a, b)]);
const lower = Math.max(...usable.map(([a]) => a));
const upper = Math.min(...usable.map(([, b]) => b));
if (upper >= lower) return [lower, upper];
if (lower - upper <= rangeSlack(lower, upper)) return [upper, upper];  // 공유점
return null;
```

- 입력 구간은 각각 정렬해 역전 입력을 정규화한다.
- 겹치지 않는 두 구간의 간격이 허용오차(4 ULP + 폭의 1e-9) 이내면 **공유점 `[b, b]`**를 반환하고, 그보다 벌어지면 `null`.
- 반환값의 `lower ≤ upper`는 항상 참 — 역전 구간을 반환하지 않는다.
- 정책과 이유를 함수 주석에 명시했다. `tests/release-numerical.test.ts`가 2 ULP 간격(공유점) · 1e-12 간격(null) · 역전 입력(정규화)을 고정한다.

## 5. Q-04 — Release ID

| 규칙 | 구현 |
| --- | --- |
| ID 형식 | `vX.Y.Z`(정식) 또는 `vX.Y.Z-rc.N`(RC)만. 그 외는 빌드 차단 |
| 태그 연동 | `GITHUB_REF_TYPE=tag` → `GITHUB_REF_NAME`, 그다음 `RELEASE_TAG`, 그다음 로컬 `git describe --tags --exact-match HEAD` |
| 기본값 | 태그가 없으면 `v{package.version}-rc.1`(RC 채널) |
| 불일치 차단 | ID 버전 ≠ package.version, ID ≠ 태그, 형식 오류 → `release:check` FAIL |
| 기록 | `build-info.json`에 `releaseId`·`channel`·`tag` |
| 패키지 검증 | `verify`가 릴리스 폴더의 build-info를 다시 파싱해 채널·태그 불일치를 확인 |

테스트: `tests/release-identity.test.ts` 7건(기본 RC, GITHUB 태그, 로컬 태그, 정식/RC 파싱, 버전 불일치 차단, ID≠태그 차단, 비버전 ID 차단).

## 6. Q-05 — License Qualification

`tools/license_report.mjs`(새 파일)가 `node_modules`의 설치 패키지를 직접 읽는다.

- **전문**: `LICENSE*`·`COPYING*`(≤512 KB) 파일 원문을 패키지별로 수록. 전문이 없는 패키지는 “(the package ships no license text file)”라고 **그대로 적는다** — 라이선스를 만들어 넣지 않는다.
- **NOTICE**: `NOTICE*` 파일 원문을 `--- NOTICE: <file> ---`로 수록.
- **미확인**: license 필드가 없거나 `UNLICENSED`면 문제로 기록하고 `release:check`가 **실패**한다(행도 만들지 않는다).
- **1자 콘텐츠**: `src/`·`public/` 소스와 에셋에는 저장소에 라이선스 선언이 없음을 명시하고, 배포 권한은 **소유자 서면 승인** 대상임을 고지한다(라이선스를 임의 부여하지 않는다).
- 출력은 정렬된 결정적 텍스트다.

현재 빌드: **115개 패키지 확인, 111개 전문 동봉, NOTICE 1개, 미확인 0건**. `release/LICENSES.txt`가 8.5 KB에서 383 KB로 커진 것은 전문을 넣었기 때문이다.

테스트: `tests/release-license-report.test.ts` 5건(미확인 중단·전문/NOTICE 수록·전문 없음 표기·1자 고지·결정성).

## 7. Q-06 — Release CI

### 7.1 릴리스 품질 게이트 (deploy.yml · release.yml 동일)

| 단계 | deploy.yml(main push·PR·수동) | release.yml(v* 태그·수동) |
| --- | --- | --- |
| `tsc` · `npm test` | ✔ | ✔ |
| `pip install -r qa/reference/requirements.txt` | ✔ (Python 3.12) | ✔ |
| `qa:stats` (독립 통계 QA) + 보고서 artifact | ✔ | ✔ |
| `release:check` | — | ✔ |
| `release:build` (SOURCE_DATE_EPOCH 고정) | ✔ | ✔ |
| `release:verify --repro` | ✔ | ✔ |
| `qa:portable` | ✔ | ✔ |
| `qa:tutorials:portable` | ✔ (기존) | ✔ (신규) |
| `qa:guard` | ✔ (신규) | ✔ (신규) |
| `qa:network` | ✔ (신규) | ✔ (신규) |
| release artifact 업로드 | ✔ | ✔ (`sigrun-release`, 90일) |
| Pages 업로드·배포 | 배포 job은 `push`+`refs/heads/main`만 | 해당 없음(권한 `contents: read`) |

`deploy.yml`은 PR 트리거를 추가하고 Pages 단계를 `if: github.event_name != 'pull_request'`로, 배포 job을 `if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'`로 제한했다. 따라서 **PR #35에서 배포 없이 전체 게이트가 실행**된다. 동시성 그룹은 `pages-${{ github.ref }}`로 바꿔 PR 실행이 main 배포를 취소하지 않는다.

### 7.2 로컬 동등 실행 (이 호스트)

같은 명령을 이 호스트에서 순서대로 실행해 전부 통과했다(§8). 단, `qa:stats`의 **golden dataset 재생성 검사**는 Python 3.12.16에서만 파일이 일치한다. 이 호스트는 3.12.15이므로 그 단계만 재현되지 않는다 — 고정 스택 venv(3.12.15 + numpy 2.5.4/scipy 1.18.1/statsmodels 0.15.0/pandas 3.1.1/patsy 1.0.3)로 엔진·어댑터·비교기를 직접 실행해 **225/225 PASS**를 확인했고, 재생성 검사는 CI(3.12.16)가 담당한다.

### 7.3 클립보드 E2E — 별도 환경 재검증

WO-FINAL-001에서 미해결로 남긴 stage1 15건·stage3 4건(합 19 FAIL, 25 미도달)은 macOS 샌드박스의 단일 프로세스 클립보드 한계로, 기준선·Phase 3E·라이브 사이트·시스템 Chrome에서 동일하게 재현됐다. WO-FINAL-002는 이 스위트를 **Linux 러너의 `browser-regression` 잡**으로 CI에 연결했다(`ubuntu-latest` + 러너 내장 Chrome, stage1 → stage3 순차).

- 결과가 통과면: 별도 환경에서 해소되었음이 CI 로그로 증명된다.
- 결과가 실패면: 같은 이름·같은 단언으로 실패가 CI에 그대로 드러나며 **미해결로 남긴다**. 로컬에서 PASS로 세지 않는다.
- 이 호스트에서는 재실행하지 않았다(같은 한계가 반복될 뿐이다). CI 실행 결과가 판정 근거다.

## 8. 추가 검증 (HEAD 실측)

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| `npx tsc --noEmit` | 0 errors | —— |
| `npm test` | **1,240 / 1,240** (57 파일) — 기준선 1,215 + 신규 25 | 실행 로그 |
| `qa:stats` | **225 / 225 PASS**, FAIL·REVIEW·UNVERIFIED·ERROR 0 | 고정 스택 venv 실행 |
| `qa:portable` | **63 / 63** | 실행 로그 |
| `qa:tutorials:portable` | **8 / 8** | 실행 로그 |
| `qa:guard` | **10 / 10** | 실행 로그 |
| `qa:network` | **13 / 13** (공개·portable·엔터프라이즈) | 실행 로그 |
| `release:check` | PASS — 115 패키지, 미확인 0, identity rc/no tag | 실행 로그 |
| `release:build` + `verify --repro` | PASS · 11 파일 · portable HTML 재빌드 바이트 동일 | 실행 로그 |
| SHA-256 재검산 | `release/v1.0.0-rc.1/SHA256SUMS.txt` 전 항목 재계산 일치 | §9 |

## 9. 최종 산출물 (SHA-256)

빌드 커밋·시각과 전체 해시는 `release/v1.0.0-rc.1/build-info.json`·`SHA256SUMS.txt`가 단일 출처다. 이번 재빌드의 11개 파일 해시는 `docs/RELEASE_V1_0_0_QUALIFICATION.md` §2 표에 옮겼다.

```bash
export SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)"
npm run release:check
npm run release:build
npm run release:verify -- --repro
cd release/v1.0.0-rc.1 && sha256sum -c SHA256SUMS.txt
```

## 10. 수행하지 않은 것 / 주장하지 않는 것

- **Minitab을 실행하지 않았다.** 수치 동등성은 주장하지 않는다.
- GitHub Actions는 이 세션에서 **원격 트리거 권한이 없어** 워크플로를 실행하지 못했다. Q-06의 “PR #35에서 배포 없이 전체 게이트” 검증은 PR 푸시 후 CI가 수행하며, 그 전까지는 로컬 동등 실행 결과만 사실로 기록한다.
- 브라우저 stage1·stage3는 이 호스트에서 **미실행**이다(§7.3). CI 결과가 나오기 전까지 19건은 미해결 상태다.
- 정식 Release 발행, 태그 생성, `PKPilot0018E0001` 생성은 하지 않았다.
