# 구현 계획 (v0.1)

> `DESIGN.md` v0.2의 마일스톤(M0–M7)을 작업 단위로 구체화한 문서.
> 각 마일스톤: **목표 → 산출물 → 작업 목록 → 핵심 설계 디테일 → 테스트 → 완료 기준 → 리스크**.

## 0. 전제 (DESIGN.md §7 미결 사항 — 기본안으로 진행, 바뀌면 이 표만 갱신)

| 항목 | 적용한 기본안 | 영향 범위 |
|---|---|---|
| 권한 | 멤버 누구나 기록·정정 / 규정 변경·탕감은 owner | M0 `decide`, M3 RLS |
| 수령 확인 | 상환 즉시 반영, 확인은 도장 진하게(장식) | M0 projection, M5 |
| 앱 이름 | 표시명 "저승 커피 채권관리공사", 코드명 `coffee-maker` | theme 리소스만 |
| 저승사자 | 자체 캐릭터 (커피 요소 가미), M1–M5는 프리미티브 조합 | M6 에셋 |

## 0.1 공통 규약 (전 마일스톤)

- **레포**: pnpm workspace 모노레포. Node 22 LTS, TypeScript 5.x strict (`noUncheckedIndexedAccess` 포함)
- **레이어 강제**: `dependency-cruiser` 규칙으로 `core`는 외부 import 금지, `scene`/`ui`는 `adapters` import 금지 → CI에서 위반 시 실패
- **CI** (GitHub Actions): `typecheck → lint → test → build`, M3부터 Playwright 추가
- **ADR**: 되돌리기 어려운 결정은 `docs/adr/NNNN-title.md`로 기록 (예: 0001-event-sourcing, 0002-supabase)
- **브랜치/커밋**: 마일스톤별 브랜치 `m0-domain` 등, PR 단위 = 아래 작업 목록의 체크박스 묶음
- **완료 정의(DoD)**: 테스트 통과 + 타입 에러 0 + 해당 기능이 `/sandbox` 또는 실제 화면에서 확인 가능

---

## M0 — 도메인 (core)

**목표**: 프레임워크와 무관한 업보 장부 로직을 완성하고 시나리오 테스트로 고정한다. 이후 모든 레이어가 이 위에 선다.

**산출물**: `packages/core` (의존성 0), 테스트 커버리지 95%+

### 작업 목록
- [ ] 모노레포 스캐폴드: `pnpm-workspace.yaml`, `tsconfig.base.json`, Vitest, ESLint, dependency-cruiser, CI
- [ ] `ids.ts` — 브랜드 타입(`PlayerId`, `EventId`, `GroupId`), ID 생성은 주입(`IdGen` 포트)
- [ ] `time.ts` — `"HH:mm"`, `"YYYY-MM-DD"` 값 객체와 분 단위 연산 (tz 변환은 app 레이어 책임)
- [ ] `ruleset.ts` — `Ruleset` 타입, `DEFAULT_RULESET`, `validateRuleset()`
- [ ] `judge.ts` — `judgeLateness()`, `computeCups()`
- [ ] `events.ts` — `LedgerEvent` 유니온, 타입 가드, `schemaVersion`, upcaster 레지스트리
- [ ] `decide.ts` — 커맨드 검증 → 이벤트 생성 (Decider 패턴)
- [ ] `evolve.ts` / `projection.ts` — 이벤트 1개씩 적용하는 리듀서 + `project(events)`
- [ ] `credit.ts`, `aging.ts` — 등급, 컵 노후 단계
- [ ] `selectors.ts` — 랭킹, 통계, 명세서(히스토리) 뷰
- [ ] 시나리오 테스트 + 속성 기반 테스트

### 핵심 설계 디테일

**1) 판정 규칙 (경계값 명확화)**
```
minutesLate = floor((arrived - scheduledStart) / 1분)   // 초 버림
isLate      = minutesLate > graceMinutes
```
| 기준 09:00, 유예 1 | 결과 |
|---|---|
| 08:59 | 정시 (minutesLate 0으로 클램프) |
| 09:01 | 정시 (유예 이내) |
| 09:02 | 지각, **2분** 지각 (유예 끝이 아니라 기준 시각부터 계산) |

