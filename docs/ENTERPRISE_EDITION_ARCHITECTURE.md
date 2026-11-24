# Sigrún Enterprise Edition — 구조

> **작업지시**: WO-FINAL-001 · WO-04(엔터프라이즈 구성) · WO-05(오프라인/보안 검증)  
> **기준 커밋**: `f83b03b` (2026-11-25, 브랜치 `fix/phase3-final-stabilization`)  
> **범위**: 기존 통계 엔진·UI·데이터 형식을 그대로 두고 **빌드 시점에 제품 정체성을 하나의 레코드에서 파생**한다. Phase 4 기능은 추가하지 않았다. 후속 저장소(`PKPilot0018E0001`)는 이 작업에서 생성하지 않는다.

## 1. 왜 "에디션 레코드" 하나인가

이전 빌드는 제품명·주소·저장 키가 `index.html`, `vite.config.ts`, 개별 모듈에 흩어져 있었다. 파생 제품을 만들려면 그 값들을 코드 곳곳에서 찾아 바꿔야 했고, 하나라도 빠지면 공개 사이트의 브랜드나 저장 키가 섞였다.

지금은 `src/config/editions/`의 레코드 두 개가 유일한 출처이고, 빌드 도구·테스트·HTML·PWA manifest·portable 패키저가 모두 이 레코드를 읽는다. **엔진 코드(`src/lib`)는 에디션을 모른다.**

| 파일 | 역할 |
| --- | --- |
| `src/config/product.ts` | `ProductEdition` 타입, `VITE_EDITION` 선택 로직, `PRODUCT`(버전·base 주입), `BUILD_YEAR` |
| `src/config/editions/public.ts` | 공개판 레코드 — 현재 라이브 사이트의 브랜드·주소·저장 키를 그대로 재현 |
| `src/config/editions/enterprise.ts` | 엔터프라이즈 레코드 — 브랜드는 고객 승인 전까지 비어 있다(추측 금지) |
| `src/config/editionMeta.ts` | 제목·lock-up·manifest·HTML 토큰 치환·빈 태그 제거 |
| `src/config/storageNamespace.ts` | 영속 키 전체 목록과 namespace 적용(`namespacedKey`) |
| `src/config/basePath.ts` | `BASE_PATH`·`VITE_BASE_PATH`·`BASE_PATH` 환경변수 우선순위 |
| `src/config/buildYear.ts` | `SOURCE_DATE_EPOCH`에서 About 연도 고정 |
| `tools/product_plugin.ts` | 빌드 시 HTML 토큰 치환, `dist/manifest.json`·`dist/product.json` 생성 |

## 2. 빌드 선택과 산출물

```bash
npm run build                                # 공개판 (VITE_EDITION 미설정)
VITE_EDITION=enterprise VITE_BASE_PATH=/ npm run build   # 엔터프라이즈판
```

- `VITE_EDITION=enterprise`가 아니면 언제나 공개판이다. 기존 GitHub Pages 배포는 아무것도 바뀌지 않는다.
- `index.html`/`portable.html`은 브랜드·주소·키를 **토큰**으로만 갖고 있다(`%PRODUCT_TITLE%`, `%PRODUCT_CANONICAL%`, `%PRODUCT_SETTINGS_KEY%` …). 치환은 [tools/product_plugin.ts](../../tools/product_plugin.ts)의 `transformIndexHtml`이 한다.
- `dist/manifest.json`(PWA)과 `dist/product.json`(portable 패키저용 레코드 사본)은 같은 레코드에서 생성된다.
- 공개 주소(`CANONICAL_URL`)가 없는 에디션은 canonical·OG·Twitter 태그를 **빈 값으로 싣지 않고 제거**한다(`stripEmptyTags`).

## 3. 저장 키 분리

공개판은 기존 이름을 그대로 쓴다(namespace `''`). 엔터프라이즈판은 모든 키 앞에 `sigrun.enterprise.`를 붙인다. 두 에디션이 같은 origin에서 돌아도 서로의 데이터를 읽거나 지우지 않는다.

