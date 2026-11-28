# Statelia v1.0.0 Release Candidate — 릴리스 자격 검증

> **표기 안내**: 이 문서는 `v1.0.0-rc.1` 시점의 검증 기록이다. 그때의 제품명은 이전 이름이었고,
> `release/v1.0.0-rc.1/`의 파일명도 그대로 보존한다(과거 증적). 정식 `v1.0.0` 산출물은
> `Statelia-v1.0.0*`이며 현행 배포 대상은 `release/v1.0.0/`다.

> **작업지시**: WO-FINAL-001 · WO-06(릴리스 빌드) · WO-08(CI/CD) · **WO-FINAL-002**(최종 RC 교정)  
> **릴리스**: `v1.0.0-rc.1` · 제품 `HD2Lab Statelia 1.0.0` · 에디션 `public` · 채널 `rc` · 태그 `v1.0.0-rc.1`  
> **빌드 커밋**: `91382d3` — main (`Merge pull request #35`)  
> **빌드 환경**: node v22.23.4 · vite 6.4.6 · macOS arm64 (로컬), CI는 ubuntu-latest + node 22  
> **빌드 시각**: `2026-11-24T22:50:52Z` (= `SOURCE_DATE_EPOCH` 1795560652)

## 1. 한 문장 결론

릴리스 산출물 11개 파일은 `release/v1.0.0-rc.1/`에 있고, 모든 해시가 재계산과 일치하며, 기록된 epoch로 portable HTML을 다시 빌드하면 **바이트 단위로 동일**하다. WO-FINAL-002 교정(복원 영구 저장 보장, 스타일 복원, 범위 역전 금지, 태그 연동 릴리스 ID, 라이선스 전문, CI 게이트 확장)이 반영됐다. 확장된 CI 게이트는 PR run `45500479639`에서 배포 없이 전 단계 통과했고, 브라우저 회귀 스위트는 Linux에서 77/77·176/176으로 통과했다(§6·§7).

## 2. 산출물

| 파일 | 바이트 | SHA-256 |
| --- | ---: | --- |
| `Sigrun-v1.0.0-rc.1.html` | 1,605,775 | `db4dad0d3dcec19cf4e1a71611715d84342c7016c9433fdacf954cf8c2071441` |
| `Sigrun-v1.0.0-rc.1-Portable.zip` | 469,961 | `6b652902c6f73699fddb2b0bc8d4b2a037f342215f49cbe82a28a1a32c191d87` |
| `Sigrun-v1.0.0-rc.1-Web.zip` | 616,244 | `5f76c821f3721557947eeffb8940aaf17f6262fa7951f626cacfb35770b42ce4` |
| `build-info.json` | 975 | `815ecfaba2ed43ffb3ccfe17ea89348a49d9b8dc6cbec36a7502a89504376638` |
| `VERSION.txt` | 161 | `8b031c73959e1cb9539e871f771e2e144fa913a4df400f2e2f912ea49c3412b3` |
| `LICENSES.txt` | 383,480 | `46eaa06756853900f66eef8130cea4dacf2be9fb43d97389530d8009c9370459` |
| `README-KO.txt` / `README-EN.txt` | 2,128 / 1,840 | `70e42875…` / `32f8d179…` |
| `RELEASE_NOTES.md` | 4,449 | `d47f1ba3…` |
| `KNOWN_LIMITATIONS.md` | 2,023 | `eae7abb4…` |
| `SHA256SUMS.txt` | 850 | 자기 자신을 나열하지 않음 |

전체 해시는 `release/v1.0.0-rc.1/SHA256SUMS.txt`가 단일 출처다. `build-info.json`에는 다음이 기록된다: 릴리스 ID(`v1.0.0-rc.1`)·**채널(`rc`)·태그(`v1.0.0-rc.1`)**·에디션·커밋(`91382d3`)·빌드 시각·zip 타임스탬프·HTML/zip 해시·web index 해시·파일 수·사용된 node/vite 버전. `SHA256SUMS.txt`를 다시 계산해 10개 항목이 모두 일치함을 확인했다. `LICENSES.txt`가 8.5 KB에서 383 KB로 커진 것은 WO-FINAL-002 Q-05로 **라이선스 전문과 NOTICE 원문**을 넣었기 때문이다.