- `core`는 같은 `workDate` 내의 `"HH:mm"` 비교만 함 → 시간대·DST 의존성 제거. "지금" → 그룹 tz의 `workDate` + `"HH:mm"` 변환은 app 레이어의 `Clock` 어댑터가 담당
- 구간별 규칙: `tiers`는 `upToMinutes` 오름차순, 마지막은 `null`(무한). validate에서 정렬·중복·빈 배열 검사

**2) Decider 패턴**
```ts
type Command =
  | { type: 'RecordArrival'; playerId; workDate; arrivedAt; scheduledStart?; cupsOverride?; note? }
  | { type: 'CorrectLate'; targetId; changes; reason? }
  | { type: 'WaiveLate'; targetId; reason }
  | { type: 'Redeem'; debtorId; payerId; count; recipients; order; stampQuality; evidence? }
  | { type: 'AcknowledgeRedemption'; redemptionId }
  | { type: 'ChangeRuleset'; ruleset }
  | { type: 'AddPlayer' | 'UpdatePlayer' | 'ArchivePlayer'; ... };

decide(cmd, state, ctx: { actorId, now, newId }) => Result<LedgerEvent[], DomainError>
evolve(state, event) => state
```
- `RecordArrival`이 정시면 이벤트 없이 `{ ok: true, events: [], outcome: 'on-time' }` 반환 (UI가 "정시 출근 ✅" 표시)
- `DomainError` 종류: `DuplicateWorkDate`(경고용, 강제 진행 플래그 허용), `TargetNotFound`, `AlreadyWaived`, `NotPermitted`, `InvalidRuleset`, `NothingToRedeem`
- 권한 검사(`NotPermitted`)도 decide에서 → 서버 RLS와 이중 방어

**3) Projection 규칙**
- 컵 ID: `${sourceEventId}#${n}` (결정론적 → 모든 기기 동일)
- `LateCorrected`: 대상의 `resultingCups`와 현재 살아있는 컵 수 차이만큼 추가(위에 쌓음)/제거(해당 source 컵 중 위쪽부터)
- `LateWaived`: 해당 source 컵 전부 제거. **이미 상환된 컵은 되돌리지 않음** (상환은 사실이므로) — 대신 `stats.overpaid` 증가
- `CupsRedeemed`: `order`에 따라 위/아래부터 `count`개 제거, 부족하면 남은 만큼만(클램프) + `overpaid` 기록
- `RulesetChanged`: `rulesetHistory`에 `effectiveFrom`과 함께 push. `rulesetAt(date)`는 이진 탐색
- 정정 시 재계산은 **원래 `workDate`에 유효했던 규정** 사용 (`decide`에서 계산해 `resultingCups`로 저장 → evolve는 계산하지 않음 = 재현성)
- `evolve`는 순수 + 불변. 성능용으로 내부는 구조적 공유(배열 복사 최소화)

**4) Upcaster**
- `upcasters: Record<type, Record<fromVersion, (e) => e>>` — 로드 시 최신 버전으로 체인 변환. 저장된 원본은 손대지 않음

### 테스트
- **판정 테이블 테스트**: 위 경계값 + 구간 경계(15/16분) + override
- **시나리오 테스트** (`given(events).when(cmd).then(events | error)` 헬퍼):
  1. 청구 → 정정(잔 수 증가) → 정정(감소) → 탕감
  2. 3잔 누적 → 1잔 상환(LIFO) → 묵은 업보부터 1잔 상환
  3. 대납: payer ≠ debtor
  4. 규정 변경 후 이전 날짜 정정 시 구 규정 적용 (비소급)
  5. 상환 후 원본 탕감 → overpaid
  6. 중복 workDate 경고
- **속성 테스트** (fast-check): 임의 이벤트열에 대해 `컵 수 ≥ 0`, `컵 수 = 청구 - 상환 - 탕감 + 정정Δ (클램프 고려)`, `project(events) == events.reduce(evolve)`, 이벤트 순서가 같으면 결과 동일

### 완료 기준
- 위 시나리오·속성 테스트 통과, 커버리지 95%+
- `core`의 `package.json` dependencies 비어 있음

### 리스크
- 정정/탕감/상환이 얽힌 엣지 케이스 → 속성 테스트로 조기 발견. 규칙이 애매하면 ADR로 결정 남김

---

## M1 — 정적 씬

**목표**: 데이터(mock) → 3D 씬 렌더링 파이프라인 확립. 애니메이션 없이 "최종 상태"를 정확히 그린다.

**산출물**: `apps/web` 기본 셸, `packages/scene`, `/sandbox` 개발 페이지

