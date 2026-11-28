# Statelia 브랜딩 · HD2Lab Application Hub 연동 완료 보고

문서: `docs/STATELIA_BRANDING_REPORT.md`
작업지시: **WO-BRAND-001 — Statelia Official Branding & HD2Lab Application Hub Integration**
교정지시: **WO-BRAND-001 — FINAL CORRECTIVE ORDER (FIX-01 ~ FIX-05)**
기준 제품: **Statelia (스타텔리아)** v1.0.0 · 엔진 표시명 **Sigrdrifa Engine v1.0**
작성일: 2026-11-28 (Asia/Seoul)

---

## 0. 요약

| 항목 | 결과 |
| --- | --- |
| WO-B01 브랜드 전환 | 완료 — 헤더/타이틀/메뉴/Help/튜토리얼/샘플/내보내기/매니페스트/README/Release Notes/오류 메시지/OG |
| WO-B02 공식 자산 | 완료 — PO 제공 원본 2장에서 6종 추출·등록, 임의 재생성 없음 |
| WO-B03 스플래시 | 완료 — 1.2s 최소 표시, 320ms 페이드, 복원 비차단, 워치독+재시도, 텍스트 폴백 |
| WO-B04 About | 완료 — 제품/카테고리/엔진/기능 5종/빌드 6항목/개발사·슬로건/AI 고지 + **FIX-02 공식 문의·홈페이지 행** |
| WO-B05 Application Hub | 완료 — `statelia` 카드 등록, 허위 Stable/Download 표시 없음 + **FIX-02 공식 이메일/홈페이지** |
| WO-B06 Portable | 완료 — `Statelia-v1.0.0.html` / `-Portable.zip` / `-Web.zip` + SHA256 |
| WO-B07 Lean QA | 통과 (FIX-01~05 재검증 포함, §8) |
| **FIX-01** 이전 브랜드 제거 | 완료 — About의 `FORMERLY SIGRÚN` 삭제, 사용자 노출 영역 전수 0건 (§3) |
| **FIX-02** 공식 연락처 | 완료 — `ProductEdition.CONTACT_EMAIL`, 공개 `hyperdimensionaldesignlab@gmail.com` / 사내 `''` (§4) |
| **FIX-03** 릴리스 메타데이터 | 완료 — 산출물·`build-info.json`·`VERSION`·README·Release Notes 정합, 파일명 일치 (§5) |
| **FIX-04** 문서 마감 | 완료 — 본 문서 (Push 완료 상태·403 해결 이력·최종 SHA·교정 QA) |
| **FIX-05** 배포 순서 | 완료 — `docs/STATELIA_DEPLOYMENT_SEQUENCE.md` 7단계 (§10) |
| 브랜치 Push | **완료** — 두 저장소 `feat/statelia-branding` 원격 반영 (§1) |
| `main` 병합·운영 배포 | **하지 않음** — PO 승인 대기 (FIX-05 1단계) |

---

## 1. 변경된 저장소 · 브랜치 · 커밋

| 저장소 | Worktree | 브랜치 | 기준 | 브랜딩 커밋 |
| --- | --- | --- | --- | --- |
| `HyangDan2/PKPilot0018` | `worktrees/statelia-PKPilot0018` | `feat/statelia-branding` | `origin/main` `42d5df1` | `e7187d7` → `56f3297` → `db43bc5` |
| `HyangDan2/ApplicationHub` | `worktrees/statelia-ApplicationHub` | `feat/statelia-branding` | `origin/main` `3dad424` | `fc14fc2` |

커밋 작성자: `HD2 <chunxiang2022@gmail.com>`

### 1.1 Push 상태 — 이전 403은 해결됐다

