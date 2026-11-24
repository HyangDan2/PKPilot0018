# CI 패치안 — Portable Build & 오프라인 스모크 워크플로 (F-11 / R-06)

> **상태**: **적용 보류** — 이 저장소를 쓰는 GitHub App 설치에 `workflows` 권한이 없어 `.github/workflows/*` 푸시가 403으로 거부된다(§4). 워크플로 파일 자체는 **로컬에서 최신 트리 기준으로 완전히 실행해 검증**했다(§5).
> **대상 저장소**: `HyangDan2/PKPilot0018` · **기준 트리**: `2695b65` + Phase 3E 교정 Round 2(`fix/phase3e-corrective-r2`)
> **적용자**: 아래 세 파일을 그대로 만들거나 바꾸고 `main`에 커밋한다. GitHub 웹 편집기(본인 계정)로 커밋하면 App 권한과 무관하게 적용된다.

## 1. 왜 필요한가

Stage 3E까지의 배포 워크플로는 `npm install`로 의존성을 설치했다. lockfile과 다른 버전이 설치될 수 있고, Portable 빌드와 `file://` 오프라인 스모크 테스트는 CI에서 아예 돌지 않았다. 교정 리뷰 F-09~F-11은 (a) 머신 경로 하드코딩 제거, (b) 의존성 명시, (c) CI 연결을 요구한다. (a)·(b)는 이 저장소에 반영되었고(`tools/browser_env.cjs`, `devDependencies.playwright-core`), (c)만 권한 때문에 이 문서로 남긴다.

Round 2(R-06)에서 이 문서를 최신 `main` 기준으로 다시 점검했고, 이전 판의 두 가지 잘못을 고쳤다.

| 이전 판 | 문제 | 이번 판 |
| --- | --- | --- |
| `SOURCE_DATE_EPOCH: ${{ github.event.repository.pushed_at \|\| 0 }}` | `pushed_at`은 ISO 문자열(`2026-11-24T03:11:09Z`)이라 `Number()`가 `NaN` → 빌드 시각이 "지금"으로 떨어져 두 번 빌드하면 ZIP 해시가 달라진다(실측 §5.4). `workflow_dispatch`/`pull_request`에서는 값 자체가 없다. | `git log -1 --format=%ct`(커밋 시각, 초)를 `$GITHUB_ENV`에 넣는다. 같은 커밋 → 같은 ZIP 해시(실측 §5.3). |
| `qa-stats.yml` 미언급 | 이 워크플로도 `npm install`을 써서 같은 비결정성이 남는다. | `npm ci`로 바꾸는 한 줄을 함께 적는다. |

## 2. 패치 내용

### 2.1 `.github/workflows/deploy.yml` (교체)

현재 파일과 같고, 바뀌는 곳은 `npm install --no-audit --no-fund` → **`npm ci`** 와 `cache: npm` 추가 두 곳뿐이다.

```yaml
name: Deploy Sigrún to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      # `npm ci` installs exactly the lockfile, so the build here is the build a
      # developer gets from a fresh checkout.
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm test
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

### 2.2 `.github/workflows/qa-stats.yml` (한 줄 수정)

`Install dependencies` 스텝만 바꾼다. 나머지는 그대로 둔다.

```yaml
      - name: Install dependencies
        run: npm ci
```

### 2.3 `.github/workflows/portable.yml` (신규)

```yaml
name: Portable build & offline smoke test

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  portable:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright-core install --with-deps chromium-headless-shell
      - run: npm run build
      # One clock for the ZIP: the commit's own timestamp, in seconds, which is
      # what SOURCE_DATE_EPOCH means. `pushed_at` is an ISO string and silently
      # fell back to "now", so two builds of one commit produced two hashes.
      - name: Portable build (reproducible clock)
        run: |
          echo "SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)" >> "$GITHUB_ENV"
          npm run build:portable
      - run: node tools/e2e_portable_offline.cjs
        env:
          OUT: artifacts/portable
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: sigrun-portable
          path: |
            dist-portable/sigrun-portable.html
            dist-portable/sigrun-portable.zip
            dist-portable/build-info.json
            artifacts/portable/
          if-no-files-found: warn
```

`npx playwright-core install --with-deps chromium-headless-shell`는 이 저장소의 `playwright-core@1.64.1` CLI에서 실제로 지원하는 형태다(`--with-deps`·`chromium-headless-shell` 모두 `install --help`에 있다). `--with-deps`가 샌드박스에서 `CHROME_LIBS`로 넘기던 공유 라이브러리를 대신 설치한다.

## 3. 적용 방법 (정확한 URL)

1. **`portable.yml` 새로 만들기** — GitHub 웹 편집기:
   `https://github.com/HyangDan2/PKPilot0018/new/main/.github/workflows?filename=.github%2Fworkflows%2Fportable.yml`
   위 §2.3 내용을 붙여 넣고 `Commit changes`.
2. **`deploy.yml` 교체**:
   `https://github.com/HyangDan2/PKPilot0018/edit/main/.github/workflows/deploy.yml`
3. **`qa-stats.yml` 한 줄 수정**:
   `https://github.com/HyangDan2/PKPilot0018/edit/main/.github/workflows/qa-stats.yml`