### 작업 목록
- [ ] `apps/web`: Vite + React 19, 라우트 `/`(메인), `/sandbox`(개발용, prod 빌드 제외)
- [ ] `scene/SceneRoot` — `<Canvas>` 설정 (DPR `[1, 1.5]` 모바일 / `[1, 2]` 데스크톱, `frameloop="demand"`로 정적일 땐 렌더 안 함)
- [ ] `scene/layout/towerArc.ts` — 플레이어 수 → 탑 좌표 (순수 함수, 테스트)
- [ ] `scene/cups/` — 컵 지오메트리 + `CupStack` (InstancedMesh)
- [ ] `scene/tower/` — `Pedestal`, `Nameplate`(한글 텍스트), `GradeBadge`
- [ ] `scene/reaper/` — 프리미티브 저승사자 + 책상 + 서류 더미
- [ ] `scene/environment/` — 배경 그라데이션, 키/림 라이트, ContactShadows
- [ ] `scene/camera/CameraRig` — overview 자동 프레이밍, focus(playerId)
- [ ] `scene/viewModel.ts` — `TowerViewModel` 정의 (scene이 받는 유일한 데이터 형태)
- [ ] `/sandbox`: leva 패널로 플레이어 수·잔 수·등급 조작

### 핵심 설계 디테일

**1) 뷰 모델 (scene의 입력 계약)**
```ts
interface SceneModel {
  towers: TowerViewModel[];
  reaper: { mood: 'idle' | 'watching' };
  focus: PlayerId | null;
}
interface TowerViewModel {
  playerId; name; color; emoji?;
  grade: 'AAA' | 'A' | 'B' | 'C' | 'D';
  cups: { id: string; age: 'fresh' | 'cobweb' | 'ghost' | 'rip' }[];  // 아래→위
  receivedCount: number;
  milestones: { caution: boolean; flag: boolean; crown: boolean };
}
```
`app` 레이어의 selector가 `LedgerState → SceneModel` 변환. scene은 도메인 타입을 import하지 않음.

**2) 배치 알고리즘**
- n ≤ 7: 저승사자 책상을 중심으로 반지름 R의 호(전체 각도 `min(140°, n × 22°)`)
- n > 7: 두 줄 호 (뒷줄은 R+Δ, 높이 오프셋, 엇갈림 배치)
- 탑 간 최소 간격 = 컵 지름 × 1.8

**3) 컵 모델 & 스택**
- 프로필 점들로 `LatheGeometry`(세그먼트 20 → 스무스 셰이딩) + 뚜껑 + 슬리브(별도 메쉬, 플레이어 색)
- 파트별 InstancedMesh 3개 (몸통/뚜껑/슬리브) × 전체 공유 → **탑 수와 무관하게 draw call 3**
- 쌓기: 컵 높이 h, 뚜껑 위에 다음 컵이 얹힘 (step = h × 0.92), 각 컵에 결정론적 미세 회전(±4°, ID 해시 기반) → 손으로 쌓은 느낌
- 30잔 초과: 아래쪽 `floor((n-20)/10)×10`잔을 "캐리어 박스(×10)"로 대체 → 보이는 오브젝트 상한 유지

**4) 한글 텍스트**
- drei `<Text>`(troika) + **Pretendard 서브셋 폰트**(KS X 1001 2,350자 + 영숫자, woff ~300KB) → 이름에 없는 글자 대비 fallback으로 전체 폰트 지연 로드

**5) 카메라 프레이밍**
- 모든 탑 + 책상의 바운딩 박스 → FOV와 화면비로 거리 계산, 가장 높은 탑이 화면 상단 15% 여백 안에 들어오도록
- 세로 화면(모바일)에서는 카메라를 더 높고 멀리, 탑 호 각도를 좁힘

### 테스트
- `towerArc`, 스택 위치 계산, 압축 로직 단위 테스트
- `/sandbox` 스크린샷 기반 시각 회귀(Playwright `toHaveScreenshot`, 고정 시드) — 3종: 3명, 8명, 20명×40잔

### 완료 기준
- mock 데이터 변경 → 즉시 올바른 높이/배치
- 20명 × 40잔에서 draw call < 40, 중급 모바일(예: iPhone 12 / Galaxy A54급) 60fps

### 리스크
- troika 한글 폰트 로딩 지연 → 첫 렌더는 폰트 로딩 후로 Suspense 처리, 서브셋으로 용량 관리

---

