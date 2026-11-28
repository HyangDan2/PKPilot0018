# Statelia 브랜딩 · HD2Lab Application Hub 연동 완료 보고

문서: `docs/STATELIA_BRANDING_REPORT.md`
작업지시: **WO-BRAND-001 — Statelia Official Branding & HD2Lab Application Hub Integration**
기준 제품: 기존 Sigrún(= Legacy Product Name) → **Statelia (스타텔리아)** v1.0.0
엔진 표시명: **Sigrdrifa Engine v1.0**
작성일: 2026-11-28 (Asia/Seoul)

---

## 0. 요약

| 항목 | 결과 |
| --- | --- |
| WO-B01 브랜드 전환 | 완료 — 헤더/타이틀/매뉴/Help/튜토리얼/샘플/내보내기/매니페스트/README/Release Notes/에러 메시지/OG 전부 `Statelia`·`Sigrdrifa Engine v1.0` |
| WO-B02 공식 자산 | 완료 — PO 제공 원본 2장에서 6종 추출·등록, 임의 재생성 없음 |
| WO-B03 스플래시 | 완료 — 1.2s 최소 표시, 320ms 페이드, 복원 비차단, 워치독+재시도, 텍스트 폴백, Reduced Motion |
| WO-B04 About | 완료 — 제품/카테고리/엔진/기능 5종/빌드 6항목/개발사·슬로건/AI 고지 |
| WO-B05 Application Hub | 완료 — `statelia` 카드 등록(심볼·버전·엔진·Preview 표기), 허위 Stable/Download 표시 없음 |
| WO-B06 Portable | 완료 — `Statelia-v1.0.0.html` / `-Portable.zip` / `-Web.zip` + SHA256 |
| WO-B07 Lean QA | 통과 — TypeScript PASS, Vitest 1240/1240, Release verify PASS, Network 13/13, Portable offline **63/63**, Hub validate/test/build PASS |
| 브랜치 Push | **미완(권한 차단)** — 두 저장소 모두 `feat/statelia-branding` 커밋 완료, 원격 Push는 403(코드 쓰기 권한 거부). `main` 병합·배포 없음 |

---

## 1. 변경된 저장소 · 브랜치 · 커밋

| 저장소 | Worktree | 브랜치 | 기준 | 커밋 |
| --- | --- | --- | --- | --- |
| `HyangDan2/PKPilot0018` | `worktrees/statelia-PKPilot0018` | `feat/statelia-branding` | `origin/main` `42d5df1` | `e7187d7` (브랜드 전환 전체) → `56f3297` (심볼 타일·스플래시 백드롭) → 문서 커밋 |
| `HyangDan2/ApplicationHub` | `worktrees/statelia-ApplicationHub` | `feat/statelia-branding` | `origin/main` `3dad424` | `fc14fc2` (카탈로그 등록·카드·문서) |

커밋 작성자: `HD2 <chunxiang2022@gmail.com>`

**Push 상태**: 두 저장소 모두 `git push -u origin feat/statelia-branding`이
`remote: Permission to HyangDan2/<repo>.git denied to HyangDan2. (403)`로 거부되었다.
읽기(fetch/clone/API 조회)는 정상이며, Pickle의 GitHub 연결에서 **코드 쓰기 권한이 꺼져 있는 상태**로 보인다.
커밋은 로컬 worktree에 그대로 남아 있으므로, 연결에서 Code 쓰기를 켜거나 사용자가 직접 아래를 실행하면 올라간다.

    cd worktrees/statelia-PKPilot0018 && git push -u origin feat/statelia-branding
    cd worktrees/statelia-ApplicationHub && git push -u origin feat/statelia-branding
기존 `repos/` 체크아웃은 건드리지 않았고, `main` 병합·운영 배포는 하지 않았다.

---

## 2. 공식 브랜드 정의 반영

| 항목 | 값 | 구현 위치 |
| --- | --- | --- |
| Product Name | `Statelia` | `src/config/editions/public.ts` (`APP_NAME`) |
| Korean Name | `스타텔리아` | 동일 `APP_NAME_LOCAL` |
| Version | `v1.0.0` | edition record + `package.json` (빌드 주입) |
| Category | `Statistical Engineering Suite` | `PRODUCT_CATEGORY` |
| Engine | `Sigrdrifa Engine v1` | `ENGINE_NAME` + `ENGINE_VERSION` |
| Developer | `HD2Lab` / `Beyond Dimensions` | `BRAND_NAME` + `SLOGAN` |
| Repository | `HyangDan2/PKPilot0018` | `REPOSITORY_URL` (About 링크) |
| Legacy | Sigrún | About `Formerly Sigrún` |

