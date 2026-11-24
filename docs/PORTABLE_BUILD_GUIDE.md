# Sigrún Portable Build 안내 (WO-10)

> **대상**: `HyangDan2/PKPilot0018` (HD2Lab Sigrún) — 브라우저에서만 도는 통계·품질 워크스페이스
> **산출물**: `dist-portable/sigrun-portable.html` (단일 파일) · `dist-portable/sigrun-portable.zip` (같은 파일 + 안내문)
> **명령**: `npm run build:portable`
> **검증**: `tools/e2e_portable_offline.cjs` — 실제 `file://` URL, 네트워크 차단 상태에서 **63 / 63 PASS**

---

## 1. 무엇을 위한 빌드인가

GitHub Pages 빌드(`npm run build`)는 `/PKPilot0018/assets/*.js`를 **ES 모듈**로 내보낸다. 모듈 스크립트는 오리진이 있어야 하므로 `file://`로 열면 브라우저가 CORS로 막는다. 사내망·오프라인 PC·USB로 들고 다니는 배포본은 서버가 없으므로 이 빌드가 필요하다.

| 조건 | Pages 빌드 | Portable 빌드 |
| --- | --- | --- |
| 서버 필요 | GitHub Pages | **없음** (`file://`) |
| Node.js / Python | 빌드 시에만 | **불필요** (산출물은 정적 HTML 1개) |
| 외부 네트워크·CDN | 없음 | **없음** (모든 자산 인라인) |
| 스크립트 형식 | ES 모듈 | **클래식 스크립트(IIFE)** |
| 지원 브라우저 | 최신 Chromium/Firefox/Safari | **Microsoft Edge · Google Chrome** (같은 Chromium 엔진. 실측은 Chromium 1248 headless shell에서 했고 **Edge는 직접 실행해 보지 않았다**) |
| PWA 설치 | 지원 | 미지원 (파일 하나로 배포하는 쪽을 택했다) |

---

## 2. 빌드

```bash
npm ci                        # 의존성 (한 번)
npm run build:portable        # → dist-portable/
```

```
dist-portable/
  sigrun-portable.html        1.21 MB — 애플리케이션 전체 (JS·CSS·아이콘 인라인)
  sigrun-portable.zip         359 kB  — 위 파일 + README.txt
  README.txt                  배포용 안내문
  build-info.json             빌드 시각·크기·SHA-256·Vite/Node 버전
  _raw/                       중간 산출물 (인라인 전, 커밋하지 않음)
```

`dist-portable/`는 `.gitignore`에 있다(빌드 산출물은 저장소에 넣지 않는다). 배포용 사본은 `work/pkpilot0018/sigrun-portable.zip`에도 만들어진다(`PORTABLE_RELEASE_DIR`로 경로 변경 가능).

---

## 3. 어떻게 한 파일이 되는가

### 3.1 `vite.portable.config.ts`

| 설정 | 값 | 이유 |
| --- | --- | --- |
| `base` | `'./'` | 어떤 경로에 두어도 상대 참조가 맞는다 |
| `build.rollupOptions.output.format` | `'iife'` | `import`가 없는 클래식 스크립트 → `file://`에서 실행 가능 |
| `inlineDynamicImports` | `true` | 동적 import를 남기지 않는다(청크 분리 없음) |
| `assetsInlineLimit` | `Infinity` | 모든 자산을 `data:` URL로 |
| `cssCodeSplit` | `false` | CSS를 파일 하나로 |
| `modulePreload` | `false` | 모듈 프리로드 링크를 만들지 않는다 |
| `build.target` | `'es2020'` | 사내 Edge/Chrome 구버전까지 여유 |

### 3.2 `tools/build_portable.mjs` (5단계)