## M2 — 기록 UX + 로컬 저장

**목표**: 혼자 쓰는 버전으로는 완성. 기록·정정·설정이 모두 실제로 동작하고 새로고침 후에도 유지된다.

**산출물**: `packages/app`, `packages/ui`, `packages/theme`, `adapters/local-idb`

### 작업 목록
- [ ] `app/store.ts` — zustand: `{ events, state, pending, sceneModel }`, `dispatch(command)`
- [ ] `app/usecases/` — `recordArrival`, `correctLate`, `waiveLate`, `changeRuleset`, `managePlayers`, `undo`
- [ ] `app/clock.ts` — 그룹 tz 기준 `now → { workDate, hhmm }` (`Intl.DateTimeFormat` 사용, 외부 라이브러리 X)
- [ ] `adapters/local-idb` — Dexie 스키마: `events(id, seq?, groupId, at)`, `outbox(id)`, `meta(key)`
- [ ] `ui/primitives` — Radix UI 기반 Sheet(모바일 bottom / 데스크톱 side), Stepper, TimeWheel, Toast
- [ ] `ui/record/QuickRecordSheet` — 플레이어 선택 → 시각 → 미리보기 → 청구
- [ ] `ui/record/AdvancedFields` — 날짜, 기준 시각, 잔 수 override, 메모
- [ ] `ui/ledger/LedgerSheet` — 플레이어별 명세서: 기록 리스트, 정정 배지, 변경 이력 diff, 정정/탕감 액션
- [ ] `ui/settings/` — 공사 규정(유예, 잔 수 방식, 구간 편집기, 기준 시각), 플레이어 관리(추가/수정/보관, 개별 기준 시각)
- [ ] `theme/underworld/ko.ts` + `theme/plain/ko.ts` — 타입 안전 문구 사전 (`t('record.cta')`)
- [ ] Undo 토스트: 기록 직후 5초간 [되돌리기]

### 핵심 설계 디테일

**1) 기록 플로우 상태**
```
idle → pickPlayer → pickTime(default=now) → preview(judge 결과 실시간) → submit
                                              │
                                              └─ 정시면 버튼이 "정시 출근 확인"으로 바뀜 (이벤트 없음)
```
- 미리보기는 `core.judgeLateness`를 그대로 호출 → UI와 도메인 판정이 절대 어긋나지 않음
- 중복 날짜면 미리보기 위치에 경고 + [기존 기록 정정하기] / [그래도 추가]

**2) 정정 UX**
- 명세서에서 기록 탭 → 같은 폼을 "정정 모드"로 재사용 (초기값 = 현재 유효값)
- 저장 시 변경된 필드만 `changes`에 담음. 이력 표시: `09:12 → 09:05 · 2잔 → 1잔 · by 민수 · 10/24 10:03`

**3) 설정 화면**
- 잔 수 방식 토글: [고정 N잔] / [구간별]. 구간 편집기는 행 추가/삭제, 자동 정렬, 마지막 행은 "그 이상" 고정
- 저장 전 **"이 규정은 오늘 이후 기록부터 적용됩니다"** 안내
- 변경사항 미리보기: "09:20 도착 시 → 현재 1잔 / 변경 후 2잔"

**4) Undo**
- `undo`는 직전 *내* 이벤트 유형별 보상 커맨드 생성: `LateRecorded → LateWaived(reason:'undo')`, `CupsRedeemed → (M5) RedemptionReverted` 등
- 원격 동기화 이후에도 일관됨 (삭제가 아니라 추가이므로)

### 테스트
- usecase 단위 테스트 (메모리 어댑터)
- 컴포넌트 테스트 (Testing Library): 미리보기 판정, 정정 diff, 구간 편집기 검증
- e2e: 플레이어 추가 → 기록 → 새로고침 → 정정 → 설정 변경 → 이전 기록 불변 확인

### 완료 기준
- 사용자 시나리오가 모두 실제 화면에서 동작, 새로고침 후 유지
- 빠른 기록이 탭 3회 이내 (탑 탭 → 시각 확인 → 청구)

---

## M3 — 멀티 디바이스 동기화

**목표**: 초대 링크로 팀원이 합류하고, 모든 기기가 같은 장부를 실시간으로 본다. 오프라인에서도 기록 가능.

**산출물**: `supabase/migrations`, `adapters/remote-supabase`, `app/sync/SyncEngine`, 온보딩 UI