이전 라운드에서 `git push -u origin feat/statelia-branding` 이
`remote: Permission to HyangDan2/<repo>.git denied to HyangDan2. (403)` 로 거부됐고,
이 문서도 그 상태를 "미완(권한 차단)"으로 적었다. 그 뒤 Pickle의 GitHub 연결에서 코드 쓰기 권한이
열렸고, **이번 라운드 시작 시점에 두 브랜치가 이미 원격에 있었다**:

    $ git ls-remote origin refs/heads/feat/statelia-branding        # PKPilot0018
    db43bc5af10501c4ba9c926b1f317fb0b3bee7b7   refs/heads/feat/statelia-branding
    $ git ls-remote origin refs/heads/feat/statelia-branding        # ApplicationHub
    fc14fc256202e61ebbe7e2acc69e59daef19dd92   refs/heads/feat/statelia-branding

따라서 403은 **해결된 이력**으로 정리한다(코드 쓰기 권한 문제였고, 저장소 권한은 바뀌지 않았다).
이번 라운드의 교정 커밋도 같은 경로로 Push한다(§11).

### 1.2 이번 라운드 커밋

<!-- COMMITS -->

---

## 2. 공식 브랜드 정의

| 항목 | 값 | 구현 위치 |
| --- | --- | --- |
| Product Name | `Statelia` | `src/config/editions/public.ts` (`APP_NAME`) |
| Korean Name | `스타텔리아` | 동일 `APP_NAME_LOCAL` |
| Version | `v1.0.0` | edition record + `package.json` (빌드 주입) |
| Category | `Statistical Engineering Suite` | `PRODUCT_CATEGORY` |
| Engine | `Sigrdrifa Engine v1` | `ENGINE_NAME` + `ENGINE_VERSION` |
| Developer | `HD2Lab` / `Beyond Dimensions` | `BRAND_NAME` + `SLOGAN` |
| Repository | `HyangDan2/PKPilot0018` | `REPOSITORY_URL` (About 링크) |
| Home page | `https://hyangdan2.github.io/` | `HOMEPAGE_URL` (About · README · 허브) |
| Contact | `hyperdimensionaldesignlab@gmail.com` | `CONTACT_EMAIL` (About · README · 허브) |

브라우저 타이틀은 `Statelia — HD2Lab Statistical Engineering Suite`, PWA 매니페스트
`name`/`short_name`/`description`도 같은 record에서 생성된다.

---

## 3. FIX-01 — 이전 브랜드 제거

### 3.1 About 화면

- `FORMERLY SIGRÚN` / `Formerly Sigrún` / `이전 이름: 시그룬(Sigrún)` 행을 **삭제**했다
  (`AboutPanel.tsx` 에서 `.about-formerly` 문단 제거, `i18n.ts` 에서 `about.formerly` 키 제거,
  `app.css` 의 `.about-formerly` 규칙 제거).
- About은 이제 `Statelia v1.0.0` · `Statistical Engineering Suite` · `Powered by Sigrdrifa Engine v1.0`
  · 기능 5종 · 빌드 정보 8행 · HD2Lab 로고/AI 고지로 끝난다.

### 3.2 사용자 노출 영역 전수 확인

| 영역 | 처리 |
| --- | --- |
| UI 문자열(`i18n.ts` 1,900+ 키) | 이전 제품명 0건 (튜토리얼 `Learn Statelia`·`Getting Started with Statelia` 포함) |
| Help · Help Center · About | 0건 (§3.1, 스크린샷 `docs/branding/about-*.png`) |
| 튜토리얼 3개 코스 · Sample Library | 0건 (본문·제목·설명) |
| 내보내기 기본 파일명/라벨 | 프로젝트 `statelia-YYYY-MM-DD.sigrun.json`, 차트 `statelia-<chart>-<dpi>.png`, Excel `Statelia-workbook`, 컬러맵 라벨 `Statelia Classic` / `스타텔리아 클래식` |
| 오류·안내 메시지 | `That file could not be read as a Statelia project…` 등 6종 |
| 상태바 | `HD2LAB · STATELIA · PHASE 3` |
| `public/qa.html` (QA 프레임) | `<title>Statelia — responsive QA frame` |
| `README.md` | 이전 이름 문장 삭제, 공식 홈페이지·문의 추가 |
| `docs/release/*` (Release Notes·README-EN/KO·KNOWN_LIMITATIONS) | 0건 |
| `docs/PORTABLE_BUILD_GUIDE.md` | 0건 (`statelia-portable.html` 로 파일명 갱신) |
| `release/v1.0.0/*` | 0건 (재생성, §5) |
| 소스 주석 헤더(`src/**`, `tests/**`, `tools/**`, `vite*.ts`) | `Statelia —` 로 통일 |
| CI 워크플로 이름 | `Deploy Statelia to GitHub Pages` |
| ApplicationHub 카드·설명·CHANGELOG·onboarding | 0건 |
| 엔지니어링 문서 6종(튜토리얼 시스템·엔터프라이즈 구조·모델 스토어·Stage 3·CI 패치·Phase 4 백로그) | 0건 (살아 있는 문서라 갱신) |

