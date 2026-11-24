## 무엇을 했나 (Stage 3E — Release Qualification, WO-10 + 통합 QA + 최종 보고)

Phase 3의 마지막 단계입니다. 기능 추가 없이 **배포 형태(오프라인)** 하나를 더하고, Phase 1~3 전체를 실제로 다시 돌려 수치로 남겼습니다.

### 1. WO-10 Portable Build (`npm run build:portable`)
- `vite.portable.config.ts` — iife + `inlineDynamicImports` + `base: './'` + `assetsInlineLimit: Infinity` + `cssCodeSplit: false` + `modulePreload: false`
- `portable.html` — PWA 매니페스트·canonical·원격 OG 이미지가 없는 엔트리(서버가 없으면 의미가 없는 것들)
- `tools/build_portable.mjs` — 5단계: vite 빌드 → JS/CSS 인라인 → 아이콘 data URL → README → ZIP. **클래식 스크립트는 `</body>` 앞에 넣습니다**(`<head>`에 두면 `#root` 생성 전에 실행되어 React #299로 빈 화면이 됩니다 — 실제로 그렇게 한 번 실패했습니다). `</script>`/`</style>` 리터럴과 원격 자산 참조를 스스로 검사해 어긋나면 빌드를 실패시킵니다.
- 산출물: `dist-portable/sigrun-portable.html` **1 265 202 B**(단일 파일), `sigrun-portable.zip` **367 915 B**

### 2. `file://` 오프라인 스모크 테스트 — `tools/e2e_portable_offline.cjs` **63 / 63 PASS**
컨텍스트를 오프라인으로 두고 `http(s)` 요청을 전부 abort한 상태에서 실제 `file://` URL로 확인했습니다. 네트워크 시도 **0건**.
부팅(215 ms) · 샘플 데이터 · 기술통계 · 산점도 · **3D Surface WebGL**(820×374, 컨텍스트 정상) · `?webgl=off` 정적 폴백 · Overlaid Contour · Optimizer(`local-converged`, 63~177 ms) · Profiler · Graph Layout Editor(SVG·300 DPI PNG·레이아웃 저장) · CSV/XLSX Import·Export · `.sigrun.json` 저장 → **새 브라우저에서 복원**. Worker 0개.

### 3. 통합 QA (이 트리에서 실측)
| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm test` | **1 001 / 1 001 PASS** (44 파일) |
| `npm run qa:stats` | **225 / 225 PASS**, FAIL·REVIEW·UNVERIFIED·ERROR 0 |
| `npm run build` | 성공 — `index-I4-C1lpF.js` (라이브 배포본과 바이트 동일) |
| Phase 1/2 회귀 | stage1 77 · stage2 37 · stage3 176 · ui_compact 63 · chart_axes 6 · chart_upgrade 34 · followup(svg 39) |
| Phase 3 회귀 | 3A 29 · 3B 41 · 3B교정 13 · 3C 24 · 3D 49 |
| 합계 | **549 PASS / 0 FAIL** (`tools/run_e2e_suite.cjs`) |
| 라이브 | 3D **49/49**, 3C **24/24** (`BASE=https://… SERVE=0`) |

### 4. 성능 QA — `tools/perf_qa_3e.cjs`
환경(단일 프로세스 headless Chromium · SwiftShader · 1440×1000)과 데이터 크기를 함께 기록합니다.
부팅 **121 ms**(중앙값 3회) · 프로파일러 슬라이더 **1.2 ms 핸들러 / 29.3 ms 페인트** · 최적화 **63 ms**(2반응×2인자) · 20 000행×4열: 가져오기 4.3 s · 기술통계 1.3 s · 산점도 3.3 s(점 20 003) · I-MR 3.5 s · 힙 89 MB · 50 000행도 각 분석별로 통과(산점도 6.7 s, I-MR 6.9 s, 힙 212 MB). 상한 상수(산점도 36쌍, 표면 401², 메시 121, 만족영역 401, 최적화 격자 201, 예산 60 000)를 코드에서 읽어 함께 보고합니다.

**UNVERIFIED로 남긴 것**: 50 000행 산점도 직후 같은 페이지에서 50 000행 I-MR을 돌리면 샌드박스의 단일 프로세스 브라우저가 죽었습니다. 각각 따로는 통과하므로 소프트웨어 렌더러 환경의 누적 메모리로 보지만, 실제 GPU 브라우저에서 확인하지 못했으므로 "연속 실행 가능"을 주장하지 않습니다.

### 5. 문서
- **`docs/PHASE3_UPGRADE_REPORT.md`** (신규) — Phase 3 총괄: 변경 파일 109개, 단계별 산출물, 검증 결과, 성능 벤치마크, 한계·주장하지 않는 것, 산출물 경로, 배포 정보
- **`docs/PORTABLE_BUILD_GUIDE.md`** (신규) — 빌드 원리, `file://`에서 되는 이유, 검증 목록, 배포 절차, 한계, 유지보수 체크리스트
- `docs/CHART_FEATURE_GAP.md` — Stage 3E 스냅샷 추가(감사 표는 그대로: 3E는 차트 옵션을 추가하지 않음) · `tests/gap-doc.test.ts` 6/6 유지
- `docs/OPTIMIZER_METHODOLOGY.md` — **3C 교정(F-3C-01~13) 반영**: 상태 7종, `factorDomain` 정의역 규칙, 단일 예측 엔진(`predictionAdapter`), 외삽 거부, PI 없음 규칙
- `docs/MODEL_STORE_ARCHITECTURE.md` — 후속 진입점(표면·Overlaid·최적화) 활성 상태와 `intervalStatus`/`predictionAdapter` 연결 반영
- `README.md` — 테스트 수·QA 수·새 명령·문서 링크

### 6. 테스트 하네스 (검사 내용 변경 없음)
- `tools/run_e2e_suite.cjs` — 모든 브라우저 스위트를 한 명령으로. 파트별 프로세스 분리(`stage1` 5회, `ui_compact` 4회), 정적 서버를 비동기로 서빙(동기 자식 프로세스가 이벤트 루프를 막아 서버가 응답하지 못하던 문제)
- `e2e_phase3_3b/3b_corrective/3d` — 스위트가 연 정적 서버를 끝에 닫도록 수정(완료된 실행이 "멈춘 것처럼" 보이던 문제). 3B에는 `SECTION` 선택자 추가(기본값 `all`은 기존과 동일)
- `tools/perf_qa_3e.cjs`, `tools/shot_phase3_3e_live.cjs` 신규

### 7. 재현
```bash
export PATH="/workspace/work/node/bin:$PATH"
npx tsc --noEmit && npm test && npm run qa:stats
npm run build && npm run build:portable
node tools/run_e2e_suite.cjs
node tools/e2e_portable_offline.cjs
node tools/perf_qa_3e.cjs
```

### 8. 산출물 위치
- `dist-portable/sigrun-portable.html` · `dist-portable/sigrun-portable.zip` · 사본 `work/pkpilot0018/sigrun-portable.zip`
- QA: `qa/reports/latest.html` · `qa/reports/perf-3e*.json`
- 스크린샷(`work/pkpilot0018/`): `phase3-3e-portable.png`, `phase3-3e-portable-surface.png`, `phase3-3e-portable-contour.png`, `phase3-3e-portable-optimizer.png`, `phase3-3e-portable-profiler.png`, `phase3-3e-portable-layout.png`, `phase3-3e-portable-import.png`, `phase3-3e-portable-restored.png`, `phase3-3e-live.png`, `phase3-3e-live-surface.png`
- E2E 기록: `work/pkpilot0018/phase3-3e-portable-report.json`, `phase3-3e-suite-{a,b,c,d}.json`, `suite-*.log`