### 작업 목록
- [ ] Supabase 프로젝트 + 마이그레이션 (테이블, 인덱스, RLS, RPC)
- [ ] 익명 인증 + 세션 영속화
- [ ] RPC `create_group(name, owner_player)`, `join_group(invite_code)` → membership 생성
- [ ] 온보딩: 첫 실행 → [관할 구역 만들기] / [초대 링크로 합류] → 내 플레이어 선택(기존 미연결 플레이어) 또는 새로 만들기
- [ ] 초대 링크 `/join/:code` + 공유 버튼 (Web Share API, 미지원 시 복사)
- [ ] `SyncEngine`: outbox push, pull(since seq), realtime 구독, 재연결 시 gap fill
- [ ] 연결 상태 표시 (HUD 작은 아이콘: 동기화됨 / 전송 대기 n / 오프라인)
- [ ] 다른 사람 기록 수신 시 토스트 "민수가 하나에게 업보를 청구했습니다"

### 핵심 설계 디테일

**1) 스키마**
```sql
create table groups  (id uuid pk, name text, invite_code text unique, created_at timestamptz default now());
create table members (group_id uuid, user_id uuid, player_id text, role text check (role in ('owner','member')),
                      primary key (group_id, user_id));
create table events  (seq bigserial primary key,
                      id text unique not null,              -- ULID, 멱등 키
                      group_id uuid not null, actor_id text not null,
                      type text not null, payload jsonb not null,
                      schema_version int not null,
                      client_at timestamptz not null, server_at timestamptz default now());
create index on events (group_id, seq);
```
**RLS**
- `events` SELECT: 해당 그룹 멤버만
- `events` INSERT: 멤버이고 `actor_id = 내 player_id`. `RulesetChanged`, `LateWaived`는 owner만 (탕감 중 `reason='undo'`이고 자신의 이벤트 대상이면 허용 → RPC로 처리)
- `events` UPDATE/DELETE: 전면 금지

**2) SyncEngine 알고리즘**
```
local write : dispatch → IDB.events(pending) + outbox → store 즉시 반영 → push 시도
push        : outbox 배치(≤50) insert ... on conflict (id) do nothing → 응답 seq로 pending 확정
pull        : 시작/재연결 시 select where seq > lastSeq order by seq
realtime    : events INSERT 구독 → seq 연속성 검사 → 구멍 있으면 pull로 메움
reproject   : 확정 이벤트(seq순) + pending(로컬 생성순) → project()
```
- 원격 이벤트가 내 pending보다 앞 seq로 들어오면 전체 재투영 (이벤트 수천 개 수준에선 수 ms — 필요 시 마지막 확정 지점 스냅샷 캐시)
- 재투영 결과로 생긴 **변화분만** SceneDirector에 전달 (M4) → 이미 본 연출 반복 없음
- 오프라인 판단: `navigator.onLine` + 실패 시 지수 백오프(1s→30s)

**3) 의미 충돌 처리 (core 규칙과 일치)**
- 같은 날 중복 지각: 두 기록 모두 유지 + 명세서에 ⚠ 표시 + 정정 유도
- 탕감된 기록에 대한 정정: evolve에서 no-op, UI 알림
- 동시에 같은 컵 상환: 클램프 + overpaid

**4) 서버측 검증 수준 (MVP)**
- RLS로 신원·권한만 강제, payload 스키마는 클라이언트 신뢰 (같은 팀 내부용)
- 이후 필요 시 Edge Function에서 zod 검증 → `insert` 권한을 함수에만 부여

### 테스트
- SyncEngine 단위 테스트: 가짜 Remote로 순서 뒤섞기, 중복 전송, 오프라인→온라인, seq 구멍
- RLS 테스트: 다른 그룹 접근 차단, member의 규정 변경 차단 (supabase local + pgTAP 또는 SQL 테스트)
- **Playwright 2-컨텍스트**: A 기록 → B에 3초 내 반영 / B 오프라인 기록 → 온라인 복귀 후 A에 반영 / 양쪽 동시 기록 후 동일 상태 수렴

### 완료 기준
- 두 기기에서 동일한 탑 상태로 수렴 (이벤트 순서 무관)
- 오프라인 기록이 유실되지 않음

### 리스크
- 익명 계정은 브라우저 데이터 삭제 시 분실 → 설정에 "계정 연결(Google/Apple)" 진입점을 M3에 미리 마련(구현은 M6)
- Supabase 무료 티어 제한(동시 접속, 비활성 일시정지) → 팀 규모에선 충분, 모니터링만

