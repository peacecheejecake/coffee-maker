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
scripts/linux-baselines.sh [--check]   # CI(Linux)용 기준 스크린샷 기록/검증 (Docker)
```

기준 스크린샷은 플랫폼별(`*-darwin.png`, `*-linux.png`)이며 CI의 `visual` 잡이 Linux 쪽을 비교합니다.
씬을 바꿨으면 두 플랫폼 모두 갱신하세요.

### 저승사자 모델 (Blender)

`apps/web/public/models/reaper.glb`는 `scripts/blender/reaper.py`가 Blender(4.5)에서 생성합니다 — 모델링·리깅·클립
12종(idle, stamp, gavel, pen, nod, reject, tear, inspect, yawn, page, polish, glance)을 코드로 만들고 meshopt로 압축.

```sh
blender -b -P scripts/blender/reaper.py -- /tmp/reaper.glb
npx @gltf-transform/cli@4 optimize /tmp/reaper.glb apps/web/public/models/reaper.glb \
  --compress meshopt --texture-compress false --simplify false
```

모델을 못 불러오면(오프라인 첫 실행 등) 코드로 만든 저승사자로 대체됩니다.

### 멀티 디바이스 동기화 (Supabase)

환경변수가 없으면 이 기기에만 저장하는 로컬 모드로 동작합니다.

```sh
pnpm supabase:start                   # Docker 필요
pnpm supabase status                  # API_URL / ANON_KEY 확인
cp apps/web/.env.example apps/web/.env.local   # 두 값 채우기
pnpm dev
pnpm test:int                         # 서버 규칙·RLS·Realtime 통합 테스트
pnpm e2e                              # Supabase가 떠 있으면 멀티 디바이스 시나리오도 실행(다른 프로젝트 다음에)
pnpm --filter @coffee/web exec playwright test --project=sync --no-deps   # 멀티 디바이스만
```

### 알림 (선택)

이벤트가 들어오면 DB 트리거(pg_net)가 `notify` Edge Function을 부르고, 함수가 대상자에게 보냅니다 —
웹은 Web Push(VAPID), iOS 앱은 APNs, Android 앱은 FCM HTTP v1.

`npx web-push generate-vapid-keys`로 키를 만들고, 공개키는 `VITE_VAPID_PUBLIC_KEY`에, 나머지는 함수 시크릿에 넣습니다.

```sh
pnpm supabase functions deploy notify
pnpm supabase secrets set NOTIFY_SECRET=<임의 문자열> VAPID_PUBLIC_KEY=<…> VAPID_PRIVATE_KEY=<…> VAPID_SUBJECT=mailto:<관리자 메일>
# iOS 앱: Apple Developer의 APNs 키(.p8)
pnpm supabase secrets set APNS_KEY_ID=<…> APNS_TEAM_ID=<…> APNS_BUNDLE_ID=app.coffeemaker.underworld APNS_PRODUCTION=true \
  APNS_PRIVATE_KEY="$(awk '{printf "%s\\n", $0}' AuthKey_XXXX.p8)"
# Android 앱: Firebase 서비스 계정 JSON의 project_id / client_email / private_key
pnpm supabase secrets set FCM_PROJECT_ID=<…> FCM_CLIENT_EMAIL=<…> FCM_PRIVATE_KEY="<private_key 값 그대로>"
# SQL: insert into public.notify_config (id, url, secret) values (1, 'https://<ref>.functions.supabase.co/notify', '<NOTIFY_SECRET>');
```

Android 앱은 Firebase 콘솔의 `google-services.json`을 `apps/mobile/android/app/`에 두어야 토큰을 받습니다.

로컬 종단 검증(실제 푸시 서비스 대신 TLS 목 서버; 웹 페이로드 복호화, APNs/FCM 서명 검증):

```sh
scripts/push-e2e-setup.sh /tmp/pushtls        # 테스트 키·인증서, supabase/functions/.env.local 생성
pnpm supabase stop && pnpm supabase:start      # .env.local이 있으면 edge runtime + 시크릿 포함
PUSH_E2E=1 PUSH_TLS_DIR=/tmp/pushtls NOTIFY_SECRET=$(grep ^NOTIFY_SECRET= supabase/functions/.env.local | cut -d= -f2) pnpm test:int
```

### 웹 배포 (Supabase + Vercel)

```sh
pnpm supabase login && npx vercel@65.2.0 login
pnpm supabase link --project-ref <ref>    # 대시보드에서 만든 프로젝트
pnpm supabase db push
# 대시보드: Authentication → Anonymous sign-ins 켜기, Site URL/Redirect URLs에 Vercel 주소 추가
# apps/web/.env.production.local 에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (선택: VITE_VAPID_PUBLIC_KEY)
pnpm deploy:web                           # 로컬에서 빌드해 Vercel에 prebuilt 정적 사이트로 배포(--prod)
```

웹 푸시까지 쓰려면 위 "알림"의 함수 배포·시크릿·`notify_config`도 실행합니다.

### 네이티브 앱 (Capacitor)

```sh
pnpm --filter @coffee/mobile sync     # 웹 빌드 + 네이티브 프로젝트 동기화
pnpm --filter @coffee/mobile ios      # Xcode 열기 (iOS, SPM)
pnpm --filter @coffee/mobile android  # Android Studio 열기 (Android SDK 필요)
(cd apps/mobile/android && ./gradlew assembleDebug)  # 명령줄 빌드: JDK 21, ANDROID_HOME
node scripts/render-native-assets.mjs # 앱 아이콘·스플래시 재생성
```

https 링크(Universal Links / App Links)로 앱을 열려면 도메인을 정한 뒤:

```sh
node scripts/configure-app-links.mjs --domain <도메인> --team <Apple Team ID> --android-sha256 <서명 인증서 SHA-256>
```

`.well-known/` 연관 파일(웹 빌드에 포함), iOS Associated Domains, Android 검증 intent filter가 갱신됩니다.

QA 빌드에서 특정 화면으로 바로 열려면 `VITE_NATIVE_START_PATH=/demo`로 웹을 빌드한 뒤 동기화합니다.
딥링크: `coffeemaker://join/<초대코드>`, `coffeemaker://demo`.
