# Statelia v1.0.0 — 배포 순서 (FIX-05)

작업지시: **WO-BRAND-001 — FINAL CORRECTIVE ORDER · FIX-05**
대상 저장소: `HyangDan2/PKPilot0018` (제품), `HyangDan2/ApplicationHub` (허브)
브랜치: 두 저장소 모두 `feat/statelia-branding` (원격 Push 완료)
작성일: 2026-11-28 (Asia/Seoul)

이 문서는 PO 승인 직후 그대로 실행할 수 있도록 7단계를 순서와 게이트, 명령, 되돌리는 방법까지 적는다.
**순서를 바꾸지 않는다** — 허브를 먼저 배포하면 방문자가 이전 빌드로 가는 카드를 보게 되고,
릴리스가 없는데 다운로드 약속이 먼저 나간다.

---

## 0. 실행 전제 (PO 승인)

| 조건 | 확인 |
| --- | --- |
| 두 저장소 `feat/statelia-branding` 가 원격에 Push되어 있다 | `git ls-remote origin feat/statelia-branding` |
| 이 브랜치의 Lean QA가 통과했다 | `docs/STATELIA_BRANDING_REPORT.md` §8 |
| `main` 병합·Pages 배포·Release 게시에 대한 PO 승인 | 이 문서의 승인 절차 |

승인 전에는 이 문서의 어떤 단계도 실행하지 않는다. 1~7단계는 모두 "되돌리기 어려운" 외부 효과
(운영 사이트 교체, 공개 Release 게시, 허브 카드 노출)를 만든다.

---

## 1단계 — PKPilot0018 `main` 병합

**무엇을**: `feat/statelia-branding` 을 `main` 에 병합한다(PR 또는 fast-forward).
`main` 은 아직 이전 빌드이며, 병합 직후 CI(`Deploy Statelia to GitHub Pages`)가
타입 검사·단위 테스트·통계 QA·portable·네트워크 감사를 다시 돌린다.

```bash
cd worktrees/statelia-PKPilot0018
git fetch origin
git checkout main
git merge --ff-only              # 또는 GitHub에서 PR #<n> 생성 후 병합
git push origin main
```

**게이트**: 병합 커밋의 CI가 초록불. 실패하면 2단계로 가지 않고 `main` 을 병합 전 SHA로 되돌린다
(`git reset --hard <이전 main SHA> && git push --force-with-lease origin main`).

**주의**: GitHub Pages 배포는 `main` 의 `dist/`를 그대로 올리므로, 이 시점에
`https://hyangdan2.github.io/PKPilot0018/` 이 **이미 Statelia 빌드로 바뀐다**.
2단계 게이트를 통과하지 못하면 1단계를 되돌려야 한다(그래서 1~2단계를 한 세션에서 연속 실행한다).

---

## 2단계 — Final Release Gate

**무엇을**: 병합된 `main` 에서 릴리스 산출물을 다시 만들고 검증한다. 새 SHA로 빌드하므로
`build-info.json`·`VERSION.txt`·About 패널의 커밋이 병합 커밋과 일치한다.

```bash
cd worktrees/statelia-PKPilot0018
git checkout main && git pull
export PATH=/workspace/.tools/node-v22.11.0-linux-x64/bin:$PATH
RELEASE_ID=v1.0.0 RELEASE_WRITE_LICENSES=1 node tools/release.mjs check
RELEASE_ID=v1.0.0 node tools/release.mjs build
RELEASE_ID=v1.0.0 node tools/release.mjs verify --repro
```

**게이트 (모두 통과해야 3단계)**:

| 항목 | 기대 |
| --- | --- |
| `release.mjs check` | PASS — 공개 edition `CONTACT_EMAIL` = `hyperdimensionaldesignlab@gmail.com`, 사내 edition `CONTACT_EMAIL` = `''` |
| `release.mjs build` | `release/v1.0.0/` 11개 파일, `Statelia-v1.0.0.html` · `-Portable.zip` · `-Web.zip` |
| `release.mjs verify --repro` | PASS · 11 files · portable HTML 바이트 동일 |
| brand sweep (verify 내장) | 릴리스 텍스트·포터블 페이지에 이전 제품명 0건 |
| `build-info.json` | `artifacts` 3종 이름 = 실제 파일명, `commit` = 병합 커밋 |
| SHA256SUMS | 모든 파일 해시 재계산 일치 |

`release/v1.0.0/` 변경분은 `main` 에 커밋한다(`release: rebuild the v1.0.0 artefacts at the merge commit`).

---

## 3단계 — Statelia v1.0.0 정식 Release 및 Pages 배포

**무엇을**: 2단계 산출물로 GitHub Release를 만들고, `main` 의 Pages 배포가 완료됐는지 확인한다.

```bash
gh release create v1.0.0 \
  release/v1.0.0/Statelia-v1.0.0.html \
  release/v1.0.0/Statelia-v1.0.0-Portable.zip \
  release/v1.0.0/Statelia-v1.0.0-Web.zip \
  release/v1.0.0/SHA256SUMS.txt \
  release/v1.0.0/build-info.json \
  release/v1.0.0/LICENSES.txt \
  release/v1.0.0/README-EN.txt release/v1.0.0/README-KO.txt \
  release/v1.0.0/RELEASE_NOTES.md release/v1.0.0/KNOWN_LIMITATIONS.md \
  release/v1.0.0/VERSION.txt \
  --title "Statelia v1.0.0" \
  --notes-file release/v1.0.0/RELEASE_NOTES.md
```