---

## M4 — 핵심 연출

**목표**: 상태 변화가 저승 컨셉 연출로 보인다. 연출 시스템(Director/Queue/Timeline)이 이후 모든 연출의 기반이 된다.

**산출물**: `app/director`, `app/queue`, `scene/fx`, `/sandbox` 연출 트리거 패널

### 작업 목록
- [ ] Timeline DSL: `seq()`, `par()`, `step(name, params, duration)`, `wait()`
- [ ] `SceneDirector`: `(event, before, after) → Timeline` 매핑 (theme별)
- [ ] `AnimationQueue`: 순차 실행, `skip()`/`flushAll()`, 배치 축약, reduced-motion 분기
- [ ] 씬 상태 이원화: `target`(최종) / `display`(현재 표시) — tower별 `displayCups`
- [ ] 스프링 유틸 (프레임레이트 독립 damped spring, `useFrame`에서 갱신)
- [ ] 연출 구현:
  - [ ] `ReaperStamp` — 프리미티브 저승사자 팔 트윈 + 도장 쾅 (책상 셰이크)
  - [ ] `BillFly` — 책상 → 탑 상공, 베지어 + 종이 흔들림
  - [ ] `Poof` — 연기 파티클 + 청구서 → 컵 스왑
  - [ ] `CupDrop` — 가속 낙하, 착지 squash&stretch
  - [ ] `TowerWobble` — 착지 충격이 아래→위로 전파 (컵 i에 지연 i×30ms 각도 스프링)
  - [ ] `Splash` — 커피 방울 파티클
  - [ ] `Evaporate` — 디졸브 셰이더(노이즈 기반 알파 컷) + 연기
  - [ ] `GradeFlip` — 배지 Y축 회전, 상승 금색/하락 적색 플래시
  - [ ] `Focus`/`Unfocus` — CameraRig 이동
  - [ ] `OnTime` — 받침대 반짝 + 저승사자 펜 내려놓기
- [ ] 사운드 훅 인터페이스만 (`sfx('stamp')`, 실제 음원은 M6)

### 핵심 설계 디테일

**1) 매핑 예시**
```ts
LateRecorded(cups: n) →
  seq(
    step('focus', { p }),
    step('reaperStamp', { label: '청구' }),
    par(...range(n).map(i => seq(wait(i * 150), step('billFly', { p, i }), step('poof'), step('cupDrop', { p, cupId }), step('wobble', { p })))),
    after.grade !== before.grade && step('gradeFlip', { p, from, to }),
    wait(1500), step('unfocus'),
  )
```

**2) Display/Target 동기화**
- store 갱신 시 `target` 즉시 변경. `display`는 Timeline 스텝이 끝날 때 한 칸씩 따라감
- `skip()` = 현재+대기 중 Timeline 취소 → `display = target` 스냅, 파티클 정리
- 연출 중 새 이벤트 도착 → 큐 뒤에 추가. 대기 큐가 **5개 이상**이면 같은 유형끼리 합쳐 "일괄 연출"(동시 낙하) 1개로 축약

**3) 낙하/흔들림 수치(초기값, sandbox에서 튜닝)**
- 낙하 시간 0.45s, easeInQuad + 착지 시 scale (1.15, 0.8, 1.15) → 스프링(stiffness 300, damping 12)으로 복원
- wobble 최대각 = `min(6°, 1.5° + 0.15° × 높이)`, 컵별 지연 30ms

**4) 렌더 루프**
- `frameloop="demand"` 유지, 큐가 활성일 때만 `invalidate()` 연속 호출 → 정적일 때 배터리 절약 (idle 애니메이션은 M6에서 저빈도로 추가)

### 테스트
- Director 매핑 스냅샷 테스트 (이벤트 → Timeline 구조)
- Queue 테스트: skip, 축약, 순서 보장
- `/sandbox`: 모든 연출 개별 트리거 + 속도 슬라이더 + reduced-motion 토글 → 수동 QA 체크리스트

### 완료 기준
- DESIGN §4.1 표의 연출(상환 제외) 동작, 모두 탭으로 스킵 가능
- 원격 이벤트도 동일 연출, 10개 동시 수신 시 축약 연출

---

## M5 — 상환 의식

**목표**: 상환을 앱의 하이라이트로 만든다.

**산출물**: `ui/redeem/*`, `ui/stamp/*`, `scene/fx/ascend` 등, 증빙 업로드, 완납 증명서

