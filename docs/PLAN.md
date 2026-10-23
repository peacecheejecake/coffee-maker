# 구현 계획 (v0.2)

> `DESIGN.md` v0.2의 마일스톤(M0–M7)을 작업 단위로 구체화한 문서.
> 각 마일스톤: **목표 → 산출물 → 작업 목록 → 핵심 설계 디테일 → 테스트 → 완료 기준 → 리스크**.

## 0. 확정 사항 (DESIGN.md v0.3 "확정된 결정"과 동일)

| 항목 | 결정 | 영향 범위 |
|---|---|---|
| 권한 | 멤버 누구나 기록·정정·탕감 발의 / 규정 변경은 owner | M0 `decide`, M3 RLS |
| 탕감 | **투표로 결정, 만장일치** (채무자 제외 전원 찬성, 반대 1표 즉시 부결, 72h 만료). 오기록은 기록자 본인 10분 내 철회 | M0, M2, M3 RLS, M4 |
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

> ✅ **완료 (2026-10-23)** — 89 tests (시나리오 + fast-check 속성 3종 × 300회), 커버리지 lines 100% / branches 96.5%. ADR [0001](adr/0001-event-sourced-ledger.md).
> 구현 중 결정: 정정 시 표시 컵 = `max(0, 청구 − 상환)` (이미 낸 잔은 재등장하지 않음), 동시 상환 초과분은 `overpaid`로 집계, 잔 수 상한 10.
> 이월: 연속 지각/정시 streak 통계는 정시 출근이 이벤트를 남기지 않아 보류 → M2에서 `ArrivalOnTime` 이벤트 도입 여부 결정.

### 작업 목록
- [x] 모노레포 스캐폴드: `pnpm-workspace.yaml`, `tsconfig.base.json`, Vitest, ESLint, dependency-cruiser, CI
- [x] `ids.ts` — 브랜드 타입(`PlayerId`, `EventId`, `GroupId`), ID 생성은 주입(`DecideContext.newId`)
- [x] `time.ts` — `"HH:mm"`, `"YYYY-MM-DD"` 값 객체와 분 단위 연산 (tz 변환은 app 레이어 책임)
- [x] `ruleset.ts` — `Ruleset` 타입, `DEFAULT_RULESET`, `validateRuleset()`
- [x] `judge.ts` — `judgeLateness()`, `computeCups()`
- [x] `events.ts` — `LedgerEvent` 유니온, 타입 가드, `schemaVersion`, upcaster 레지스트리
- [x] `decide.ts` — 커맨드 검증 → 이벤트 생성 (Decider 패턴)
- [x] `evolve.ts` — 이벤트 1개씩 적용하는 리듀서 + `project(events)`
- [x] `credit.ts` — 등급, 컵 노후 단계 (`cupAge`)
- [x] `selectors.ts` — 랭킹, 통계, 명세서(히스토리) 뷰
- [x] 시나리오 테스트 + 속성 기반 테스트

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
  | { type: 'RetractLate'; targetId }                       // 기록자 본인, 10분 이내
  | { type: 'ProposeWaive'; targetId; reason }
  | { type: 'VoteWaive'; proposalId; vote: 'approve' | 'reject' }
  | { type: 'WithdrawWaive'; proposalId }
  | { type: 'Redeem'; debtorId; payerId; count; recipients; order; stampQuality; evidence? }
  | { type: 'AcknowledgeRedemption'; redemptionId }
  | { type: 'ChangeRuleset'; ruleset }
  | { type: 'AddPlayer' | 'UpdatePlayer' | 'ArchivePlayer'; ... };