## 3. 빌드·검증 명령 (그대로 재현 가능)

```bash
npm ci
npm run release:check     # 도구·에디션·라이선스 preflight → PASS
npm run release:build     # web + portable + release/v1.0.0-rc.1/ 조립 + SHA256SUMS
npm run release:verify -- --repro
```

`check` 결과: node 22.23.4(≥22), vite 설치됨, 버전 semver, **릴리스 identity `v1.0.0-rc.1` · rc 채널 · HEAD에 태그 없음**(태그가 있으면 태그·버전·ID 삼자 일치를 강제), 공개판 edition 필수 필드 전부 존재, 공개판 namespace 빈 값(기존 리더 데이터 보존), **115개 패키지 라이선스 확인 · 전문 111 · NOTICE 1 · 미확인 0건**.

`build`는 `SOURCE_DATE_EPOCH`를 유일한 시계로 쓴다. 미설정 시 현재 시각을 고정해 자식 프로세스(Vite·portable 빌더·ZIP 작성기)에 같은 값을 넘기므로, About 연도·ZIP 타임스탬프·manifest·해시가 모두 같은 시각을 가리킨다.

`verify --repro` 결과:

```
release verify: PASS · release/v1.0.0-rc.1 · 11 files
portable HTML is byte-identical on rebuild
```

검증 항목: 파일 집합(예상 11개, 여분 0), 모든 해시 재계산, `SHA256SUMS.txt` 자기 미포함, `build-info.json` 자기 해시 미포함(순환 방지), 버전·커밋·릴리스 ID 일치, VERSION.txt 교차 확인, Portable.zip 안의 HTML이 릴리스 HTML과 바이트 동일, Web.zip의 index.html이 빌드 페이지와 동일, ZIP 타임스탬프가 빌드 스탬프와 일치, HTML이 외부 스크립트를 싣지 않음, 미해결 제품 토큰 0건, 공개 manifest의 브랜드 유지.

커밋 검사는 “빌드 커밋 이후 `src`·`public`·`index.html`·`portable.html`·`package-lock.json`·`tsconfig.json`·Vite 설정·portable 패키저 등 **빌드 입력이 바뀌지 않았을 것**”을 뜻한다. 문서·CI·테스트 도구만 바뀐 후속 커밋은 산출물을 무효화하지 않으며, 빌드 입력이 바뀌면 예전 산출물은 즉시 실패한다. 이 저장소의 산출물은 `91382d3`(main 병합 커밋)에서 태그 identity(`RELEASE_TAG=v1.0.0-rc.1`)로 빌드됐고, 그 뒤 커밋은 산출물·문서뿐이다(검증 출력: `built at 91382d3, before HEAD … — build inputs unchanged`). 태그 `v1.0.0-rc.1`은 이 산출물을 포함한 커밋에 동결된다.

## 4. 라이선스

`LICENSES.txt`는 `node_modules`에서 직접 생성한다(115개 패키지). WO-FINAL-002 Q-05로 각 패키지의 **라이선스 전문**(`LICENSE*`·`COPYING*`)과 **NOTICE 원문**을 수록하고, 전문이 없는 패키지는 그 사실을 그대로 적는다. 소스·에셋(`src/`·`public/`)에는 저장소 라이선스 선언이 없으며 배포 권한은 **소유자 서면 승인** 대상이라는 1자 콘텐츠 고지를 포함한다 — 라이선스를 임의로 부여하지 않는다. 라이선스가 없거나 `UNLICENSED`인 패키지가 있으면 `release:check`가 **실패**하고 산출물을 만들지 않는다. 이번 빌드에서 미확인 라이선스는 0건이다.

## 5. 품질 게이트 (릴리스 시점 실측)