브라우저 타이틀은 `Statelia — HD2Lab Statistical Engineering Suite`, PWA 매니페스트
`name`/`short_name`/`description`도 같은 record에서 생성된다(중복 하드코딩 없음).

---

## 3. WO-B01 브랜드 전환 범위

- **헤더/About 배너**: `HD2Lab | Statelia | STATISTICAL ENGINEERING SUITE`
- **브라우저 Title · OG · Twitter · canonical**: edition record 기반 치환
- **Help Center · Help ▸ About · 도움말 문구**: `Statelia` 표기
- **튜토리얼 3개 코스 · Sample Library · Help 문서 4종**: 본문 표기 전환 (`Sigrún`→`Statelia`, `시그룬`→`스타텔리아`)
- **프로젝트 내보내기 UI**: 파일명 prefix `sigrun-` → `statelia-YYYY-MM-DD.sigrun.json`
  (확장자 `.sigrun.json`·포맷 `sigrun-project`는 **유지**)
- **차트 내보내기 파일명**: `statelia-<chart>-<dpi>.png/svg`
- **Excel 내보내기 대체 파일명**: `Statelia-workbook`
- **컬러맵 프리셋 표시명**: `Statelia Classic` / `스타텔리아 클래식` (내부 id `sigrun-classic` 유지)
- **오류·안내 메시지**: `That file could not be read as a Statelia project…` 등 6종
- **상태바**: `HD2LAB · STATELIA · PHASE 3`
- **README · Release Notes · KNOWN_LIMITATIONS · README-EN/KO · VERSION.txt**: `Statelia` 표기, 릴리스 템플릿은 `%PRODUCT%` 토큰으로 빌드 record에서 주입
- **패키지 설명**: `Statelia — HD2Lab statistical engineering suite ... Sigrdrifa Engine`

**건드리지 않은 것(호환성)**

- 저장 키 전부: `sigrun-workspace`(IndexedDB), `sigrun.autosave.v1`, `sigrun.settings.v1`,
  `sigrun.workspace.v2`, `sigrun.chartStyles.v1`, 튜토리얼 4키 — `qa:network`가 실행 중 실제 사용 키를 그대로 확인
- 프로젝트 스키마: `format: "sigrun-project"`, `version` 1/2, `.sigrun.json` / `.mpx.json` 수용
- 엔진 함수명·API 계약·통계 알고리즘: 무변경 (통계 관련 파일은 주석 외 수정 없음)
- 엔터프라이즈 에디션 record: 브랜드 필드 무변경, 신규 필드만 추가 (`Sigrún Enterprise` 유지)

---

## 4. 공식 Asset 목록 (WO-B02)

원본(임의 생성·대체 없음):

1. `attachments/2026-11-28/1EAA912E-…jpg` — HD²LAB Beyond Dimensions 공식 로고 (2048×688, 흰 배경)
2. `attachments/2026-11-28/79DB2988-…jpg` — STATELIA 공식 스플래시 (1671×941)

추출·등록 결과:

| 자산 | 경로 | 크기 | 방법 |
| --- | --- | --- | --- |
| `statelia-splash.webp` | `src/branding/` | 1671×941 · 288 KB | 원본 비율 유지, 자르지 않고 WebP q92 변환 |
| `statelia-og.webp` | `public/branding/` (+`og-image.png`) | 1200×630 | 스플래시 16:9 크롭 후 리샘플 (찌그러짐 없음) |
| `statelia-symbol.png` | `src/branding/` | 307×231 · 30 KB | 좌상단 별·날개 영역 크롭 + 휘도 알파 매팅, 배경 스트릭 제거 |
| `statelia-logo.png` | `src/branding/` | 워드마크 · 56 KB | 상단 STATELIA 영역 크롭 + 외곽 플러드필 실루엣 |
| `sigrdrifa-engine-logo.png` | `src/branding/` | 144×125 · 20 KB | 좌하단 발키리 영역 크롭 + 실루엣 |
| `hd2lab-logo.png` | `src/branding/` | 1024 폭 · 344 KB | 흰 배경 정밀 제거(테두리 플러드필 + 흰 프린지 제거), D 내부 별·궤도·슬로건 보존, Italic/Skew 없음 |
| `favicon.ico` | `public/` | 16/32/48/64/128/256 멀티사이즈 | 추출 심볼을 정사각 패딩 후 ICO |
| `favicon.png` | `public/favicon-32x32.png`, `favicon-192.png`, `favicon-256.png`, `favicon-512.png`, `apple-touch-icon.png` | 32~512 | 동일 심볼, 배경 플레이트 없는 순수 투명 |
| `favicon.svg` | `public/` | 256 | 공식 심볼 래스터를 그대로 담은 SVG 래퍼(재드로잉 아님) |