4. **App으로 푸시하고 싶다면** (선택): `https://github.com/settings/installations` → 이 저장소를 쓰는 Pickle 앱 → `Configure` → `Repository permissions`에서 `Workflows`를 `Read and write`로 올린 뒤 다시 푸시한다. 권한을 올리지 않으려면 1~3의 웹 편집기 커밋(본인 계정)으로 충분하다.
5. **실행 확인과 Artifact 내려받기**:
   - 화면: `https://github.com/HyangDan2/PKPilot0018/actions/workflows/portable.yml` → 최근 실행 → 아래쪽 `Artifacts` → `sigrun-portable`
   - CLI:
     ```
     gh run list -R HyangDan2/PKPilot0018 -w portable.yml --limit 3
     gh run watch -R HyangDan2/PKPilot0018 <run-id>
     gh run download -R HyangDan2/PKPilot0018 <run-id> -n sigrun-portable -D /tmp/sigrun-portable
     ```
   - 받은 파일이 진짜인지 확인(로컬 빌드와 같은 커밋이면 같은 해시):
     ```
     python3 -c "import json;print(json.load(open('/tmp/sigrun-portable/dist-portable/build-info.json')))"
     sha256sum /tmp/sigrun-portable/dist-portable/sigrun-portable.html
     unzip -l /tmp/sigrun-portable/dist-portable/sigrun-portable.zip
     ```
     `build-info.json`의 `commit`·`sha256`이 받은 HTML의 해시와 같아야 한다. `artifacts/portable/`에는 `file://` 스모크 테스트가 남긴 스크린샷·CSV·XLSX·레이아웃 파일이 들어 있다(이 저장소 로컬 실행에서 19개).

## 4. 거부 증빙 (Round 1 기록, 이번 라운드에서도 재시도하지 않음)

```
$ git push -u origin fix/phase3e-corrective-review
To https://github.com/HyangDan2/PKPilot0018.git
 ! [remote rejected] fix/phase3e-corrective-review -> fix/phase3e-corrective-review
   (refusing to allow a GitHub App to create or update workflow
    `.github/workflows/deploy.yml` without `workflows` permission)
error: failed to push some refs to 'https://github.com/HyangDan2/PKPilot0018.git'
```

`workflows` 권한이 없는 GitHub App 설치로는 `.github/workflows/` 아래 파일을 만들거나 바꿀 수 없다. 그래서 교정 PR에는 워크플로 변경을 넣지 않았고, 그 외 변경은 모두 반영했다. Round 2에서도 `.github/workflows/` 아래 파일은 **수정하지 않았고 푸시를 시도하지 않았다**(이력만 확인).

## 5. 이번 라운드에서 로컬로 검증한 것

`2695b65` + Round 2 트리에서, 새 체크아웃과 같은 조건(`git archive` → 빈 디렉터리, `node_modules` 없음)으로 §2.3의 스텝을 그대로 실행했다.

| 스텝 | 결과 |
| --- | --- |
| `npm ci --no-audit --no-fund` | 77 패키지 설치, `node_modules/.bin/playwright-core` 존재, vite 6.4.6(lockfile 고정) |
| `npx tsc --noEmit` | 0 errors |
| `npm run build` | 성공 (`dist/assets/index-*.js`) |
| `SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)` + `npm run build:portable` | 성공 — `sigrun-portable.html` **1 248.6 kB**, `sigrun-portable.zip` **363.6 kB** |
| `OUT=artifacts/portable node tools/e2e_portable_offline.cjs` | **63 / 63 PASS** (`file://`, 네트워크 차단) |
| 업로드 경로 존재 확인 | `dist-portable/sigrun-portable.html` 1 271 965 B · `sigrun-portable.zip` 370 499 B · `build-info.json` 605 B · `artifacts/portable/` 19개 파일 |

### 5.1 왜 `git log -1 --format=%ct`인가

`tools/build_manifest.mjs`의 `resolveBuildDate`는 `SOURCE_DATE_EPOCH`를 **초 단위 숫자**로 읽고, 숫자가 아니면 빌드 시각으로 떨어진다.

```
$ SOURCE_DATE_EPOCH=1795522986 npm run build:portable   # git log -1 --format=%ct
   sigrun-portable.zip  363.6 kB  sha256 c0b29e9dbf3b7ccc…  stamp 2026-11-24T12:23:06Z
$ SOURCE_DATE_EPOCH=1795522986 npm run build:portable   # 같은 값으로 다시
   sigrun-portable.zip  363.6 kB  sha256 c0b29e9dbf3b7ccc…  stamp 2026-11-24T12:23:06Z   ← 같은 해시

$ SOURCE_DATE_EPOCH=2026-11-24T12:00:00Z npm run build:portable   # 이전 판의 ISO 문자열
   sigrun-portable.zip  363.6 kB  sha256 db611538275b1848…  stamp 2026-11-24T13:00:44Z
$ SOURCE_DATE_EPOCH=2026-11-24T12:00:00Z npm run build:portable
   sigrun-portable.zip  363.6 kB  sha256 d1a37e42f516a236…  stamp 2026-11-24T13:00:52Z   ← 다른 해시
```

## 6. 적용 후 기대 효과

- `main`에 푸시할 때마다 typecheck · 전체 테스트(1 075건) · 빌드가 `npm ci`로 재현된다.
- PR마다 Portable 단일 파일 빌드와 `file://` 오프라인 스모크(63 체크)가 돌고, 실패하면 ZIP·스크린샷이 Artifact로 남는다.
- 같은 커밋의 Portable ZIP은 **같은 SHA-256**을 갖는다(`SOURCE_DATE_EPOCH` = 커밋 시각).