decide(cmd, state, ctx: { actorId, now, newId }) => Result<LedgerEvent[], DomainError>
evolve(state, event) => state
```
- `RecordArrival`이 정시면 이벤트 없이 `{ ok: true, events: [], outcome: 'on-time' }` 반환 (UI가 "정시 출근 ✅" 표시)
- `DomainError` 종류: `DuplicateWorkDate`(경고용, 강제 진행 플래그 허용), `TargetNotFound`, `AlreadyWaived`, `NotPermitted`, `InvalidRuleset`, `NothingToRedeem`, `RetractWindowClosed`, `CorrectionToZero`(→ 탕감 발의 유도), `ProposalAlreadyOpen`, `NotAVoter`, `AlreadyVoted`, `ProposalClosed`, `NoEligibleVoters`, `ReasonRequired`
- `ProposeWaive`의 decide는 투표권자 스냅샷(`활성 멤버 − 채무자`), `policy`, `expiresAt = now + ttl`을 계산해 이벤트에 고정. 발의자가 채무자가 아니면 `WaiveVoted(approve)`를 함께 생성
- `CorrectLate`에서 결과 잔 수가 0이 되면 `CorrectionToZero` 에러 (도착 시각 정정으로 정시가 되는 경우 포함)
- 권한 검사(`NotPermitted`)도 decide에서 → 서버 RLS와 이중 방어

**3) Projection 규칙**
- 컵 ID: `${sourceEventId}#${n}` (결정론적 → 모든 기기 동일)
- `LateCorrected`: 대상의 `resultingCups`와 현재 살아있는 컵 수 차이만큼 추가(위에 쌓음)/제거(해당 source 컵 중 위쪽부터)
- `LateRetracted` / 탕감 가결: 해당 source 컵 전부 제거. **이미 상환된 컵은 되돌리지 않음** (상환은 사실이므로) — 대신 `stats.overpaid` 증가
- 탕감 심의: `proposals: Map<proposalId, { targetId, voters, votes, policy, expiresAt, status }>`
  - `WaiveVoted` 적용 시 `tallyWaive()` → `approved`면 그 자리에서 컵 제거, `rejected`면 종료
  - 투표 유효성(투표권자 여부, 중복, 기한 `at > expiresAt`, 종료된 안건)은 evolve에서도 재검사해 **무효 표는 무시** → 동기화로 뒤늦게 온 표에도 안전
  - 같은 대상에 열린 심의가 이미 있으면 뒤의 발의는 무시
  - `expired`는 `now`가 필요하므로 projection이 아니라 selector(`proposalStatus(p, now)`)에서 판정
- `CupsRedeemed`: `order`에 따라 위/아래부터 `count`개 제거, 부족하면 남은 만큼만(클램프) + `overpaid` 기록
- `RulesetChanged`: `rulesetHistory`에 `effectiveFrom`과 함께 push. `rulesetAt(date)`는 이진 탐색
- 정정 시 재계산은 **원래 `workDate`에 유효했던 규정** 사용 (`decide`에서 계산해 `resultingCups`로 저장 → evolve는 계산하지 않음 = 재현성)
- `evolve`는 순수 + 불변. 성능용으로 내부는 구조적 공유(배열 복사 최소화)

**4) Upcaster**
- `upcasters: Record<type, Record<fromVersion, (e) => e>>` — 로드 시 최신 버전으로 체인 변환. 저장된 원본은 손대지 않음

### 테스트
- **판정 테이블 테스트**: 위 경계값 + 구간 경계(15/16분) + override
- **시나리오 테스트** (`given(events).when(cmd).then(events | error)` 헬퍼):
  1. 청구 → 정정(잔 수 증가) → 정정(감소) → 정정으로 0잔 시도 → `CorrectionToZero`
  2. 3잔 누적 → 1잔 상환(LIFO) → 묵은 업보부터 1잔 상환
  3. 대납: payer ≠ debtor
  4. 규정 변경 후 이전 날짜 정정 시 구 규정 적용 (비소급)
  5. 상환 후 원본 탕감 가결 → overpaid
  6. 중복 workDate 경고
  7. 철회: 본인 10분 내 성공 / 11분 후 `RetractWindowClosed` / 타인 `NotPermitted`
  8. 탕감 심의 (4인 그룹: A 채무자, B 발의):
     - B 발의(자동 찬성) → C 찬성 → D 찬성 → **가결, 컵 제거**
     - B 발의 → C 반대 → **즉시 부결**, 이후 D 투표는 `ProposalClosed`
     - A 본인 발의 → 투표권자 B·C·D, A는 `NotAVoter`
     - 발의 후 E 합류 → E는 `NotAVoter`
     - 기한 후 투표 무시, selector가 `expired` 반환
     - 열린 심의 있는 기록에 재발의 → `ProposalAlreadyOpen`, 부결 후 재발의는 허용
     - 철회(Withdraw) 후 투표 → `ProposalClosed`
     - 혼자인 그룹 → `NoEligibleVoters`