1. 위 설정으로 `vite build` → `dist-portable/_raw/{portable.html,sigrun.js,sigrun.css}`
2. `sigrun.css`를 `<style>`로, `sigrun.js`를 `<script>`로 **인라인**한다.
   - Vite는 엔트리 스크립트를 `<head>`로 올린다. 클래식 스크립트는 `defer`가 없으므로 `<head>`에 두면 `#root`가 생기기 전에 실행되어 `createRoot`가 실패한다(React #299). 그래서 인라인 스크립트는 **`</body>` 바로 앞**에 넣는다.
   - 번들·CSS에 리터럴 `</script>`/`</style>`이 있으면 파일이 깨지므로, 있으면 **빌드를 실패시킨다**(현재 0건).
3. 파비콘을 `data:image/svg+xml;base64,…`로 `<head>`에 넣는다.
4. `README.txt`(사용 안내)를 쓴다.
5. `python3 zipfile`로 ZIP을 만든다(샌드박스에 `zip` 바이너리가 없고, 파이썬 표준 라이브러리만으로 충분하다).

### 3.3 인라인 후 자동 검사

빌드 스크립트가 스스로 확인하고, 하나라도 어긋나면 실패한다.

- `<script type="module">`이 남아 있지 않을 것
- `<link>`·`<script src>`·`<img src>`·CSS `url()` 중 **원격 호스트를 가리키는 것이 없을 것** (사용자가 클릭하는 `<a href="https://…">` 링크는 자산이 아니므로 허용)
- 스타일시트·번들에 `</script>` / `</style>` 리터럴이 없을 것

---

## 4. file://에서 무엇이 동작하는가 (실측)

`tools/e2e_portable_offline.cjs`가 Chromium을 `file:///…/sigrun-portable.html`로 열고, 컨텍스트를 **오프라인**으로 두고 `http(s)` 요청을 전부 abort한 상태에서 아래를 확인했다. **63 / 63 PASS**, 부팅 도중 네트워크 시도 **0건**.

| 영역 | 확인한 것 |
| --- | --- |
| 부팅 | 메뉴바까지 215 ms, DOMContentLoaded 148 ms, Worker 0개, 서비스 워커 불필요 |
| 데이터 | 샘플 데이터 로드(33행), 기술통계(표), 산점도(SVG 51점) |
| 3D | 저장 모형 3D 표면이 **WebGL로 렌더**(820×374, 컨텍스트 정상), `?webgl=off`에서 **정적 투영 SVG**로 폴백 |
| 등고 | 두 모형의 Overlaid Contour(만족 영역 2개) |
| 최적화 | 반응 2 · 인자 2, 상태 `local-converged`, 종합 만족도 0…1, 최적 조건 2개 (풀이 136~177 ms) |
| 프로파일러 | 반응별 1행 · 인자별 슬라이더, 슬라이더 이동 시 예측 갱신, 현재값 수직선 |
| 레이아웃 편집기 | 차트 2개 배치, A4 세로 전환, SVG·300 DPI PNG 내보내기, 레이아웃 JSON 저장 |
| CSV | 12행 CSV 가져오기(미리보기 → 확정), 내보내기 13줄 |
| XLSX | 내보내기(ZIP 컨테이너), 다시 가져오기 → 워크시트 추가 |
| 프로젝트 | `.sigrun.json` 저장(20 kB, 시트 2 · 출력 2), **새 브라우저**에서 열기 → 출력 2개·워크시트 복원 |
| 오류 | 각 세션 page error 0건 |

재현:

```bash
npm run build:portable
node tools/e2e_portable_offline.cjs
```

---

## 5. 배포와 사용

1. `dist-portable/sigrun-portable.zip`을 전달한다.
2. 받는 사람은 압축을 풀고 `sigrun-portable.html`을 더블클릭하거나 Edge/Chrome 창에 끌어다 놓는다.
   (검증은 Chromium 엔진에서 했다. Edge는 같은 엔진이라 동작할 것으로 보지만 **이 저장소에서 직접 확인하지는 않았다** — §6.7)
3. 파일을 옮겨도 그대로 동작한다(절대 경로·설치·레지스트리 없음).

사내 배포 시 권장:

- 파일 이름에 빌드 날짜를 붙여 여러 버전이 섞이지 않게 한다(예: `sigrun-portable-20261124.html`).
- 공유 드라이브에 두고 링크로 배포하면 사용자는 항상 최신 파일을 연다.
- 각 파일에 `build-info.json`의 SHA-256을 함께 적어 두면, 현장에서 "어떤 빌드인지"를 확인할 수 있다.

---

## 6. 알려진 한계

1. **자동 업데이트 없음** — 파일을 새로 받아야 최신이 된다. 페이지 서버가 없으므로 서비스 워커 캐시도 없다.
2. **PWA 미지원** — 매니페스트·설치 프롬프트·오프라인 캐시는 Pages 빌드에만 있다.
3. **오리진이 `file://` 하나** — 브라우저마다 `localStorage`/IndexedDB 정책이 다르다. Chromium 124 기준 둘 다 사용 가능했고, 막는 브라우저에서는 자동 저장만 건너뛰며 **프로젝트 저장/열기는 그대로 동작**한다(`src/lib/db.ts`가 IndexedDB → localStorage 순으로 시도하고 실패를 삼킨다).
4. **파일 하나의 크기** — 1.21 MB(압축 359 kB). 시작할 때 한 번에 파싱하므로 부팅 200 ms 수준이지만, 아주 느린 사내 PC에서는 체감이 다를 수 있다.
5. **WebGL** — 원격 데스크톱·가상 환경에서 WebGL이 막히면 3D 표면은 자동으로 정적 SVG로 폴백한다(값·축·등고는 동일, 회전만 불가). `?webgl=off`로 강제할 수 있다.
6. **인쇄/PDF** — 브라우저 인쇄를 쓰므로 여백·용지 설정은 사용자 환경을 따른다. Figure 내보내기(SVG/PNG 300 DPI)는 파일 저장 경로를 브라우저가 정한다.
7. **브라우저 검증 범위** — 실측은 `chrome-headless-shell 1248` 한 종류다. Chrome·Edge의 일반 창, Firefox, Safari에서의 `file://` 동작은 확인하지 않았다. 클래식 스크립트·인라인 CSS만 쓰므로 원리상 최신 브라우저에서 동작하지만, **"모든 브라우저에서 확인했다"고 주장하지 않는다.**

---

## 7. 유지보수 체크리스트

새 기능을 넣은 뒤 `npm run build:portable`을 돌리고 아래를 확인한다.

- [ ] 빌드가 "portable build complete"로 끝났는가 (자동 검사 3종 통과)
- [ ] `node tools/e2e_portable_offline.cjs`가 63/63인가
- [ ] 새로 추가한 자산이 `src/`에서 `import`로 들어왔는가 (그러면 자동으로 인라인된다)
- [ ] 새 코드가 `fetch`·`new Worker`·동적 `import()`·외부 CDN을 쓰지 않는가 (**금지**)
- [ ] `build-info.json`의 크기가 갑자기 크게 늘지 않았는가 (1 MB 이상 증가는 원인 확인)
