# ☕💀 저승 커피 채권관리공사

지각하면 벌칙 커피가 3D 업보 탑으로 쌓이는 팀용 one-scene 웹 앱.

- 기획·설계: [docs/DESIGN.md](docs/DESIGN.md)
- 구현 계획: [docs/PLAN.md](docs/PLAN.md)
- 결정 기록: [docs/adr](docs/adr)

## 구조

```
apps/
  web/     Vite + React 셸(PWA). 데모 장부(/demo), TV 대시보드(/tv), /sandbox(개발 전용), Playwright e2e
  mobile/  Capacitor iOS/Android 셸 — 웹 빌드를 그대로 감쌈
packages/
  core/      도메인 — 이벤트, 판정, 장부 projection, 탕감 투표 (의존성 0)
  app/       유스케이스 스토어(zustand vanilla), 포트, 시계, ULID
  adapters/  저장소 구현 (IndexedDB, Supabase 원격)
  theme/     화면 문구 (저승 / 일반 말투)
  ui/        오버레이 UI — 시트, 폼, 심의함, 설정 (씬은 슬롯으로 주입)
  scene/     3D 씬 (react-three-fiber) — SceneModel만 입력으로 받음
supabase/  스키마·RLS·RPC 마이그레이션, 로컬 스택 설정
scripts/   폰트 서브셋 생성, 로컬 Supabase 환경 주입 등
```

## 개발

Node 22 (`.nvmrc`, 최소 20.19) / pnpm

```sh
pnpm install
pnpm check        # typecheck + lint + 레이어 규칙 + 테스트
pnpm test
pnpm --filter @coffee/core coverage
pnpm dev          # http://localhost:5173  (/sandbox: 씬 스트레스 테스트)
pnpm e2e          # 로컬 Chrome 필요. 기준 스크린샷 갱신: pnpm --filter @coffee/web e2e:update
```

### 멀티 디바이스 동기화 (Supabase)

환경변수가 없으면 이 기기에만 저장하는 로컬 모드로 동작합니다.

```sh
pnpm supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,mailpit,postgres-meta  # Docker 필요
pnpm supabase status                  # API_URL / ANON_KEY 확인
cp apps/web/.env.example apps/web/.env.local   # 두 값 채우기
pnpm dev
pnpm test:int                         # 서버 규칙·RLS·Realtime 통합 테스트
pnpm e2e                              # Supabase가 떠 있으면 멀티 디바이스 시나리오도 실행
```

### 알림 (선택)

`npx web-push generate-vapid-keys`로 키를 만들고, 공개키는 `VITE_VAPID_PUBLIC_KEY`에, 비공개키는 Edge Function 시크릿에 넣습니다.

```sh
pnpm supabase functions deploy notify
pnpm supabase secrets set NOTIFY_SECRET=<임의 문자열> VAPID_PUBLIC_KEY=<…> VAPID_PRIVATE_KEY=<…> VAPID_SUBJECT=mailto:<관리자 메일>
# SQL: insert into public.notify_config (id, url, secret) values (1, 'https://<ref>.functions.supabase.co/notify', '<NOTIFY_SECRET>');
```

실서비스: Supabase 프로젝트를 만든 뒤 `pnpm supabase link --project-ref <ref>` → `pnpm supabase db push`, 호스팅 환경에 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` 설정. 대시보드에서 Anonymous sign-ins를 켜야 합니다.

### 네이티브 앱 (Capacitor)

```sh
pnpm --filter @coffee/mobile sync     # 웹 빌드 + 네이티브 프로젝트 동기화
pnpm --filter @coffee/mobile ios      # Xcode 열기 (iOS, SPM)
pnpm --filter @coffee/mobile android  # Android Studio 열기 (Android SDK 필요)
node scripts/render-native-assets.mjs # 앱 아이콘·스플래시 재생성
```

QA 빌드에서 특정 화면으로 바로 열려면 `VITE_NATIVE_START_PATH=/demo`로 웹을 빌드한 뒤 동기화합니다.
딥링크: `coffeemaker://join/<초대코드>`, `coffeemaker://demo`.
