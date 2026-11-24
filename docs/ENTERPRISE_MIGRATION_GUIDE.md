# Sigrún Enterprise Edition — 이전 안내

> **작업지시**: WO-FINAL-001 · WO-04 · WO-05  
> **대상**: 폐쇄망 고객이 공개판 HD2Lab Sigrún(PKPilot0018)을 자체 브랜드의 엔터프라이즈판으로 받아 설치하려는 담당자  
> **전제**: 이 저장소에서 `PKPilot0018E0001`은 아직 만들지 않았다. 파생 저장소를 만드는 시점에 이 문서의 §2(브랜드 값)만 해당 저장소의 레코드에 채우면 된다.

## 1. 준비물

| 항목 | 요구 |
| --- | --- |
| Node.js | 22 이상 (빌드 시 `tools/release.mjs`가 확인) |
| 의존성 | 저장소 루트에서 `npm ci` |
| 배포 | 정적 파일 서버(서브패스 또는 루트), 백엔드·DB·API 키 불필요 |
| 브라우저 | Chromium 계열 또는 Firefox/Safari 최신. ES2022 번들 |

## 2. 브랜드 값 확정 (고객 승인 필수)

파생 저장소에서는 [src/config/editions/enterprise.ts](../../src/config/editions/enterprise.ts)의 다음 필드를 **고객이 승인한 값으로만** 채운다. 승인 전에는 비워 두며, 비어 있으면 릴리스 검사가 빌드를 차단한다(추측한 브랜드를 출하하지 않기 위한 장치).

| 필드 | 예 | 비어 있을 때 |
| --- | --- | --- |
| `BRAND_NAME` | `ACME` | `release:check` 차단 |
| `COPYRIGHT` | `© 2026 ACME` | `release:check` 차단 |
| `APP_NAME` | `ACME Sigrún` | 제품 제목·manifest에 사용 |
| `APP_NAME_LOCAL` | `시그룬` | About 패널 한국어 이름 |
| `CANONICAL_URL` | `https://stats.acme.internal/` | 비우면 canonical/OG 태그 제거(폐쇄망 기본값) |
| `OG_IMAGE` | (선택) | 비우면 OG 이미지 태그 제거 |
| `STORAGE_NAMESPACE` | `acme.stats.` | `release:check` 차단 — 공개판 데이터와 분리 |

로그·파비콘 등 정적 자산은 `public/`을 교체한다.

## 3. 빌드

```bash
npm ci
npx tsc --noEmit
npm test                                  # 54 파일 / 1,215건 — 엔진이 바뀌지 않았는지 확인
VITE_EDITION=enterprise VITE_BASE_PATH=/ npm run release:check
VITE_EDITION=enterprise VITE_BASE_PATH=/ npm run release:build
VITE_EDITION=enterprise VITE_BASE_PATH=/ npm run release:verify -- --repro
```

- **서브패스에 배포할 경우** `VITE_BASE_PATH=/통계/`처럼 지정한다. 지정하지 않으면 엔터프라이즈 레코드의 기본값(`/`)을 쓴다.
- 단일 HTML 파일이 필요하면(폐쇄망 PC에 파일로 전달) `VITE_EDITION=enterprise npm run build:portable` 후 `dist-portable/sigrun-portable.html`을 배포한다. `file://`에서 네트워크 요청 없이 동작한다.
- 릴리스 산출물은 `release/<RELEASE_ID>/`에 생기며 `SHA256SUMS.txt`·`build-info.json`으로 검증한다. 파일명 접두사는 현재 `Sigrun-`으로 고정이다(파생 저장소에서 바꾸려면 `tools/release.mjs`의 `nameFor`).

## 4. 배포

1. `dist/`의 내용을 정적 서버 루트(또는 지정 서브패스)에 복사한다.
2. 서버는 `manifest.json`을 `application/manifest+json`으로 제공하면 좋지만 필수는 아니다.
3. 캐시 정책: `assets/`는 해시 파일명이므로 장기 캐시, `index.html`은 짧은 캐시.
4. **외부 인터넷 차단 상태에서** 페이지를 연다. 폐쇄망 기본 정책상 페이지는 외부로 나가지 않는다(§5 검증).

## 5. 설치 검증 체크리스트

| # | 확인 | 방법 | 기대 |
| --- | --- | --- | --- |
| 1 | 브랜드 | 페이지 제목·About 패널 | 승인된 회사명·저작권 |
| 2 | 외부 요청 없음 | 개발자 도구 Network, 페이지 전체 사용 | 자기 서버 밖 요청 0건 |
| 3 | 외부 링크 없음 | 도움말·메뉴 | Web-HQ 등 외부 링크 없음 |
| 4 | 저장 키 분리 | Application ▸ IndexedDB/Local Storage | `acme.stats.*`(또는 지정 namespace)만 생성 |
| 5 | 오프라인 실행 | Portable HTML을 `file://`로 열기 | 요청 0건, 모든 분석 동작 |
| 6 | 릴리스 무결성 | `npm run release:verify` | PASS, `--repro`에서 바이트 동일 |
| 7 | 자동 점검 | `npm run qa:network` | 13/13 PASS (워크스페이스가 공개판일 때와 동일 기준) |

`qa:network`는 저장소 워크스페이스의 세 빌드(공개·portable·엔터프라이즈)를 검사한다. 파생 저장소에서 그대로 쓰려면 `tools/qa_network_audit.cjs`의 브랜드 기대 문자열만 바꾼다.

## 6. 기존 데이터 이전

브라우저 저장소는 에디션별 namespace로 **분리**되어 있고 자동 이전하지 않는다(공개판 데이터를 읽거나 지우지 않는 것이 우선).

- **프로젝트 파일**: 공개판에서 `File ▸ Export project`로 `.sigrun.json`을 내보내고, 엔터프라이즈판에서 `File ▸ Open`으로 연다. 파일 포맷은 에디션과 무관하게 동일하다.
- **연습/튜토리얼 진행·설정**: 이전 대상이 아니다. 새 설치에서 다시 시작한다.
- **확인**: 이전 후 `File ▸ Save project`가 성공하고, 출력·모형·그림이 같은지 화면에서 대조한다. 저장 실패 시 상태 표시줄이 `FAILED`/`QUOTA_EXCEEDED`를 명시하며 조용히 넘어가지 않는다.

## 7. 롤백

- 공개판 데이터는 별도 namespace에 그대로 남아 있다. 공개판으로 되돌리면 기존 프로젝트가 그대로 열린다.
- 엔터프라이즈 빌드 자체를 되돌리려면 이전 릴리스 폴더의 `SHA256SUMS.txt`로 무결성을 확인하고 `dist`를 교체한다.

## 8. 알려진 제약

- Minitab 수치 동등성은 주장하지 않는다(공개판과 동일). 통계 정의 차이는 `docs/MINITAB_MASTER_FEATURE_GAP.md` §6.1에 있다.
- 자동 로그인·권한 체계는 없다. 폐쇄망 서버의 접근 제어는 고객 인프라에서 구성한다.
- 저장소 접근 권한이 있는 사용자는 브라우저 저장소를 직접 지울 수 있다. 제품은 삭제 전 백업·재시도를 하지만, 관리자 정책으로 프로필을 보호하는 편이 안전하다.
