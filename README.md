# ☕💀 저승 커피 채권관리공사

지각하면 벌칙 커피가 3D 업보 탑으로 쌓이는 팀용 one-scene 웹 앱.

- 기획·설계: [docs/DESIGN.md](docs/DESIGN.md)
- 구현 계획: [docs/PLAN.md](docs/PLAN.md)
- 결정 기록: [docs/adr](docs/adr)

## 구조

```
apps/
  web/    Vite + React 셸. 데모 장부, /sandbox(개발 전용), Playwright e2e
packages/
  core/   도메인 — 이벤트, 판정, 장부 projection, 탕감 투표 (의존성 0)
  scene/  3D 씬 (react-three-fiber) — SceneModel만 입력으로 받음
scripts/  폰트 서브셋 생성 등
```

## 개발

Node 18.18+ / pnpm

```sh
pnpm install
pnpm check        # typecheck + lint + 레이어 규칙 + 테스트
pnpm test
pnpm --filter @coffee/core coverage
pnpm dev          # http://localhost:5173  (/sandbox: 씬 스트레스 테스트)
pnpm e2e          # 로컬 Chrome 필요. 기준 스크린샷 갱신: pnpm --filter @coffee/web e2e:update
```