### 3.3 호환성을 위해 **남긴** 것 (의도)

| 항목 | 위치 | 이유 |
| --- | --- | --- |
| Storage Key `sigrun.*`, `sigrun-workspace`(IndexedDB), `sigrun.enterprise.*` | `src/config/storageNamespace.ts` 등 | 기존 사용자의 자동 저장본을 그대로 읽어야 한다 (`qa:network` 실측 키) |
| 프로젝트 스키마 `format: "sigrun-project"`, `.sigrun.json` / `.mpx.json`, `sigrun-model`, `sigrun-layout` | `src/lib/project.ts` | 구 빌드가 쓴 프로젝트가 그대로 열려야 한다 |
| 테스트/도구 fixture `app: "HD2Lab Sigrún"`, PNG `Software` 텍스트 | `tests/*.test.ts`, `tools/fixtures/guard-original.sigrun.json` | 구 빌드 산출물의 회귀 검증용 |
| `__SIGRUN_DISABLE_WEBGL__` 테스트 훅 | `src/components/Surface3DView.tsx` | E2E가 쓰는 훅 |
| 컬러맵 id `sigrun-classic` | `src/lib/chartStyles.ts` 등 | 저장된 프로젝트의 스타일 id |
| 사내 에디션 `Sigrún Enterprise` / `시그룬 엔터프라이즈` / `sigrun-enterprise` | `src/config/editions/enterprise.ts` | **FIX-01이 명시적으로 제외** — 사내 독립 브랜드 |
| 과거 QA 증적: `docs/PHASE3_*`, `docs/CHART_*`, `docs/MINITAB_*`, `docs/audit/*`, `docs/evidence/*`, `qa/*`, `release/v1.0.0-rc.1/*`, `pr-body-*.md` | — | 그 시점의 기록을 고쳐 쓰면 증적이 아니게 된다. `docs/RELEASE_V1_0_0_QUALIFICATION.md` 에는 "이 문서는 rc.1 시점 기록"이라는 안내를 넣었다 |

`docs/audit/minitab-gap-matrix.csv` 의 `Sigrún Feature` **컬럼명**과 `tools/verify_audit.mjs` 는 그
CSV 스키마를 읽는 코드라 함께 남겼다(감사 데이터 자체를 다시 만들지 않는 한 바꿀 수 없다).

### 3.4 자동 가드

- `tools/release.mjs check` — 공개 edition record의 모든 문자열 필드에 `/sigrún|sigrun|시그룬/i` 가 있으면 **FAIL**.
- `tools/release.mjs verify` — 릴리스 텍스트 6종 + 포터블 HTML을 같은 규칙으로 스캔해 **FAIL**
  (`.sigrun.json`·`sigrun-project` 같은 호환 표기는 정규식에서 제외).
- `tests/release-enterprise-config.test.ts` — 공개 record에 이전 이름이 없음을 단위 테스트로 고정.

---

## 4. FIX-02 — 공식 연락처 체계

### 4.1 `CONTACT_EMAIL` 필드

`ProductEdition` 인터페이스(`src/config/product.ts`)에 `CONTACT_EMAIL: string` 을 추가했다.