| 스위트 | 결과 | 근거 |
| --- | --- | --- |
| `npx tsc --noEmit` | 0 errors | —— |
| `npm test` | **1,240 / 1,240** (57 파일) | 1,215(기준선) + WO-FINAL-002 신규 25 |
| `npm run qa:stats` (SciPy 1.18.1·statsmodels 0.15.0 독립 기준) | **225 / 225 PASS**, FAIL·REVIEW·UNVERIFIED·ERROR 0 | `qa/reports/latest.json` — 로컬은 고정 스택 venv, golden 재생성 검사는 CI(Python 3.12.16) |
| 웹 튜토리얼 E2E | **28 / 28 checks** — 12개 레슨 전부 완주, 대표 레슨 round-trip 검증 | `docs/evidence/wo07-GREEN.log` |
| 브라우저 E2E 회귀 (stage1·2·3, chart, ui_compact, 3A–3D) | 실행 기록 §6 | `docs/evidence/wo07-e2e-browser.log` |
| Portable 오프라인 E2E (`file://`) | **63 / 63** | `qa:portable` |
| Portable 튜토리얼 | **8 / 8** | `qa:tutorials:portable` |
| 튜토리얼 가드 프로브 | **10 / 10** | `qa:guard` |
| 네트워크 감사(공개·portable·엔터프라이즈) | **13 / 13** | `docs/evidence/wo05-network-audit.log` |
| 감사 자산 검산 | 0 errors (300행, 289 URL HTTP 200) | `node tools/verify_audit.mjs` |

상세와 교정 이력은 `docs/PHASE3_FINAL_CORRECTIVE_QA.md`에 있다.

## 6. 브라우저 E2E 회귀 (로컬 dist 기준)

| 스위트 | 이 브랜치 | 기준선 52e8a79 | 판정 |
| --- | --- | --- | --- |
| stage1 (워크시트·선택·메뉴) | 37 PASS · 15 FAIL (52/77에서 하네스 중단) | **37 PASS · 15 FAIL** — 같은 15건, 같은 중단 | 환경(클립보드) — 기준선 동일 |
| stage2 (산점도·차트) | **37 / 37** | — | PASS |
| stage3 (레이아웃·회귀) | 172 / 176 — 4 FAIL 모두 붙여넣기 | **172 / 176** — 같은 4건, 같은 상세 | 환경(클립보드) — 기준선 동일 |
| chart_axes | **6 / 6** | — | PASS |
| chart_upgrade | **34 / 34** | — | PASS |
| ui_compact (파트 분리 4회) | **63 / 63** (23+26+7+7) | — | PASS |
| Phase 3A | **29 / 29** | — | PASS |
| Phase 3B | **41 / 41** | **41 / 41** | PASS |
| Phase 3B corrective | **13 / 13** | **13 / 13** | PASS |
| Phase 3C | **24 / 24** | — | PASS |
| Phase 3D | **49 / 49** | — | PASS |
| 합계 | **505 / 524 실행**, 19 FAIL(전부 클립보드 계열), 25 미도달 | — | 아래 |

위 표는 macOS 로컬 호스트의 기록이다. 같은 스위트를 Linux CI(`browser-regression`)에서 실행한 결과는 stage1 **77 / 77**, stage3 **176 / 176**(WO-FINAL-002)로, 클립보드 실패와 미도달이 모두 해소됐다(§6 본문).

stage1·stage3의 실패는 모두 클립보드 경로였다. 앱이 선택 영역을
`navigator.clipboard`로 쓰고 하네스가 읽어오는데, macOS 단일 프로세스
헤드리스 Chromium에서는 앱의 쓰기가 하네스 쪽으로 전달되지 않아 이전 값
(`10.069`, `Line 3/Line 1` 등)이 그대로 읽히고 이후 붙여넣기 검사가 연쇄
실패한다. 같은 15건·4건이 기준선 `52e8a79`, Phase 3E `2695b65`, 라이브
Pages 사이트(`LIVE=1`)에서도 재현됐다. PASS로 세지 않았다.