| 용도 | 공개판 키 | 엔터프라이즈 키 |
| --- | --- | --- |
| IndexedDB 데이터베이스 | `sigrun-workspace` | `sigrun.enterprise.sigrun-workspace` |
| 자동 저장 fallback | `sigrun.autosave.v1` | `sigrun.enterprise.sigrun.autosave.v1` |
| 설정 | `sigrun.settings.v1` | `sigrun.enterprise.sigrun.settings.v1` |
| 패널 크기 | `sigrun.floatSizes.v1` | `sigrun.enterprise.sigrun.floatSizes.v1` |
| 워크스페이스 레이아웃 | `sigrun.workspace.v2` | `sigrun.enterprise.sigrun.workspace.v2` |
| 사용자 차트 스타일 | `sigrun.chartStyles.v1` | `sigrun.enterprise.sigrun.chartStyles.v1` |
| 튜토리얼 진행 | `sigrun.tutorials.progress.v1` | `sigrun.enterprise.sigrun.tutorials.progress.v1` |
| 연습 슬롯(v2/v1) | `sigrun.tutorials.practice.v2` / `.v1` | `sigrun.enterprise.sigrun.tutorials.practice.v2` / `.v1` |
| 원본 프로젝트 가드 | `sigrun.tutorials.original.v1` | `sigrun.enterprise.sigrun.tutorials.original.v1` |

프로젝트 파일(`.sigrun.json`)은 저장소가 아니라 **문서**이므로 에디션과 무관하게 같은 스키마를 읽고 쓴다. 공개판에서 내보낸 파일을 엔터프라이즈판에서 그대로 열 수 있다(§ `ENTERPRISE_MIGRATION_GUIDE.md`).

## 4. 외부 연결 정책

| 레코드 필드 | 공개판 | 엔터프라이즈판 |
| --- | --- | --- |
| `EXTERNAL_LINKS_ENABLED` | `true` (Web-HQ·문서 링크) | `false` (외부 메뉴 링크 렌더링 안 함) |
| `CANONICAL_URL` | `https://hyangdan2.github.io/PKPilot0018/` | 빈 값 → canonical 태그 제거 |
| `OG_IMAGE` | 공개 OG 이미지 | 빈 값 → OG/Twitter 이미지 태그 제거 |
| `SUMMARY`/`DESCRIPTION` | 공개판 문구 | 오프라인 제품 문구 |
| `BASE_PATH` | `/PKPilot0018/` | `/` (고객 서버 루트) |
| `EXPORT_FILE_PREFIX` | `sigrun` | `sigrun-enterprise` |

## 5. 보안·오프라인 검증 (WO-05)

실제 Chromium에서 요청을 감시하며 세 빌드를 확인했다(`npm run qa:network`, 로그 `docs/evidence/wo05-network-audit.log`). **13/13 PASS**:

- **웹(공개판)** — 페이지가 만드는 요청 5건 모두 자기 origin. 외부 링크는 사용자가 눌러야 이동하는 anchor뿐이며, 페이지가 스스로 fetch하지 않는다(성능 타임라인과 교차 확인).
- **Portable** — `file://`로 열고 HTTP(S) 요청 **0건**. 실패한 하위 리소스의 네트워크 재시도도 없다. 쓰는 저장 키는 자기 것뿐.
- **엔터프라이즈** — 외부 메뉴 링크 부재, 자기 서버 밖 요청 0건, 설정이 `sigrun.enterprise.*`에만 저장, manifest 이름이 "Sigrún Enterprise — Statistical Workspace".

검증 도구는 [tools/qa_network_audit.cjs](../../tools/qa_network_audit.cjs)이며, 엔터프라이즈 빌드는 `VITE_EDITION=enterprise VITE_BASE_PATH=/`로 그 자리에서 빌드해 연다.

## 6. 릴리스 게이트

`npm run release:check`는 `VITE_EDITION=enterprise`일 때 다음을 **차단 사유**로 보고한다.

- `BRAND_NAME` 비어 있음 — 고객이 승인한 회사명 없이 브랜드를 지어내지 않는다.
- `COPYRIGHT` 비어 있음.
- `STORAGE_NAMESPACE` 비어 있음 — 공개판 데이터와 섞이면 안 된다.

따라서 현재 저장소 상태로는 엔터프라이즈 **릴리스 산출물이 만들어지지 않는 것이 정상**이며, 브랜드 값이 승인되면 [src/config/editions/enterprise.ts](../../src/config/editions/enterprise.ts)의 두 필드만 채우면 된다.

## 7. 알려진 제약

- 릴리스 산출물 파일명은 `Sigrun-<release>-*`로 고정돼 있다(`tools/release.mjs`의 `nameFor`). 엔터프라이즈 파생 저장소에서 이름 규칙을 바꾸려면 이 함수만 고치면 된다.
- 정적 서버·TLS·접근 제어는 고객 인프라의 몫이다. 제품은 백엔드·API 키·외부 인증을 요구하지 않는다.
- 통계 엔진과 화면은 공개판과 **동일한 코드**다. 엔터프라이즈판의 통계 검증은 공개판의 QA(단위 1,215, 독립 통계 225/225)로 갈음한다.
- 이 문서는 구조를 설명하며, 후속 저장소 `PKPilot0018E0001`은 만들지 않았다.