| 에디션 | 값 | 근거 |
| --- | --- | --- |
| Public (`Statelia`) | `hyperdimensionaldesignlab@gmail.com` | HD2Lab 공식 문의 메일 |
| Enterprise | `''` | 공개용 주소가 사내 빌드로 새지 않도록 분리. `release.mjs check` 가 비어 있지 않으면 FAIL |

개인 메일(`jhshim1988`)은 코드·문서·카탈로그 어디에도 쓰지 않았다(테스트가 값을 직접 쓰지 않고
"모든 카탈로그 연락처는 공식 주소와 같다"로 검증한다).

### 4.2 반영 위치

| 위치 | 내용 |
| --- | --- |
| About ▸ Build information | `Official contact` 행 → `mailto:hyperdimensionaldesignlab@gmail.com` (`data-testid="about-contact"`) |
| About ▸ Build information | `HD2Lab homepage` 행 → `https://hyangdan2.github.io/` |
| `README.md` | `**HD2Lab:** https://hyangdan2.github.io/ · **Contact:** hyperdimensionaldesignlab@gmail.com` |
| `docs/release/README-EN.txt` / `README-KO.txt` | `Contact` / `문의` 절 (홈페이지·문의 메일) |
| 포터블 zip 내부 `README.txt` | 빌드가 `CONTACT_EMAIL`/`HOMEPAGE_URL` 을 읽어 `Contact` 절을 생성 |
| `docs/release/RELEASE_NOTES.md` | `## Contact` 절 + About 설명 문장 갱신 |
| ApplicationHub `data/apps.json` → `statelia` | `homepageUrl` · `contactEmail` 추가, 카드에 텍스트로 표시 |

### 4.3 공식 홈페이지 URL 통일

`ApplicationHub` 가 실제로 쓰는 공식 주소는 `https://hyangdan2.github.io/` 다 — 상단 내비 `Home`,
`scripts/build.mjs` 의 `HQ`, `scripts/check-links.mjs`, 모든 카드의 `launchUrl` 접두사가 이 주소다.
`https://hyangdan2.github.io/Web-HQ/` 는 코드베이스 어디에도 없다(리다이렉트도 없다).
따라서 **`https://hyangdan2.github.io/` 로 통일**했고, `public.ts`·README·Release Notes·About·허브가
같은 값을 쓴다.

### 4.4 화면 증적

| 파일 | 내용 |
| --- | --- |
| `docs/branding/about-panel-desktop.png` | About 상단 (라이트, 1440×900) — 이전 이름 행 없음 |
| `docs/branding/about-contact-desktop.png` | About 하단 — `Official repository` · `HD2Lab homepage` · `Official contact` |
| `docs/branding/about-dark-desktop.png` | 다크 테마 About |
| `docs/branding/about-panel-dark-desktop.png` | 다크 테마 About 패널 클로즈업 |

브라우저 검증(포터블 `file://`, Chromium 1440×900): `mailto` 대상·홈페이지 href·이전 이름 0건·
`Formerly` 행 없음·패널 텍스트에 `Statelia`/`Sigrdrifa Engine` 존재 — **10/10 PASS**.

---

## 5. FIX-03 — 릴리스 메타데이터 정합

### 5.1 발견한 결함과 수정

| 결함 | 수정 |
| --- | --- |
| `build-info.json` 의 `file`/`zip.file` 이 `sigrun-portable.html`/`.zip` — 실제 배포 파일명과 불일치 | 포터블 산출물 이름을 `statelia-portable.html`/`.zip` 으로 바꾸고(`tools/build_portable.mjs`, `vite.portable.config.ts` 진입 파일명 `statelia.js`/`.css`), zip 내부 폴더도 `statelia-portable/` |
| Release Notes 파일 표가 `Sigrun-%RELEASE_ID%*` | `%PRODUCT%-%RELEASE_ID%*` (빌드가 `Statelia-` 로 치환) |
| `docs/RELEASE_V1_0_0_QUALIFICATION.md` 가 "파일명 접두사 `Sigrun-` 고정" 이라고 단정 | 제품 레코드를 따른다고 정정, rc.1 행은 역사 기록으로 표기 |
| `release/v1.0.0/` 텍스트에 이전 이름 잔존 | 재생성으로 0건 |
| 이전 이름이 산출물에 다시 들어와도 잡히지 않음 | `release.mjs verify` 에 brand sweep 추가 |