### 작업 목록
- [ ] 도메인 보강: `RedemptionReverted`(undo용) 이벤트 추가 (+ M0 테스트 확장)
- [ ] `RedeemFlow` 스텝퍼: ① 창구 입장(카메라 → 책상) ② 내역(잔 수 스테퍼, 수령인 칩 다중 선택 + [전원], 대납자 선택, 묵은 업보부터 토글, 사진) ③ 날인 ④ 결과
- [ ] `StampPad` 인터랙션 + 품질 판정
- [ ] 인영(印影) 생성: Canvas2D로 "完納" 인장 텍스처 생성(노이즈·번짐 파라미터 = 품질) → 명세서 종이 메쉬에 데칼
- [ ] 연출: `Ascend`(컵 발광 → 상승 → 수령인 받침대로 베지어), `CoasterStack`, `FanOut`(전원), `GoldBridge`(대납, TubeGeometry + 흐르는 셰이더), `Inspect`(돋보기)
- [ ] 수령 확인: HUD 수신함 배지 → [잘 받았습니다 ☕] → `RedemptionAcknowledged` → 도장 불투명도 0.4 → 1.0 + 저승사자 끄덕
- [ ] 증빙 사진: 클라이언트 리사이즈(≤1280px, WebP q0.8) → Supabase Storage(그룹별 경로, RLS) → `assetId`
- [ ] 완납 연출: 명세서 찢기 → 꽃잎 파티클 → 연꽃 + 후광
- [ ] 완납 증명서: Canvas2D 카드 렌더 → PNG → Web Share API / 다운로드

### 핵심 설계 디테일

**1) 도장 게이지 & 품질**
```
press 동안 gauge = t / 1.2s (최대 1.3까지 오버필)
release 시:
  gauge < 0.6         → 'faint'    (흐릿)
  0.6 ≤ gauge ≤ 0.85  → 'clean' ✨  (금테)
  gauge > 0.85        → 'smudged'  (번짐)
```
- 게이지에 따라 햅틱 강도 단계적 증가(웹: `navigator.vibrate` 지원 시, 네이티브: M7)
- 여러 잔: [한 잔씩 날인](잔마다 품질 기록) / [일괄 날인](1회) 선택

**2) 상환 연출 Timeline**
```
seq(
  step('focusDesk'), step('reaperAdjustGlasses'),
  (evidence && step('inspect')),
  step('stampSlam', { quality }),
  par(...cups.map((c, i) => seq(wait(i*120), step('ascend', { c, to: recipients[i % r] })))),
  step('coasterLand'),
  gradeChanged && step('gradeFlip'),
  after.cups.length === 0 && step('fullyPaidCeremony'),
  step('unfocus'),
)
```

**3) 수령인 분배 규칙**
- 수령인 r명, 잔 수 n: 순서대로 라운드로빈 분배 (n < r이면 일부만, UI에 표시)
- [전원] = 채무자 본인 제외 활성 플레이어 전체

### 테스트
- 품질 판정 단위 테스트, 분배 규칙 테스트
- e2e: 상환 → 수령인 기기에서 확인 → 양쪽 도장 진해짐
- 증빙 업로드 실패 시 상환은 진행(사진 없이), 재시도 버튼

### 완료 기준
- DESIGN §3 전체 플로우 동작, 한 턱/대납/완납/증명서 포함
- 상환 의식 전체가 스킵 가능하며, 스킵해도 데이터는 동일

---

## M6 — 폴리시 & PWA

**목표**: 정식 아트와 사운드를 입히고, 설치 가능한 앱(PWA)으로 출시 가능한 품질.

### 작업 목록
- [ ] **3D 에셋 (Blender)**
  - 저승사자: 리깅 + 클립 `idle_think`(레퍼런스 턱괴기), `idle_page`, `yawn`, `polish_scythe`, `stamp`, `nod`, `tear`, `inspect`, `wave`, `adjust_glasses` / 10–15k tris
  - 컵(fresh/라벨 변형), 캐리어 박스, 책상, 서류, 연꽃, 왕관, 깃발, 테이프, 쇠사슬
  - 파이프라인: `gltf-transform` (meshopt 압축, 텍스처 리사이즈) → `assets/models/*.glb`, 총 2MB 이하