**WO-FINAL-002에서 이 스위트를 Linux `browser-regression` 잡으로 CI에
연결했고, 실행 결과 전건 통과했다** — stage1 **77 / 77**, stage3
**176 / 176**(run `45499225672`, `45500479639`). 19 FAIL은 이 브랜치의
결함이 아니라 macOS 샌드박스 한계였음이 별도 환경에서 확정됐고, 미도달
25건까지 전부 실행·통과했다. 상세: `docs/WO_FINAL_002_CORRECTIVE_REVIEW.md` §7.3.

ui_compact는 한 브라우저 프로세스에서 모든 파트를 이어 돌리면 컨텍스트 전환
중 브라우저가 닫힌다(샌드박스 단일 프로세스 한계 — 하네스 안내대로 파트를
나눠 실행). 원시 로그: `docs/evidence/e2e/`, 요약·해설:
`docs/evidence/wo07-e2e-browser.log`.

## 7. CI/CD (WO-08)

| 워크플로 | 트리거 | 단계 |
| --- | --- | --- |
| `.github/workflows/deploy.yml` | main push · **pull_request** · 수동 | `npm ci` → `tsc` → `npm test` → Python 고정 스택 설치 → **`qa:stats`** → `SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)` 로 `release:build` → `release:verify --repro` → portable 오프라인·튜토리얼 E2E → **`qa:guard`** → **`qa:network`** → release artifact 업로드 → (비PR) Pages 업로드·배포. 배포 job은 `push`+`refs/heads/main`만 |
| 〃 `browser-regression` 잡 | 〃 | `ubuntu-latest` + 러너 Chrome으로 stage1·stage3 실행 — macOS에서 미해결이던 클립보드 19건의 **별도 환경 재검증** |
| `.github/workflows/release.yml` | `v*` 태그 | 같은 게이트 + `release:check`(태그 identity)를 태그 커밋에 실행, `sigrun-release` artifact 90일 보관. 권한은 `contents: read` — 태그·릴리스 생성은 하지 않는다 |
| `.github/workflows/qa-stats.yml` | (기존) | Python 고정 환경 통계 QA + node 캐시 (deploy와 중복 실행 허용) |

**실행 기록**: PR #35의 run `45500479639`에서 `deploy.yml`이 **배포 없이** 전체 게이트를 통과했다 — tsc · unit 1,240 · 통계 QA 225/225 · release build/verify(portable HTML 바이트 동일) · portable 63/63 · portable 튜토리얼 8/8 · 가드 10/10 · 네트워크 13/13, `browser-regression` stage1 77/77 · stage3 176/176, 배포 job skipped. 첫 실행(run `45499225672`)에서는 `qa:portable`이 Linux에서 macOS 전용 브라우저 플래그 때문에 런치 단계에서 실패했고, 플래그를 플랫폼별로 나눈 수정(`fc67f7e`, 검사 불변) 후 재실행에서 통과했다 — 그 실패도 숨기지 않고 기록한다(`docs/WO_FINAL_002_CORRECTIVE_REVIEW.md` §7.4).

## 8. 남은 제약 (릴리스 노트와 동일)

1. **Minitab 미실행** — 수치 동등성은 주장하지 않는다. 검정력은 비중심 t·F CDF를 직접 계산하며 Minitab 표와는 반올림 자리에서만 다를 수 있다.
2. 정규성 검정 p(AD)는 근사식, 비율 CI는 정규근사 — Minitab의 정확 방법과 정의가 다르다.
3. 엔터프라이즈 브랜드(`BRAND_NAME`/`COPYRIGHT`)는 고객 승인 전이라 비어 있고, 그 상태로는 엔터프라이즈 릴리스 빌드가 차단된다(의도).
4. 릴리스 파일명 접두사는 제품 레코드를 따른다 — 정식 `v1.0.0`은 `Statelia-`, 위 표의 `-rc.1` 파일은 만들 당시 이름 그대로 보존한다.
5. 이 RC는 `-rc.1`이며 정식 `v1.0.0` 태그·릴리스는 검토 후 별도로 만든다(이 작업에서 태그를 만들지 않았다).