**게이트**: Release 페이지의 자산 11개가 실제로 내려받히고, `sha256sum -c SHA256SUMS.txt` 가 통과.

---

## 4단계 — Live Smoke Test

**무엇을**: 운영 주소와 Release 자산으로 실제 사용자 경로를 확인한다.

```bash
cd worktrees/statelia-PKPilot0018
node tools/qa_network_audit.cjs                 # 13/13, 자기 origin 밖 요청 0건
PORTABLE=<내려받은 Statelia-v1.0.0.html> node tools/e2e_portable_offline.cjs   # 63/63
node /workspace/qa/brand-fix/shots.cjs <내려받은 Statelia-v1.0.0.html>         # About 10/10
```

**게이트**:

| 항목 | 기대 |
| --- | --- |
| `https://hyangdan2.github.io/PKPilot0018/` | 제목 `Statelia — HD2Lab Statistical Engineering Suite`, 스플래시 표시, About에 `Statelia v1.0.0` |
| About ▸ Official contact | `hyperdimensionaldesignlab@gmail.com` (mailto) |
| About ▸ HD2Lab homepage | `https://hyangdan2.github.io/` |
| 이전 제품명 노출 | 0건 (About·Help·튜토리얼·샘플·내보내기 파일명·오류 메시지) |
| Release에서 받은 portable | `file://` 에서 오프라인 63/63 |
| 기존 프로젝트 | `.sigrun.json` 파일이 그대로 열린다(호환성) |

하나라도 실패하면 3단계 Release를 `gh release delete v1.0.0`로 내리고 1단계로 되돌린다.

---

## 5단계 — ApplicationHub Stable 전환 및 실제 다운로드 링크 반영

**무엇을**: 허브 카탈로그의 `statelia` 항목을 릴리스 사실에 맞춘다 — 이때만 `preview` → `stable` 로
바꾸고, Release 자산으로 향하는 다운로드 링크를 넣는다. **3~4단계가 끝나기 전에는 하지 않는다.**

`data/apps.json` 의 `statelia` 항목:

```json
"releaseState": "stable",
"releaseNote": "v1.0.0 is published — the portable build downloads from the release.",
"releaseUrl": "https://github.com/HyangDan2/PKPilot0018/releases/tag/v1.0.0",
"downloadUrl": "https://github.com/HyangDan2/PKPilot0018/releases/download/v1.0.0/Statelia-v1.0.0-Portable.zip"
```

카드 규칙 유지: 카드 전체가 하나의 링크(`<a>`)이므로, 다운로드·Release 링크는 카드 하단 액션 행에
**중첩 앵커 없이** 두고 카드 본문 링크와 분리한다(기존 E2E가 중첩 링크를 막는다).
이를 위해 `schema/apps.schema.json` 에 선택 필드 `releaseUrl`·`downloadUrl` 을 추가하고
`js/app.js` 가 그 두 값이 있을 때만 액션 행을 그리게 한다(값이 없으면 지금과 똑같은 카드).
`homepageUrl`·`contactEmail`(FIX-02)은 그대로 둔다.

**게이트**: `npm run validate` (스키마) · `npm test` · `npm run build` · `npx playwright test`.

---

## 6단계 — ApplicationHub `main` 병합 및 배포

```bash
cd worktrees/statelia-ApplicationHub
git checkout main && git merge --ff-only feat/statelia-branding && git push origin main
```

**게이트**: `https://hyangdan2.github.io/ApplicationHub/` 의 Statelia 카드가
`Statelia v1.0.0` · `Sigrdrifa Engine v1.0` · `v1.0.0 is published …` · 다운로드 링크를 보여주고,
다른 11개 카드는 모양·순서가 그대로다.

---

## 7단계 — Hub Launch 및 Portable Download 확인

**무엇을**: 허브에서 실제로 눌러 끝까지 간다.

1. 카드의 `OPEN APP` → Statelia가 열리고 About이 `Statelia v1.0.0` 을 표시한다.
2. `Portable` 다운로드 → zip을 풀고 `statelia-portable.html` 을 더블클릭 → 오프라인으로 뜬다.
3. `SHA256SUMS.txt` 와 Release 자산 해시가 일치한다.
4. 6대 허브(Web-HQ·Apps·Play·Tech·Diary·Info) 상단 내비의 `Statelia` 항목이 같은 주소를 가리킨다.

**종료 조건**: 1~7 모두 기록되고, `docs/STATELIA_BRANDING_REPORT.md` §12에 배포 완료일과
라이브 스모크 결과가 추가된다.

---

## 되돌리기 (Rollback)

| 단계 | 되돌리기 |
| --- | --- |
| 1 `main` 병합 | `git reset --hard <병합 전 main SHA> && git push --force-with-lease origin main` → Pages가 이전 빌드로 복귀 |
| 3 Release 게시 | `gh release delete v1.0.0` (태그 유지/삭제 선택) |
| 5·6 허브 | `data/apps.json` 을 `preview` 로 되돌리고 `main` 재배포 |
| 사용자 데이터 | 이 작업은 저장 키·프로젝트 스키마를 바꾸지 않으므로 되돌려도 사용자 프로젝트는 그대로다 |

---

## 이 문서가 하지 않는 일

- `main` 병합, Release 게시, 허브 배포를 **대신 실행하지 않는다** — 각 단계는 PO 승인 뒤에 실행한다.
- 사내 에디션(`SigmaWorks`/Enterprise)의 브랜드·배포 경로를 건드리지 않는다.
- 통계 엔진·분석 결과·프로젝트 스키마를 바꾸지 않는다.