- [ ] `CharacterModel` 교체: 프리미티브 → glb, 애니메이션 상태머신 (idle 가중치 랜덤 + 이벤트 액션 → idle 복귀)
- [ ] 저승사자 반응: 등급 B 이상 플레이어를 가끔 힐끗, 9시 직전 명부 펼침, 탭 시 대사 말풍선(theme 대사 풀)
- [ ] 묵은 업보 외형: 인스턴스 속성 `aAge` + 셰이더 청크(거미줄 오버레이, 유령 반투명/프레넬) + 원혼 파티클
- [ ] 마일스톤 장식(CAUTION, 깃발, 구름, 왕관), 등급 D 지옥불/사슬
- [ ] 환경: 시간대 조명 프리셋 3종, 반딧불 영혼, idle 저빈도 렌더(15fps로 김/sway)
- [ ] 사운드: WebAudio 래퍼 + 오디오 스프라이트 (stamp, drop, wobble creak, poof, ascend chime, tear, tick) + 음소거 토글
- [ ] PWA: `vite-plugin-pwa` (manifest, 아이콘, 오프라인 캐시: 앱 셸 + glb + 폰트)
- [ ] 웹 푸시: VAPID + Supabase Edge Function(이벤트 INSERT 트리거 → 대상자 푸시). iOS는 홈 화면 설치 시에만 동작 → 설치 유도 배너
- [ ] 계정 연결(Google/Apple) — 익명 계정 승격
- [ ] 일반 모드 테마 완성 (문구 + 연출 매핑 일부 대체)
- [ ] 접근성: 모든 씬 정보의 DOM 대체 표현(스크린리더용 탑 목록), 키보드 조작, 대비

### 성능 예산
| 항목 | 예산 |
|---|---|
| 초기 JS (gzip) | ≤ 350KB (three 포함, 씬은 코드 스플릿) |
| 3D 에셋 합계 | ≤ 2MB |
| 첫 의미 있는 화면 | 4G 기준 3s 이내 (씬 로딩 중엔 2D 스켈레톤 + HUD 먼저) |
| 런타임 | 중급 모바일 60fps, idle 시 GPU 사용 최소 |

### 완료 기준
- Lighthouse PWA/성능/접근성 90+
- 설치 후 오프라인 실행, 푸시 수신(Android Chrome, iOS 설치 PWA)

### 리스크
- 캐릭터 아트 퀄리티가 일정 병목 → M1–M5는 프리미티브로 진행해 병렬화, 외주/에셋 스토어 대안 검토

---

## M7 — 네이티브 앱

**목표**: 같은 웹 번들을 iOS/Android 앱으로 배포하고 네이티브 기능으로 경험 강화.

### 작업 목록
- [ ] Capacitor 셋업 (`apps/mobile`), `apps/web` 빌드 산출물 재사용
- [ ] 네이티브 어댑터: `@capacitor/haptics`(도장·착지), `@capacitor/camera`(증빙), `@capacitor/push-notifications`(FCM/APNs), `@capacitor/share`
- [ ] 딥링크: 초대 링크 Universal Links / App Links (`/join/:code`)
- [ ] Safe area, 상태바 색, 스플래시(저승사자 실루엣)
- [ ] 로컬 알림(선택): 출근 리마인더 08:50 — 끄기 가능
- [ ] 스토어 준비: 아이콘, 스크린샷, 개인정보 처리방침(사진·익명 ID), 심사 노트
- [ ] (선택) Tauri 데스크톱/키오스크 — 사무실 TV 대시보드 모드(조작 UI 숨김, 자동 순환 포커스)

### 완료 기준
- TestFlight / 내부 테스트 트랙 배포, 웹·앱 사용자가 같은 그룹에서 실시간 동기화

---

## 부록 A. 의존 관계 & 병렬화

```
M0 ──► M1 ──► M2 ──► M3 ──► M4 ──► M5 ──► M6 ──► M7
              │             ▲
              └─────────────┘  (M4 Director/Queue는 M2 store만 있으면 착수 가능 → M3와 병렬)
에셋 제작(M6 아트)은 M1 직후부터 병렬 진행 가능
```

## 부록 B. 예상 규모 (1인 기준, 대략)

| 마일스톤 | 규모 |
|---|---|
| M0 | 3–4일 |
| M1 | 4–5일 |
| M2 | 5–7일 |
| M3 | 5–7일 |
| M4 | 6–8일 |
| M5 | 6–8일 |
| M6 | 10–15일 (아트 제외) |
| M7 | 4–6일 |