### 5.2 배포 파일명 일치 검증

`release/v1.0.0/` (11개):

| 파일 | `build-info.json` 참조 |
| --- | --- |
| `Statelia-v1.0.0.html` | `artifacts.html` |
| `Statelia-v1.0.0-Portable.zip` | `artifacts.portableZip` (+ 내부 `statelia-portable/statelia-portable.html` 바이트 동일) |
| `Statelia-v1.0.0-Web.zip` | `artifacts.webZip` |
| `build-info.json` | `file: statelia-portable.html`, `zip.file: statelia-portable.zip`, `commit`, `sha256`, `bytes` |
| `VERSION.txt`, `README-EN.txt`, `README-KO.txt`, `RELEASE_NOTES.md`, `KNOWN_LIMITATIONS.md`, `LICENSES.txt`, `SHA256SUMS.txt` | `release.mjs verify` 파일셋 검사 대상 |

`release.mjs verify` 는 **파일셋·모든 해시·아카이브 내부·원격 리소스 0건·페이지 토큰 미해결 0건·
브랜드 스윕**을 함께 검사하며, `--repro` 로 같은 epoch 재빌드 시 포터블 HTML 이 바이트 동일함을 확인한다.

### 5.3 커밋 SHA 반영 순서

빌드는 About 패널·`VERSION.txt`·`build-info.json` 에 **빌드 시점 HEAD short SHA** 를 넣는다.
그래서 순서를 다음과 같이 고정했다.

1. 코드·문서 수정 커밋 (이 커밋이 최종 코드 커밋 = 산출물이 가리키는 SHA)
2. 그 커밋 위에서 `RELEASE_ID=v1.0.0 node tools/release.mjs build` → 산출물 재생성
3. 산출물·`SHA256SUMS.txt` 커밋
4. 문서(본 보고서)만 갱신하는 커밋 — 빌드 입력(`src`, `public`, `index.html`, `portable.html`,
   `package-lock.json`, `tsconfig.json`, `vite*.ts`, `tools/build_portable.mjs`, `tools/build_manifest.mjs`,
   `tools/product_plugin.ts`)을 건드리지 않으므로 `verify` 는 "built at <SHA>, before HEAD — build inputs unchanged"
   로 통과한다.

즉 **About 패널의 Commit SHA = 산출물 `build-info.json` 의 `commit` = 최종 코드 커밋**이며,
문서 커밋은 그 뒤에 온다(코드가 바뀌면 다시 빌드해야 한다는 규칙을 `verify` 가 강제한다).

---

## 6. 공식 Asset 목록 (WO-B02)

원본(임의 생성·대체 없음):

1. `attachments/2026-11-28/1EAA912E-…jpg` — HD²LAB Beyond Dimensions 공식 로고 (2048×688, 흰 배경)
2. `attachments/2026-11-28/79DB2988-…jpg` — STATELIA 공식 스플래시 (1671×941)

추출·등록 결과:

| 자산 | 경로 | 크기 | 방법 |
| --- | --- | --- | --- |
| `statelia-splash.webp` | `src/branding/` | 1671×941 · 288 KB | 원본 비율 유지, 자르지 않고 WebP q92 변환 |
| `statelia-og.webp` | `public/branding/` (+`og-image.png`) | 1200×630 | 스플래시 16:9 크롭 후 리샘플 |
| `statelia-symbol.png` | `src/branding/` | 307×231 · 30 KB | 좌상단 별·날개 영역 크롭 + 휘도 알파 매팅 |
| `statelia-logo.png` | `src/branding/` | 워드마크 · 56 KB | 상단 STATELIA 영역 크롭 + 외곽 플러드필 실루엣 |
| `sigrdrifa-engine-logo.png` | `src/branding/` | 144×125 · 20 KB | 좌하단 발키리 영역 크롭 + 실루엣 |
| `hd2lab-logo.png` | `src/branding/` | 1024 폭 · 344 KB | 흰 배경 정밀 제거, D 내부 별·궤도·슬로건 보존 |
| `favicon.ico` / `.png` / `.svg` | `public/` | 16~512 | 추출 심볼 그대로(재드로잉 없음) |

시각 검증: `docs/branding/asset-*-check.png` (흰/검/회색 배경 3종).

---

## 7. WO-B03 스플래시 · WO-B04 About (요약)

| 요구 | 구현 |
| --- | --- |
| 약 1.2초 표시 · 320ms 페이드 | `SPLASH_MIN_MS = 1200`, `SPLASH_FADE_MS = 320` |
| 복원 비차단 · 실패 시 재시도 | 스플래시는 오버레이, 복원 `catch` → 오류 패널 + `Retry` |
| 무한 대기 금지 · 반복 표시 금지 | 12초 워치독, 마운트 1회 |
| Reduced Motion · 이미지 실패 폴백 | 페이드 0ms·도트 정지, 텍스트 워드마크 |
| About 항목 | 제품·카테고리·엔진·기능 5종·빌드 8행·개발사/슬로건·AI 고지 |

스크린샷: `docs/branding/splash-*.png`, `docs/branding/about-*.png`.

---

## 8. Lean QA 결과 (이번 라운드 실행)

Node: `/workspace/.tools/node-v22.11.0-linux-x64/bin` (v22.11.0). 브라우저: Playwright Chromium, `CHROME_LIBS=/workspace/tmp/pwlibs`.

| 검증 | 명령 | 결과 |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | **PASS** (오류 0) |
| 단위/회귀 | `npx vitest run` | **1242/1242 PASS** (57 files) — FIX-02 가드 2건 추가 |
| 웹 빌드 | `npm run build` | **PASS** (`dist/`) |
| 포터블 빌드 | `npm run build:portable` | **PASS** — `statelia-portable.html` 2,586.9 kB |
| 산출물 브랜드 스윕 | `statelia-portable.html` · `dist/index.html` · `manifest.json` · `build-info.json` · `README.txt` | **이전 이름 0건** |
| 포터블 오프라인 | `node tools/e2e_portable_offline.cjs` | **63/63 PASS** |
| 네트워크 감사 | `node tools/qa_network_audit.cjs` | **13/13 PASS** (web/portable/enterprise) |
| About 화면 | `node qa/brand-fix/shots.cjs` | **10/10 PASS** (라이트·다크·mailto·홈페이지·이전 이름 0건) |
| 릴리스 프리플라이트 | `RELEASE_ID=v1.0.0 node tools/release.mjs check` | **PASS** |
| 릴리스 빌드 | `RELEASE_ID=v1.0.0 node tools/release.mjs build` | **PASS** · 11 files |
| 릴리스 검증 | `RELEASE_ID=v1.0.0 node tools/release.mjs verify --repro` | **PASS** · portable 바이트 동일 |
| 허브 스키마 | `npm run validate` (ApplicationHub) | **PASS** — 12 apps (12 published) |
| 허브 단위 | `npm test` | **9/9 PASS** (FIX-02 카탈로그 가드 추가) |
| 허브 빌드 | `npm run build` | **PASS** — 12 published apps |
| 허브 링크 | `npm run check:links` | 아래 §8.1 |

<!-- QA-DETAIL -->

### 8.1 허브 링크 검증 메모

`check-links` 는 라이브 주소를 확인한다. `launchUrl`(`https://hyangdan2.github.io/PKPilot0018/`)은
아직 **이전 빌드**를 서빙하므로(1단계 병합 전), 이 단계에서 확인하는 것은 "주소가 살아 있는가"이지
"Statelia가 떠 있는가"가 아니다. 후자는 FIX-05 4단계 Live Smoke Test의 몫이다.

