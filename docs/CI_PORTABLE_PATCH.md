# CI 패치안 — Portable Build & 오프라인 스모크 워크플로 (F-11)

> **상태**: **적용 보류** — 푸시가 GitHub App 권한으로 거부되었다(§3).
> **대상 저장소**: `HyangDan2/PKPilot0018` · **요청 id**: F-11(Stage 3E 교정 리뷰)
> **적용자가 할 일**: 아래 두 파일을 그대로 만들고 `main`에 커밋한다. 저장소 Settings → Actions 권한을 가진 사용자나 `workflows` 권한이 있는 토큰이 필요하다.

## 1. 왜 필요한가

Stage 3E까지의 배포 워크플로는 `npm install`로 의존성을 설치했다. lockfile과 다른 버전이 설치될 수 있고, Portable 빌드와 `file://` 오프라인 스모크 테스트는 CI에서 아예 돌지 않았다. 교정 리뷰 F-09~F-11은 (a) 머신 경로 하드코딩 제거, (b) 의존성 명시, (c) CI 연결을 요구한다. (a)·(b)는 이 저장소에 반영되었고(`tools/browser_env.cjs`, `devDependencies.playwright-core`), (c)만 권한 때문에 이 문서로 남긴다.

## 2. 패치 내용

### 2.1 `.github/workflows/deploy.yml` (교체)

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

바뀐 곳: `npm install --no-audit --no-fund` → **`npm ci`**, `cache: npm` 추가. 나머지는 기존과 같다.

### 2.2 `.github/workflows/portable.yml` (신규)

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
      - run: npm run build:portable
        env:
          SOURCE_DATE_EPOCH: ${{ github.event.repository.pushed_at || 0 }}
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

## 3. 거부 증빙

```
$ git push -u origin fix/phase3e-corrective-review
To https://github.com/HyangDan2/PKPilot0018.git
 ! [remote rejected] fix/phase3e-corrective-review -> fix/phase3e-corrective-review
   (refusing to allow a GitHub App to create or update workflow
    `.github/workflows/deploy.yml` without `workflows` permission)
error: failed to push some refs to 'https://github.com/HyangDan2/PKPilot0018.git'
```

`workflows` 권한이 없는 GitHub App 설치로는 `.github/workflows/` 아래 파일을 만들거나 바꿀 수 없다. 그래서 교정 PR에는 워크플로 변경을 넣지 않았고, 그 외 변경은 모두 반영했다.

## 4. 적용 전에 로컬에서 확인한 것

- `npm ci` — 새 체크아웃에서 77 패키지 설치, 그대로 빌드 가능.
- `npm run build` · `npm run build:portable` — 동일 순서로 실행 성공.
- `node tools/e2e_portable_offline.cjs` — `file://`·네트워크 차단에서 **63 / 63 PASS**(샌드박스에서는 `CHROME_LIBS` 지정, CI는 `--with-deps`가 같은 역할).
- `npx playwright-core install` CLI는 `node_modules/.bin/playwright-core`로 제공된다(1.64.1).