시각 검증(흰/검/회색 배경 3종): `docs/branding/asset-symbol-check.png`,
`asset-logo-check.png`, `asset-engine-check.png`, `asset-hd2lab-check.png`.

- 사각 크롭·배경 찌꺼기 없음. HD²LAB 로고는 흰 배경 제거 후에도 글자 내부 하이라이트와
  보라/시안 그라데이션이 유지된다.
- 공식 심볼·발키리·워드마크는 원본이 "밝은 아트워크"라 흰 배경에서 대비가 낮다.
  그래서 About 패널에서는 **이미지 자체를 바꾸지 않고** 브랜드 다크 타일(#0B1024) 위에
  얹어 표시하고, 허브 카드도 같은 타일을 쓴다.

---

## 5. WO-B03 Startup Splash

동작:

| 요구 | 구현 |
| --- | --- |
| 약 1.2초 표시 | `SPLASH_MIN_MS = 1200` |
| 초기화 완료 시 자연 종료 | 복원(`hydrated`)이 끝나고 최소 시간이 지나면 `leaving` |
| Fade-out 250~350ms | `SPLASH_FADE_MS = 320`, CSS opacity transition |
| 초기화 중에만 Loading 표시 | 스플래시는 오버레이일 뿐 복원을 소유하지 않음 |
| 초기화 실패 시 오류 + 재시도 | 복원 `catch` → 오류 패널 + `Retry`(페이지 새로고침 없이 복원 재실행) |
| 무한 대기 금지 | 12초 워치독 → 오류·재시도 상태로 전환 |
| 반복 표시 금지 | App 마운트 시 1회, 메뉴/분석 실행과 무관 |
| 모바일/데스크톱 | 1440×900·390×844 캡처 확인 |
| 이미지 실패 시 텍스트 폴백 | `brandAsset()` 미존재 또는 `onError` → 텍스트 워드마크 패널 |
| Reduced Motion | `prefers-reduced-motion`에서 페이드 0ms·도트 애니메이션 정지 |
| Web/Portable 동일 경험 | 동일 컴포넌트, 포터블은 이미지를 data URL로 인라인 |

스크린샷: `docs/branding/splash-desktop-1440x900.png`, `splash-mobile-390x844.png`
(모바일은 세로 화면 레터박스를 같은 아트워크의 블러 배경으로 채운다.)

---

## 6. WO-B04 About Statelia

표시 항목(전부 빌드 record/메타데이터 연동, 중복 하드코딩 없음):

- `Statelia v1.0.0` · `Statistical Engineering Suite`
- `Powered by Sigrdrifa Engine v1.0` · `Developed by HD2Lab` · `Beyond Dimensions`
- 기능 5종: Statistical Analysis / Quality & SPC / DOE & RSM / Modeling & Optimization / Scientific Visualization
- Build information: Build version(`v1.0.0 · Phase 3 · public`), Commit SHA, Release date,
  Open source licenses(LICENSES.txt 안내), Known limitations(KNOWN_LIMITATIONS.md 안내),
  Official repository, HD2Lab homepage
- `Note: This program was created using generative AI and may contain errors.`
- `Formerly Sigrún` (Legacy 표기)

빌드 메타데이터는 `vite.config.ts` / `vite.portable.config.ts`가
`VITE_BUILD_COMMIT`(git short SHA) · `VITE_BUILD_DATE`(SOURCE_DATE_EPOCH 또는 빌드일)를
주입하고 `src/config/buildInfo.ts`가 읽는다. 패키지 밖(vitest)에서는 `unknown`으로 폴백한다.

스크린샷: `docs/branding/about-desktop.png`, `about-dark-desktop.png`, `about-mobile-390x844.png`

---

## 7. WO-B05 Application Hub 연동

- 카탈로그 항목: `id: statelia`, `Statelia`, category `Engineering & Analytics`,
  `version v1.0.0`, `engine Sigrdrifa Engine v1.0`,
  launch `https://hyangdan2.github.io/PKPilot0018/`,
  repo `HyangDan2/PKPilot0018`, sortOrder 35, imageKind `artwork`,
  evidence `docs/onboarding/statelia.md`
- 카드: 공식 심볼(다크 타일) · 제품명 · 버전 배지 · 소개 이미지(공식 스플래시 16:9 크롭) ·
  기능 요약 · 엔진/릴리스 라인 · `OPEN APP`
- **정직성**: 정식 Release가 게시되지 않았으므로 `Preview build`로 표시하고
  Portable 다운로드 링크를 만들지 않았다. 문구는
  `v1.0.0 branding build — the portable download follows the official release.`
- 기존 구조 재사용: `data/apps.json` + `js/app.js` 카드 렌더러 + 스키마 확장(선택 필드)만
  추가했고 별도 허브를 만들지 않았다. 12개 앱 전부 스키마 검증 통과, 기존 카드 형태 불변.

스크린샷: `docs/branding/hub-desktop-1440x900.png`, `hub-card-statelia.png`,
`hub-mobile-390x844.png`

---

## 8. WO-B06 Portable · WO-B07 실행 결과

`release/v1.0.0/` (커밋 `56f3297` 기준, `RELEASE_ID=v1.0.0`):

| 파일 | 크기 | SHA256 |
| --- | --- | --- |
| `Statelia-v1.0.0.html` | 2,648,860 B | `91977057df496ca9bf6e8ed8970ccd43f9a12a0b351b70fe11917659d564ffb5` |
| `Statelia-v1.0.0-Portable.zip` | 1,252,156 B | `bc0caad0695c0ea6339acbcc8b050ba65885bbfbb79e6052bbe821eae47031f5` |
| `Statelia-v1.0.0-Web.zip` | 2,623,306 B | `6fe452e7106b3250a8b624eadead9faa7eaccbf7c1f2e5b150f93afa61a15296` |

- `VERSION.txt`: name `Statelia` / version `1.0.0` / engine `Sigrdrifa Engine v1.0` / commit
- `release.mjs verify` → **PASS · 11 files** (파일셋·해시·아카이브 내부·원격 리소스 0)
- 포터블 단일 파일에 스플래시·심볼·파비콘 인라인 포함, `file://` 오프라인 실행 확인
- 포터블 오프라인 E2E(`tools/e2e_portable_offline.cjs`) → **63/63 PASS**
  (부팅·타이틀·분석·차트·3D·최적화·프로파일러·CSV/XLSX·프로젝트 저장/복원 포함)
- `qa:network` → **13/13 PASS**, 포터블이 HTTP(S) 요청 0건, 호스티드 빌드도 자기 origin 밖 요청 0건

스크린샷: `docs/branding/portable-desktop.png`, `portable-mobile-390x844.png`

---

## 9. 기존 기능 호환성

- 저장 키·IndexedDB 이름 불변 → 기존 사용자의 자동 저장본을 그대로 읽는다.
  (`qa:network` 실행 로그: `sigrun.workspace.v2, sigrun.autosave.v1, sigrun.settings.v1, sigrun.floatSizes.v1`)
- 프로젝트 포맷 `sigrun-project` 유지, `.sigrun.json`/`.mpx.json` 수용.
  테스트 픽스처에 `app: "HD2Lab Sigrún"` 프로젝트가 그대로 남아 있어 **구 빌드가 쓴 프로젝트가
  현재 빌드에서 열리는 경로**를 회귀 테스트가 계속 검증한다.
- 통계 엔진·분석 정의·차트 렌더러: 로직 변경 없음(브랜드 문자열·주석만 변경).
- 엔터프라이즈 에디션: record에 신규 필드만 추가, 브랜드·네임스페이스·링크 정책 불변
  (`qa:network` enterprise 3개 체크 PASS).

---

## 10. QA 결과 (WO-B07)

| 검증 | 명령 | 결과 |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | PASS (오류 0) |
| 단위/회귀 | `npx vitest run` | **1240/1240 PASS** (57 files) |
| 릴리스 프리플라이트 | `RELEASE_ID=v1.0.0 node tools/release.mjs check` | PASS (114 packages license 확인) |
| 릴리스 검증 | `… release.mjs verify` | PASS · 11 files |
| 네트워크 감사 | `npm run qa:network` | 13/13 PASS |
| 포터블 오프라인 | `npm run qa:portable` | 63/63 PASS |
| 허브 스키마 | `npm run validate` | 12 apps 검증 PASS |
| 허브 단위 | `npm test` | 8/8 PASS |
| 허브 빌드 | `npm run build` | 12 published apps |
| 허브 브라우저 E2E | `npx playwright test` | 19/19 PASS |
| 화면 | Chromium 1440×900 / 390×844 | 캡처 10종 (`docs/branding/`) |

브랜드 변경으로 갱신한 테스트: 공개 edition record 기대값, 타이틀/매니페스트 문자열,
상태바 문구, 프로젝트/차트/피겨 파일명 prefix, About 버전 라인 위치(HelpModal → AboutPanel),
포터블 타이틀 검사(하드코딩 → 빌드 record 비교). 통계·수치 기대값은 변경 없음.

---

## 11. 미해결 사항 / PO 결정 필요

1. **원격 Push 권한**: 위 1절 참고 — 코드 쓰기 권한이 없어 브랜치가 원격에 올라가지 않았다.
   WO 종료 조건(Feature Branch Push)은 이 권한이 열린 뒤 한 줄로 완료된다.
2. **`main` 병합·운영 배포**: WO 종료 조건대로 feature 브랜치까지만 올렸다. PO 승인 후
   PKPilot0018 배포 + ApplicationHub 배포를 함께 해야 카드의 Launch URL이 Statelia 빌드를 연다.
   (현재 라이브 Pages는 아직 Sigrún 브랜드 빌드다.)
3. **정식 Release 게시**: `Statelia-v1.0.0*` 3종은 로컬에서 빌드·검증 완료했으나 GitHub Release로
   게시하지 않았다. 게시되면 허브 카드에 Portable 다운로드 링크를 연결할 수 있다
   (현재는 `Preview build` 표기).
4. **허브 카드의 Portable/Release Notes 링크**: 기존 허브는 카드 전체가 `<a>`이고 내부에
   링크·버튼을 두지 않는 규칙(E2E가 검증)이라 중첩 링크를 넣지 않았다. 정식 릴리스가 생기면
   카드 하단에 별도 액션 행을 추가하는 소규모 확장이 필요하다(현재는 안내 문구로 대체).
5. **OG 카드**: 공식 스플래시 기반 `statelia-og.webp`(1200×630)로 교체 완료. 호스티드 반영은
   배포 후 확인 가능.
6. **`statelia-logo.png` 사용처**: 공식 워드마크는 밝은 아트워크라 라이트 테마에서 대비가 낮아
   앱 UI에는 넣지 않고 자산으로만 등록했다(About은 텍스트 락업 + 심볼 타일).
   라이트 테마용 반전/단색 워드마크는 공식 자산이 없어 만들지 않았다.
7. **파비콘 대비**: 투명 심볼 특성상 밝은 탭 배경에서 대비가 낮다. WO 지침대로 배경 플레이트를
   넣지 않았으며, 필요하면 PO가 라이트용 심볼을 제공해야 한다.

---

## 12. 배포 준비 상태

- 코드·자산·문서·릴리스 산출물 모두 `feat/statelia-branding`에 커밋되어 있다(로컬). 원격 Push는 코드 쓰기 권한이 열리면 즉시 가능하다.
- `main` 병합 시 필요한 후속 작업은 (a) Pages 배포, (b) ApplicationHub 배포,
  (c) GitHub Release 게시 + 카드 다운로드 링크 활성화 3가지다.
- 통계 엔진·데이터 마이그레이션·기존 프로젝트 삭제는 없었으며, 되돌릴 경우 브랜치 삭제만으로
  이전 상태로 복귀한다(사용자 데이터는 이 작업으로 변경되지 않음).