### 8.2 바꾸지 않은 것

- 통계 엔진·분석 정의·수치 기대값: 무변경 (문자열·주석만).
- 전체 통계 QA(`qa:stats`) 재실행: **하지 않았다**(지시: 통계 QA 반복 금지).
- 사내 에디션 브랜드·네임스페이스·링크 정책: 무변경 (`CONTACT_EMAIL: ''` 필드만 추가).
- `main` 병합·Pages 배포·Release 게시: **하지 않았다**.

---

## 9. 기존 기능 호환성

- 저장 키·IndexedDB 이름 불변 → 기존 자동 저장본을 그대로 읽는다
  (`qa:network` 실측: `sigrun.workspace.v2`, `sigrun.autosave.v1`, `sigrun.settings.v1`, `sigrun.floatSizes.v1`).
- 프로젝트 포맷 `sigrun-project` 유지, `.sigrun.json`/`.mpx.json` 수용, `app` 필드는 새 빌드부터 `Statelia` 로 기록.
- **실기기 경로 확인**: 구 빌드가 쓴 `app: "HD2Lab Sigrún"`, `format: "sigrun-project"`, `version: 2` 프로젝트를
  포터블에서 File ▸ Open project로 열어 워크시트 48행·출력 카드 2개가 복원되고 페이지 오류 0건임을 확인
  (`docs/branding/legacy-project-opened.png`). 포터블 오프라인 E2E의 `F/G` 절도 `.sigrun.json` 저장·복원을 매번 확인한다.
- 엔터프라이즈 에디션: record에 `CONTACT_EMAIL` 만 추가, 브랜드·네임스페이스·링크 정책 불변.

---

## 10. FIX-05 — 배포 순서 문서

`docs/STATELIA_DEPLOYMENT_SEQUENCE.md` 에 7단계를 실행 가능한 형태로 적었다.

| 단계 | 내용 | 게이트 |
| --- | --- | --- |
| 1 | PKPilot0018 `main` 병합 | 병합 커밋 CI 초록 |
| 2 | Final Release Gate (재빌드·verify --repro·brand sweep) | 11 파일·해시·브랜드 0건 |
| 3 | Statelia v1.0.0 정식 Release + Pages 배포 | 자산 11개 다운로드·`sha256sum -c` 통과 |
| 4 | Live Smoke Test (운영 URL·Release portable) | 네트워크 13/13 · portable 63/63 · About 10/10 |
| 5 | ApplicationHub Stable 전환 + 실제 다운로드 링크 | validate·test·build·E2E |
| 6 | ApplicationHub `main` 병합·배포 | 허브 카드 표시 확인 |
| 7 | Hub Launch + Portable Download 확인 | 카드 → 앱 → 오프라인 파일 → 해시 일치 |

**Hub 선행 배포 금지**를 문서 첫머리와 0절에 명시했고, 각 단계에 되돌리기 절차를 붙였다.
이 문서는 병합·게시·배포를 **대신 실행하지 않는다** — PO 승인 뒤에 실행한다.

---

## 11. Push 결과

<!-- PUSH -->

---

## 12. 남은 일 / PO 결정 필요

1. **`main` 병합·운영 배포·Release 게시** — FIX-05 1~7단계. PO 승인 필요.
2. **허브 Stable 전환** — 3~4단계 이후에만 (그전에는 `Preview build` 표기가 정직한 상태).
3. **OG 카드 호스팅 확인** — 배포 후 `statelia-og.webp` 반영 확인.
4. **`docs/audit` CSV 컬럼명(`Sigrún Feature`)** — 감사 데이터를 다시 만들 때 함께 바꾸는 편이 좋다.
5. **`release/v1.0.0-rc.1/`** — 과거 RC 증적으로 보존. 저장소에서 지우려면 별도 판단이 필요하다.