- **속성 테스트** (fast-check): 임의 이벤트열에 대해 `컵 수 ≥ 0`, `컵 수 = 청구 - 상환 - 탕감 + 정정Δ (클램프 고려)`, `project(events) == events.reduce(evolve)`, 이벤트 순서가 같으면 결과 동일, **가결된 심의는 투표권자 전원의 approve가 있을 때만 존재**, 한 기록에 동시에 열린 심의 ≤ 1

### 완료 기준
- 위 시나리오·속성 테스트 통과, 커버리지 95%+
- `core`의 `package.json` dependencies 비어 있음

### 리스크
- 정정/탕감/상환이 얽힌 엣지 케이스 → 속성 테스트로 조기 발견. 규칙이 애매하면 ADR로 결정 남김

---

## M1 — 정적 씬

**목표**: 데이터(mock) → 3D 씬 렌더링 파이프라인 확립. 애니메이션 없이 "최종 상태"를 정확히 그린다.

**산출물**: `apps/web` 기본 셸, `packages/scene`, `/sandbox` 개발 페이지

> ✅ **완료 (2026-10-23)** — 단위 테스트 scene 20 / web 4, Playwright 7 (스모크·탭 포커스·시각 회귀 6장, 로컬 Chrome + SwiftShader).
> 계획 대비 변경:
> - **압축 기준 30 → 20잔** (위에 10–19잔 유지). 30잔 기준으론 한 탑 때문에 전체가 점처럼 작아졌음.
> - **전체 뷰 높이 상한**: 화면 폭이 보여줄 수 있는 높이(×1.15)까지만 프레이밍 → 아주 높은 탑은 화면 위로 뚫고 나감(의도된 연출). 포커스 시엔 전체 높이.
> - **draw call 목표 "< 40" → "약 30 + 탑당 2"** (20탑×40잔 = 72). 컵·받침대·링·명판·배지·캐리어 박스·서류 모두 인스턴싱, contact shadow는 탑 실루엣이 바뀔 때만 1회 베이크(575 → 72). 남은 탑당 2는 이름/등급 텍스트 → M6에서 troika `BatchedText`로 묶어 상수화 검토.
> - `LedgerState → SceneModel` 매퍼는 `apps/web/src/model`에 둠 (M2에서 `packages/app`으로 이동). scene → core import 금지 규칙 추가.
> - 폰트: Pretendard에 KS X 1001 서브셋이 없어 `scripts/subset-font.py`로 직접 생성(243KB). 서브셋 밖 글자 fallback은 M6.
> - 번들: `three` 청크 365KB gzip — M6 예산(350KB) 초과, M6에서 drei 의존 축소/지연 로드로 처리.
> - Playwright 기준 스크린샷은 플랫폼별(`-darwin`)이라 **CI에는 아직 미포함**. CI용 linux 기준은 M3에서 e2e를 CI에 올릴 때 생성.

### 작업 목록
- [x] `apps/web`: Vite + React 19, 라우트 `/`(메인), `/sandbox`(개발용, prod 빌드 제외)
- [x] `scene/SceneRoot` — `<Canvas>` 설정 (DPR `[1, 1.5]` 모바일 / `[1, 2]` 데스크톱, `frameloop="demand"`로 정적일 땐 렌더 안 함)
- [x] `scene/layout/towerArc.ts` — 플레이어 수 → 탑 좌표 (순수 함수, 테스트)
- [x] `scene/cups/` — 컵 지오메트리 + `CupStack` (InstancedMesh)
- [x] `scene/tower/` — `Pedestal`, `Nameplate`(한글 텍스트), `GradeBadge`
- [x] `scene/reaper/` — 프리미티브 저승사자 + 책상 + 서류 더미
- [x] `scene/environment/` — 배경 그라데이션, 키/림 라이트, ContactShadows
- [x] `scene/camera/CameraRig` — overview 자동 프레이밍, focus(playerId)
- [x] `scene/viewModel.ts` — `TowerViewModel` 정의 (scene이 받는 유일한 데이터 형태)
- [x] `/sandbox`: leva 패널로 플레이어 수·잔 수 조작 (URL 파라미터로 초기값 지정 가능, e2e에서 사용)

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
- 20잔 초과: 아래쪽 `floor((n-10)/10)×10`잔을 "캐리어 박스(×10)"로 대체 → 보이는 컵은 10–19잔으로 유지

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

> ✅ **완료 (2026-10-23)** — 단위 136개(app 13 · adapters 2 · theme 4 · ui 4 추가), Playwright 13개(시나리오 7 + 씬 6).
> 구현 중 결정/변경:
> - `LedgerState → SceneModel` 매퍼는 **apps/web에 유지** — `app`이 `scene`을 import하면 레이어 규칙 위반. 매핑은 조립 지점(composition root)의 책임으로 정리.
> - `ui`는 `scene`을 모름: `AppShell`이 `renderScene` 슬롯으로 씬을 주입받음.
> - UI의 모든 시간 판정은 스토어 시계(`nowIso`/`wallNow`) 사용 — `new Date()` 금지 (테스트에서 발견한 버그).
> - `PlayerPatch.startTimeOverride: null` = 해제 (undefined는 JSON 동기화에서 사라짐).
> - 메모리 저장소는 `app/memory.ts`(참조 구현), IndexedDB는 `adapters` (id 기준 멱등 append).
> - 접근성용 숨김 탑 목록(포커스 시 표시)을 M6에서 앞당겨 추가 — 키보드/스크린리더 경로이자 e2e 진입점.
> - 시간 입력은 커스텀 휠 대신 네이티브 `<input type="time">` (모바일 OS 피커, 접근성).
> - 정시 출근 이벤트(`ArrivalOnTime`)는 M4로 이월: 다른 기기의 정시 연출과 streak 통계가 필요해지는 시점.

### 작업 목록
- [x] `app/store.ts` — zustand: `{ events, state, pending, sceneModel }`, `dispatch(command)`
- [x] `app/usecases/` — `recordArrival`, `correctLate`, `retractLate`, `proposeWaive`, `voteWaive`, `withdrawWaive`, `changeRuleset`, `managePlayers`, `undo`
- [x] `app/clock.ts` — 그룹 tz 기준 `now → { workDate, hhmm }` (`Intl.DateTimeFormat` 사용, 외부 라이브러리 X)
- [x] `adapters/local-idb` — Dexie 스키마: `events(id, seq?, groupId, at)`, `outbox(id)`, `meta(key)`
- [x] `ui/primitives` — Radix UI 기반 Sheet(모바일 bottom / 데스크톱 side), Stepper, Segmented, Toast (TimeWheel → 네이티브 time input)
- [x] `ui/record/QuickRecordSheet` — 플레이어 선택 → 시각 → 미리보기 → 청구
- [x] `ui/record/AdvancedFields` — 날짜, 기준 시각, 잔 수 override, 메모
- [x] `ui/ledger/LedgerSheet` — 플레이어별 명세서: 기록 리스트, 정정 배지, 변경 이력 diff, 정정/철회/탕감 발의 액션
- [x] `ui/waive/` — 발의 폼(사유 필수), **심의함**(HUD 배지 + 투표 카드: 대상·사유·찬성 현황 ●●○○·남은 시간·[찬성]/[반대] + 반대 시 확인 다이얼로그), 종료된 심의 기록 열람
- [x] 설정의 "탕감 가결 방식" 항목 — 지금은 "만장일치 / 기한 72시간" 표시 + 기한만 조정 가능(24–168h)
- [x] `ui/settings/` — 공사 규정(유예, 잔 수 방식, 구간 편집기, 기준 시각), 플레이어 관리(추가/수정/보관, 개별 기준 시각)
- [x] `theme/underworld/ko.ts` + `theme/plain/ko.ts` — 타입 안전 문구 사전 (`t('record.cta')`)
- [x] Undo 토스트: 기록 직후 5초간 [되돌리기] (= 철회), 이후 10분까진 명세서에서 [철회] 버튼 노출

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
- `undo`는 직전 *내* 이벤트 유형별 보상 커맨드 생성: `LateRecorded → RetractLate`(10분 내), `CupsRedeemed → (M5) RedemptionReverted`, `ProposeWaive → WithdrawWaive` 등. 투표는 undo 불가
- 원격 동기화 이후에도 일관됨 (삭제가 아니라 추가이므로)

**5) 탕감 심의 UX**
- 정정에서 0잔(정시 판정 포함)이 되면 저장 버튼이 **[탕감 심의로 발의]**로 바뀌고 사유 입력으로 이어짐
- 투표 카드에서 반대는 한 표로 즉시 부결되므로 "반대하면 바로 기각됩니다" 확인 다이얼로그
- M2(로컬 단독)에서는 한 기기에서 투표자를 전환하며 테스트 (`/sandbox`의 "현재 사용자" 스위처), 실제 다인 투표는 M3에서 완성

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
- `events` INSERT: 멤버이고 `actor_id = 내 player_id`. 유형별 추가 조건:
  - `RulesetChanged`: owner만
  - `LateRetracted`: 대상 `LateRecorded`의 `actor_id`가 본인이고 `now() - 대상.server_at ≤ 10분`
  - `WaiveVoted`: 본인이 해당 `WaiveProposed.payload.voters`에 포함되고 `now() ≤ expiresAt`, 같은 proposal에 본인 표가 없을 것 (`unique (proposal_id, actor_id)` 부분 인덱스 — `payload->>'proposalId'` 추출 컬럼)
  - 위 조건은 `SECURITY DEFINER` 함수로 정책에서 호출 (서버 시각 기준이므로 클라이언트 시계 조작 무력화)
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
- 탕감·철회된 기록에 대한 정정: evolve에서 no-op, UI 알림
- 같은 기록에 동시 발의: seq가 앞선 발의만 유효
- 오프라인에서 던진 표가 기한 후 도착: RLS가 거부 → outbox에서 제거하고 "기한이 지나 투표가 반영되지 않았습니다" 알림
- 투표·철회의 시간 판정은 projection에서도 `server_at` 기준 (`client_at` 아님)
- 동시에 같은 컵 상환: 클램프 + overpaid

**4) 서버측 검증 수준 (MVP)**
- RLS로 신원·권한만 강제, payload 스키마는 클라이언트 신뢰 (같은 팀 내부용)
- 이후 필요 시 Edge Function에서 zod 검증 → `insert` 권한을 함수에만 부여

### 테스트
- SyncEngine 단위 테스트: 가짜 Remote로 순서 뒤섞기, 중복 전송, 오프라인→온라인, seq 구멍
- RLS 테스트: 다른 그룹 접근 차단, member의 규정 변경 차단, 비투표권자 투표 차단, 중복 투표 차단, 기한 후 투표 차단, 타인 기록 철회·10분 후 철회 차단 (supabase local + pgTAP)
- Playwright 3-컨텍스트: 탕감 발의 → 두 기기 찬성 → 세 기기 모두 컵 제거 확인
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
  - [ ] `ReviewTag` — 심의 중 컵에 "심의 중" 꼬리표(흔들리는 종이) + 보랏빛 림
  - [ ] `BallotPlaque` — 투표자 받침대에 찬성 연꽃 / 반대 해골 명패가 솟아오름
  - [ ] `GavelVerdict` — 가결: 의사봉 탕탕탕 → 대상 컵 금빛 → `Evaporate` / 부결·만료: "기각" 도장 + 꼬리표 낙하
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
  - 저승사자: 리깅 + 클립 `idle_think`(레퍼런스 턱괴기), `idle_page`, `yawn`, `polish_scythe`, `stamp`, `nod`, `tear`, `inspect`, `wave`, `adjust_glasses`, `gavel` / 10–15k tris
  - 의사봉, 찬성 연꽃·반대 해골 명패, 심의 꼬리표
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
