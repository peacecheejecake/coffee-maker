# ☕💀 저승 커피 채권관리공사 — 기획 & 설계 문서 (v0.3)

> 지각은 **업보**다. 지각할 때마다 저승 채권관리공사에서 커피 청구서가 날아오고, 미상환 커피는 플레이어마다 3D 탑으로 쌓인다.
> 커피를 사서 **완납 도장**을 받아야 탑이 줄고 **저승 신용등급**이 회복된다.
> 한 화면(one-scene)에서 모든 것이 일어나는, 팀원 각자의 기기에서 실시간으로 함께 보는 지각 벌칙 장부.

### 변경 이력
| 버전 | 내용 |
|---|---|
| v0.1 | 초안: 커피 탑, 이벤트 소싱 구조 |
| v0.2 | 결정 반영(멀티 디바이스, 도착시각 자동계산+수동/수정, 영구 누적, 미드폴리 아트), 규칙 설정 UI, **저승 채권관리공사 컨셉**, 상환 의식(ceremony) 설계 |
| v0.3 | **탕감은 투표(만장일치)로 결정** — 탕감 심의(§2.6), 오기록 철회 분리, 권한·이름·수령 확인·캐릭터 결정 확정 |

### 확정된 결정
| # | 결정 |
|---|---|
| 1 | **각자 기기에서 열람** → 동기화(그룹·실시간)가 MVP 범위 |
| 2 | **도착 시각 입력 → 자동 계산**이 기본. 수동 입력(과거 날짜, 잔 수 직접 지정)과 **기록 수정** 지원 |
| 3 | **영구 누적** (시즌 리셋 없음) |
| 4 | **로우폴리 기반이지만 거칠지 않은 "말랑한 비닐 토이" 톤** (아래 2.5) |
| 5 | 유예 시간·잔 수는 **화면에서 설정**. 기본값: 유예 1분, 지각 시 시간 무관 **1잔** |
| 6 | **탕감은 투표로 결정, 기본 만장일치** (§2.6). 가결 방식은 규정에서 확장 가능 |
| 7 | 권한: 멤버 누구나 기록·정정 (변경 이력 공개). 규정 변경은 owner만. 탕감은 누구나 발의, 투표로 결정 |
| 8 | 수령 확인은 장식(도장 진하게). 상환은 즉시 반영 |
| 9 | 표시명 "저승 커피 채권관리공사", 코드명 `coffee-maker` |
| 10 | 저승사자는 레퍼런스를 참고한 **자체 캐릭터** (커피 요소 가미) |

---

## 1. 세계관 & 컨셉

### 1.1 저승 채권관리공사

- 무대는 **저승 채권관리공사 커피 창구**. 가운데에 귀여운 **저승사자 담당관**이 서류 더미가 쌓인 책상에 앉아 있다.
- 지각 = **업보 발생**. 저승사자가 **업보 청구서**에 "청구" 도장을 찍으면, 청구서가 날아가 커피 컵으로 변해 플레이어의 탑에 떨어진다.
- 플레이어의 탑 = **업보 탑** (미상환 커피 더미).
- 커피를 사면 = **채무 상환**. 상환 창구에서 **완납 도장**을 찍으면 컵이 영혼처럼 승천해 커피를 받은 사람에게 간다.
- 각 플레이어는 **저승 신용등급**을 가진다.

### 1.2 용어 매핑 (UI 문구)

| 도메인 용어 | 화면 문구 |
|---|---|
| Player | 채무자 / 이름 |
| LateRecorded | 업보 청구 |
| Cup | 벌칙 커피 (업보 1잔) |
| Tower | 업보 탑 |
| Redeem | 상환 / 완납 도장 |
| Waive | 업보 탕감 |
| Correction | 정정 신청 |
| Ledger | 업보 명세서 |
| Group | 관할 구역 (팀) |
| Settings | 공사 규정 |

> 컨셉 문구는 i18n 리소스(`ko.json`)에 모아둬서 **일반 모드("지각 기록/커피 사기")로 톤 전환**이 가능하게 한다.

### 1.3 저승 신용등급

미상환 잔 수 기준. 계산은 core의 순수 함수로 두어 나중에 공식(연속 정시 출근 가산점 등)을 바꿀 수 있게 한다.

| 미상환 | 등급 | 칭호 | 연출 |
|---|---|---|---|
| 0 | **AAA** | 극락 VIP | 받침대에 연꽃, 후광 |
| 1–2 | **A** | 성실 납부자 | — |
| 3–5 | **B** | 관찰 대상 | 저승사자가 가끔 힐끗 쳐다봄 |
| 6–9 | **C** | 독촉 대상 | 탑에 빨간 "독촉" 딱지 |
| 10+ | **D** | 지옥행 대기자 | 탑 아래 은은한 지옥불, 쇠사슬 |

### 1.4 묵은 업보 (영구 누적의 재미 요소)

영구 누적이므로, **오래 갚지 않은 컵이 시각적으로 변한다.** 벌칙 수치에는 영향 없음 (순수 연출).

| 경과 | 컵 외형 |
|---|---|
| 7일+ | 거미줄 |
| 30일+ | 반투명 유령 컵, 작은 원혼이 주위를 맴돎 |
| 100일+ | 묘비 모양 라벨 "R.I.P. ☕" |

상환은 LIFO(위부터)가 기본이지만, 상환 창구에서 **"묵은 업보부터 갚기"** 옵션을 주면 맨 아래 유령 컵이 빠지고 위 컵들이 쿵 내려앉는 연출을 쓸 수 있다.

---

## 2. 기획

### 2.1 핵심 루프

```
[도착 시각 입력] ─► 자동 판정(지각?) ─► 청구서 날인 → 컵 낙하 → 업보 탑 ↑ → 신용등급 ↓
        ▲                                                            │
        │                                                            ▼
  [다음 출근] ◄── 신용등급 ↑, 탑 ↓ ◄── 완납 도장 ◄── [상환 창구: 커피 사기]
```

### 2.2 화면 (One Scene)

```
┌──────────────────────────────────────────────────┐
│ 💀 저승 커피 채권관리공사   [관할: 개발팀] [⚙ 규정] │  ← HUD
│                                                  │
│                 ┌──────────┐                     │
│                 │ 💀 담당관 │  ← 중앙 뒤: 저승사자 책상 (서류 더미)
│                 └──────────┘                     │
│        ▓                          ▓              │
│   ▓    ▓    ▓              ▓      ▓              │  ← 호(arc) 배치된 업보 탑들
│   ▓    ▓    ▓     ·        ▓      ▓              │
│  지원   민수  하나   준호   서연   태민            │  ← 받침대 명판 + 등급 배지
│  [B]   [C]   [B]  [AAA]   [A]   [B]              │
│                                                  │
│  [ 📜 업보 청구 ]                 [ 🖋 상환 창구 ] │  ← 액션 바
└──────────────────────────────────────────────────┘
```

| 조작 | 결과 |
|---|---|
| 탑 탭 | 카메라 포커스 + **업보 명세서 시트** (해당 플레이어 기록·수정) |
| 저승사자 탭 | 대사 말풍선 (랜덤 / 상황별) — 이스터에그 |
| 📜 업보 청구 | 기록 시트 (2.3) |
| 🖋 상환 창구 | 상환 의식 (3장) |
| ⚙ 규정 | 공사 규정 설정 (2.4) |

### 2.3 지각 기록 (자동 계산 + 수동 + 수정)

**빠른 기록 (기본)**
1. 플레이어 선택 (탑 탭 또는 목록)
2. 도착 시각 입력 — 기본값 "지금", 휠 피커로 조정
3. 미리보기: `기준 09:00 · 유예 1분 · 7분 지각 → ☕ 1잔` → [청구]
   - 유예 이내면 "정시 출근 ✅"로 표시하고 기록하지 않음 (또는 정시 기록 옵션)

**수동 입력 (고급 펼치기)**
- 날짜 변경 (과거 기록 소급 입력)
- 그날의 기준 출근 시각 변경 (외근·반차 등)
- **잔 수 직접 지정** (자동 계산값 무시, `override` 플래그 저장)
- 메모

**수정 (정정 신청)**
- 업보 명세서 시트에서 기록 선택 → 도착 시각 / 잔 수 / 메모 수정, 또는 **탕감 심의 발의**(§2.6)
- 정정으로는 잔 수를 **0으로 만들 수 없다** (최소 1잔). 0으로 만드는 것은 탕감이므로 투표를 거쳐야 함 → 투표 우회 방지
  - 도착 시각 정정 결과가 "정시"로 판정되면 저장 대신 **"탕감 심의로 발의할까요?"**로 안내
- **오기록 철회**: 기록한 본인이 **10분 이내**라면 투표 없이 철회 가능 (잘못 누른 기록용, 되돌리기 토스트와 동일). 이후엔 탕감 심의로만 취소
- 수정은 원본을 덮어쓰지 않고 **정정 이벤트를 추가** → "정정됨" 배지 + 변경 이력(누가, 언제, 무엇을) 펼쳐보기
- 수정 시 잔 수가 바뀌면 씬에서 컵이 추가 낙하하거나 증발

**중복 방지**: 같은 플레이어·같은 날짜 기록이 이미 있으면 경고 ("이미 업보가 청구된 날입니다. 정정하시겠습니까?")

### 2.4 공사 규정 (설정 화면)

| 항목 | 기본값 | 비고 |
|---|---|---|
| 기준 출근 시각 | 09:00 | 플레이어별 override 가능 |
| 유예 시간 | **1분** | 0–30분 스테퍼 |
| 잔 수 방식 | **고정: 지각 시 1잔** | "고정" / "구간별" 토글 |
| 고정 잔 수 | 1 | 1–5 |
| 구간별 (선택 시) | 예: ~15분 1잔 / ~60분 2잔 / 초과 3잔 | 구간 추가/삭제 UI |
| 상환 수령 확인 | 켜짐 | 3.3 참고 |
| 컨셉 톤 | 저승 모드 | 저승 / 일반 |

- **규정 변경은 소급하지 않는다.** 변경 시점 이후 기록부터 적용. (각 지각 기록은 계산 당시의 잔 수를 그대로 저장)
- 정정으로 도착 시각을 바꿀 땐 **원래 기록 날짜에 유효했던 규정**으로 재계산
- 규정 변경도 이벤트로 남기고, 변경 시 씬 연출: 저승사자가 새 규정집에 도장을 쾅

### 2.5 아트 방향 — "말랑한 비닐 토이" 미드폴리

레퍼런스 이미지(동글한 치비 저승사자, 매끈한 크림색 책상) 톤을 따른다.

- **폴리곤**: 실루엣은 로우폴리로 단순하게, 곡면은 **스무스 셰이딩 + 작은 베벨**로 매끈하게. 각진 플랫 셰이딩 X
  - 컵 ~800–1.5k tris, 저승사자 ~10–15k, 책상·소품 ~2–5k
- **재질**: 텍스처 최소화, **버텍스 컬러/그라데이션 + 낮은 대비의 PBR**(roughness 0.4–0.6, 비닐·세라믹 느낌), AO 베이크
- **조명**: 따뜻한 키 라이트 + 차가운 림 라이트(저승 분위기), 부드러운 그림자(contact shadow), 배경은 어두운 남색~보라 그라데이션 + 떠다니는 반딧불(영혼) 파티클
- **팔레트**: 저승 톤(먹색, 남보라, 도깨비불 청록) + 포인트(커피 브라운, 도장 주홍, 완납 금색)
- **에셋 제작**: 저승사자·책상은 Blender로 제작해 glb(Draco) 사용. MVP는 절차적 지오메트리 + 단순 프리미티브 조합 저승사자로 시작하고, `CharacterModel` 인터페이스 뒤에서 교체

### 2.6 탕감 심의 (투표)

> 컨셉: **저승 탕감 심의위원회**. 업보를 없애 달라는 청원이 올라오면 관할 구역 전원이 심의한다.

**규칙**

| 항목 | 내용 |
|---|---|
| 발의 | 멤버 누구나 (채무자 본인 포함). 대상 지각 기록 1건 + **사유 필수** |
| 투표권자 | 발의 시점의 활성 멤버 중 **채무자 본인 제외** 전원 (이후 합류자는 투표권 없음 → 결과가 흔들리지 않음) |
| 발의자의 표 | 발의자가 채무자가 아니면 자동 찬성 1표 |
| 가결 (기본) | **만장일치**: 투표권자 전원 찬성 시 즉시 가결 |
| 부결 | 반대 1표가 나오는 즉시 부결 (만장일치 불가능해지므로) |
| 기한 | 72시간. 기한 내 미완료 시 **자동 부결(기한 만료)** |
| 철회 | 발의자는 결론 전 철회 가능 |
| 재발의 | 같은 기록은 부결 후 재발의 가능하나 **사유를 새로 작성**해야 함 (도배 방지: 동시 진행 심의는 기록당 1건) |
| 투표 변경 | 불가 (한 번 던진 표는 확정) |
| 투표권자 0명 | (예: 혼자인 그룹) 발의 불가 |

- 결론(가결/부결/만료)은 **별도 이벤트 없이 투표 이벤트들로부터 결정론적으로 계산** → 기기 간 결과 불일치 없음
- 가결 방식은 규정의 `waivePolicy`로 분리 → 이후 `majority`(과반), `quorum`(N명 이상 찬성) 등 추가 가능. 설정 화면엔 우선 "만장일치"만 노출
- 심의 중인 기록의 컵은 **그대로 탑에 남음** (상환 가능). 가결 시 그 시점에 남아 있는 해당 컵 제거, 이미 상환된 잔은 overpaid로 기록

**화면 & 연출**

- 명세서에서 기록 선택 → [탕감 심의 발의] → 사유 입력
- 심의 중인 컵: 은은한 보라빛 + 작은 **"심의 중" 꼬리표**가 컵에 매달림
- HUD에 **심의함 배지** (내가 투표할 안건 수). 투표 카드: 대상자, 날짜, 지각 분, 잔 수, 사유, 현재 찬성 현황(●●○○), 남은 시간 → [탕감 찬성] / [반대]
- 투표 시 각 투표자 받침대 위에 작은 **명패(찬성 연꽃 / 반대 해골)**가 올라옴 → 진행 상황이 씬에서 보임
- **가결**: 저승사자가 의사봉을 "탕! 탕! 탕!" → 대상 컵이 금빛으로 변해 연기처럼 증발 → "탕감" 낙관
- **부결/만료**: 저승사자가 "기각" 붉은 도장, 꼬리표가 떨어져 바닥으로 사라짐
- 알림: 발의됨(투표권자에게), 결론(발의자·채무자에게)

---

## 3. 상환 의식 (Redemption Ceremony)

상환은 **"벌칙이 끝나는 순간"이자 "누군가 커피를 받는 순간"**이다. 그래서 (a) 손맛 있는 인터랙션, (b) 받는 사람과의 소셜 연결, (c) 해방감 있는 보상 연출로 재미를 만든다.

### 3.1 흐름

```
① 상환 창구 입장  ─ 카메라가 저승사자 책상으로 이동, 저승사자가 안경 고쳐 씀
② 상환 내역 작성  ─ 몇 잔 / 누구에게(수령인 다중 선택) / 묵은 업보부터? / (선택) 증빙 사진
③ 완납 도장 날인  ─ 손맛 인터랙션 (3.2)
④ 영혼 승천       ─ 탑의 컵들이 빛나며 떠올라 수령인 받침대로 날아감
⑤ 신용등급 갱신   ─ 등급 카드가 뒤집히며 변경 (B → A), 칭호 팝업
⑥ 수령 확인       ─ 수령인 기기에 알림 → 확인 시 도장이 진해짐 (3.3)
```

### 3.2 완납 도장 인터랙션 (핵심 손맛)

화면 가운데에 업보 명세서가 펼쳐지고, 큼직한 도장이 뜬다.

1. **꾹 누르기** → 도장이 인주에 들어가며 게이지가 참 (햅틱 진동 점점 강하게)
2. **놓기** → 도장이 명세서에 **쾅!** (카메라 셰이크, 먼지 파티클, "完納" 붉은 인영)
3. 게이지를 딱 좋은 구간에서 놓으면 **"깔끔한 날인 ✨"** — 인영이 선명하고 금색 테두리. 너무 짧으면 흐릿, 너무 길면 번짐 (**결과엔 영향 없는 순수 재미**, 인영 품질만 기록에 남아 명세서에서 보임)
4. 여러 잔이면 잔 수만큼 연타하거나 한 번에 "일괄 날인"

### 3.3 소셜 장치

| 장치 | 설명 |
|---|---|
| **수령인 지정** | 커피를 누구에게 줬는지 선택. 컵이 그 사람 받침대로 날아가고, 수령인에게 **"받은 커피" 코스터 더미**가 쌓임 (탑 옆의 작은 기록 — "커피 많이 얻어먹은 사람" 통계도 자연스럽게 생김) |
| **한 턱 쏘기** | "관할 구역 전원" 선택 시 컵이 부채꼴로 모든 받침대에 하나씩 날아감 |
| **수령 확인** | 상환은 즉시 반영되지만 도장이 **반투명(가날인)**. 수령인이 자기 기기에서 [잘 받았습니다 ☕] 누르면 도장이 진해지고 저승사자가 고개를 끄덕 → 장난 상환 방지 + 주고받는 재미 |
| **대납** | 다른 사람이 대신 갚아줄 수 있음. 대납자 탑에서 채무자 탑으로 금빛 다리가 놓이는 연출, 명세서에 "OO의 은혜" 기록 |
| **증빙 사진** | (선택) 영수증·커피 사진 첨부 → 저승사자가 돋보기로 검사하는 연출 후 승인. 명세서에 썸네일 |

### 3.4 완납 (탑 0잔 도달)

- 저승사자가 업보 명세서를 **북북 찢어** 허공에 뿌림 → 종이 조각이 꽃잎으로 변하며 흩날림
- 받침대에 **연꽃**이 피고 후광, 등급 **AAA 극락 VIP**
- **완납 증명서** 카드 생성 (이름, 완납일, 총 상환 잔 수, 깔끔한 날인 횟수) → 이미지로 저장/공유

---

## 4. 애니메이션 & 연출 카탈로그

### 4.1 이벤트 연출

| 이벤트 | 연출 |
|---|---|
| **업보 청구** | 저승사자가 서류를 꺼내 "청구" 도장 쾅 → 청구서가 종이비행기처럼 날아감 → 탑 위에서 *펑* 연기와 함께 컵으로 변신 → 낙하 → 착지 squash & stretch → 충격이 아래→위로 전파되는 흔들림 → 커피 방울 튐 |
| **여러 잔** | 청구서 여러 장이 0.15s 간격으로 "투둑투둑" |
| **정시 출근** | 저승사자가 아쉬운 듯 펜을 내려놓음, 받침대에 반짝 |
| **정정(잔 수 증가/감소)** | 증가: 추가 낙하 / 감소: 해당 컵이 회색→증발 |
| **탕감 발의/투표** | 컵에 "심의 중" 꼬리표, 투표자 받침대에 찬성 연꽃 / 반대 해골 명패 (§2.6) |
| **탕감 가결** | 의사봉 탕탕탕 → 컵이 금빛으로 변해 증발 |
| **탕감 부결/만료** | "기각" 붉은 도장, 꼬리표 낙하 |
| **오기록 철회** | 컵이 반투명해지며 연기처럼 증발, 저승사자가 서류에 X |
| **상환** | 3장의 상환 의식 |
| **등급 변화** | 명판 배지가 카드처럼 플립. 하락 시 빨간 번쩍, 상승 시 금색 반짝 |
| **규정 변경** | 저승사자가 규정집에 도장 쾅, 바뀐 항목이 말풍선으로 |
| **원격 이벤트 수신** | 다른 기기에서 일어난 이벤트도 동일 연출. 여러 개가 몰리면 배치 축약 (4.4) |

### 4.2 Idle / 환경

- 저승사자 idle 루프: 서류 넘기기, 턱 괴고 고민(레퍼런스 포즈), 하품, 가끔 낫을 닦음
- 각 컵 위 은은한 김, 탑은 높을수록 진폭 큰 느린 sway
- 배경의 반딧불 영혼, 9시 직전엔 시계 째깍 + 저승사자가 명부를 펼치고 대기
- 시간대 조명: 아침(따뜻) / 낮 / 저녁(촛불 톤)

### 4.3 높이 마일스톤

| 높이 | 연출 |
|---|---|
| 5 | 탑에 "CAUTION" 테이프 |
| 10 | 흔들림 증가 + 삐걱 사운드, 등급 D 연출 시작 |
| 15 | 꼭대기에 플레이어 이모지 깃발 |
| 20+ | 구름이 탑 중턱을 지남, 카메라 자동 틸트 |
| 20+ | 아래 10잔씩 "업보 캐리어 박스(×10)"로 압축 표시 (위에 10–19잔 유지) |
| 1위 | 꼭대기에 불명예 왕관 👑, 저승사자가 VIP 대우(?)로 손 흔듦 |

### 4.4 모션 원칙

1. **모든 연출은 탭으로 스킵** (즉시 최종 상태로)
2. **상태와 연출 분리** — 데이터는 즉시 확정, 연출은 큐가 따라감
3. `prefers-reduced-motion` → 낙하·셰이크 대신 페이드
4. 탑은 결정론적 배치 — 절대 무너지지 않음 (물리는 일회성 연출에만)
5. 원격 이벤트가 N개 이상 몰리면 개별 연출 대신 요약 연출 ("업보 5건 일괄 청구" — 동시 낙하)

---

## 5. 아키텍처

### 5.1 설계 원칙

- **도메인은 프레임워크를 모른다**: 규칙·장부·등급 계산은 순수 TypeScript
- **경량 이벤트 소싱**: 모든 변경은 append-only 이벤트. 상태는 projection. → 수정 이력, undo, 멀티 디바이스 동기화, 애니메이션 트리거를 하나의 메커니즘으로 해결
- **Ports & Adapters**: 저장소·동기화·시계·알림·햅틱·카메라는 인터페이스, 플랫폼별 구현 주입
- **씬은 뷰 모델과 SceneEvent 스트림만 소비**
- **컨셉(테마)은 데이터**: 문구·캐릭터·연출 매핑을 테마 모듈로 분리해 저승 모드/일반 모드 교체 가능

### 5.2 레이어

```
┌──────────────────────────────────────────────────────────┐
│ apps/web (Vite, PWA)   apps/mobile (Capacitor)  (Tauri)  │ 셸: 어댑터 조립
├──────────────────────────────────────────────────────────┤
│ packages/ui      오버레이 UI (시트, 폼, 도장 인터랙션)     │
│ packages/scene   3D 씬 (R3F), 캐릭터, 파티클, 카메라       │ Presentation
│ packages/theme   컨셉 리소스 (문구, 대사, 연출 매핑)       │
├──────────────────────────────────────────────────────────┤
│ packages/app     유스케이스, 스토어, SyncEngine,          │ Application
│                  SceneDirector, AnimationQueue           │
├──────────────────────────────────────────────────────────┤
│ packages/core    이벤트, 규정, 판정, projection, 등급      │ Domain (의존성 0)
├──────────────────────────────────────────────────────────┤
│ packages/adapters  local-idb, remote-supabase, clock...  │ Infrastructure
└──────────────────────────────────────────────────────────┘
```

### 5.3 도메인 모델 (core)

```ts
type PlayerId = Brand<string, 'PlayerId'>;
type EventId  = Brand<string, 'EventId'>;   // ULID (클라이언트 생성, 시간순)

interface Player {
  id: PlayerId;
  name: string;
  appearance: { color: string; emoji?: string };
  startTimeOverride?: string;              // "10:00"
  archived: boolean;
}

// ── 규정
type CupRule =
  | { mode: 'fixed'; cups: number }                                   // 기본 { fixed, 1 }
  | { mode: 'tiered'; tiers: { upToMinutes: number | null; cups: number }[] };

interface Ruleset {
  defaultStartTime: string;                // "09:00"
  graceMinutes: number;                    // 기본 1
  cupRule: CupRule;
  requireReceipt: boolean;                 // 수령 확인 사용
  waivePolicy: WaivePolicy;                // 기본 { mode: 'unanimous', ttlHours: 72 }
  timezone: string;                        // 그룹 기준 tz (기기 tz와 분리)
}

type WaivePolicy =
  | { mode: 'unanimous'; ttlHours: number }
  // 확장: | { mode: 'majority'; ttlHours } | { mode: 'quorum'; approvals: number; ttlHours }

// ── 이벤트 공통 헤더
interface EventBase {
  id: EventId;
  groupId: GroupId;
  actorId: PlayerId;                       // 누가 기록했나 (감사 추적)
  at: string;                              // 기록 시각 ISO
  schemaVersion: number;
}

type LedgerEvent = EventBase & (
  | { type: 'PlayerJoined'; player: Player }
  | { type: 'PlayerUpdated'; playerId: PlayerId; patch: Partial<Player> }
  | { type: 'RulesetChanged'; ruleset: Ruleset; effectiveFrom: string }
  | { type: 'LateRecorded';
      playerId: PlayerId;
      workDate: string;                    // "2026-10-23" (그룹 tz 기준)
      scheduledStart: string;              // 그날 기준 시각 (수동 변경 가능)
      arrivedAt: string;                   // 도착 시각
      minutesLate: number;                 // 계산값 (저장해서 재현성 보장)
      cups: number;                        // 계산값 또는 override
      cupsOverridden: boolean;
      note?: string }
  | { type: 'LateCorrected';               // 정정: 원본 대신 새 값으로 대체
      targetId: EventId;
      changes: { scheduledStart?: string; arrivedAt?: string; cups?: number; note?: string };
      resultingCups: number;               // 재계산 결과 저장
      reason?: string }
  | { type: 'LateRetracted'; targetId: EventId }      // 오기록 철회: 기록자 본인, 10분 이내
  | { type: 'WaiveProposed';                         // 탕감 심의 발의
      targetId: EventId;                             // 대상 LateRecorded
      reason: string;
      voters: PlayerId[];                            // 발의 시점 투표권자 스냅샷
      policy: WaivePolicy;                           // 발의 시점 가결 방식 고정
      expiresAt: string }
  | { type: 'WaiveVoted'; proposalId: EventId; vote: 'approve' | 'reject' }
  | { type: 'WaiveWithdrawn'; proposalId: EventId }
  | { type: 'CupsRedeemed';
      debtorId: PlayerId;                  // 누구의 업보
      payerId: PlayerId;                   // 실제 산 사람 (대납이면 다름)
      count: number;
      recipients: PlayerId[];              // 수령인 (전원 가능)
      order: 'newest' | 'oldest';          // LIFO / 묵은 업보부터
      stampQuality: 'clean' | 'faint' | 'smudged';
      evidence?: { assetId: string } }
  | { type: 'RedemptionAcknowledged'; redemptionId: EventId; by: PlayerId }
);
```

**순수 함수들**

```ts
judgeLateness(arrivedAt, scheduledStart, ruleset)  => { minutesLate, isLate }
computeCups(minutesLate, ruleset.cupRule)          => number
rulesetAt(events, date)                            => Ruleset   // 정정 시 원래 날짜 규정 조회
project(events)                                    => LedgerState
creditGrade(tower)                                 => { grade, title }
tallyWaive(proposal, votes, policy)                => 'pending' | 'approved' | 'rejected'
                                                      // 기한 만료는 시각이 필요하므로 selector에서 now로 판정
cupAgeStage(cup, now)                              => 'fresh' | 'cobweb' | 'ghost' | 'rip'
```

**Projection**

```ts
interface TowerState {
  playerId: PlayerId;
  cups: { id: string; sourceEventId: EventId; issuedOn: string }[];  // 아래(오래된) → 위
  received: { from: PlayerId; redemptionId: EventId }[];             // 받은 커피 코스터
  stats: { totalLate: number; totalRedeemed: number; cleanStamps: number;
           lateStreak: number; onTimeStreak: number };
}
```

- 컵 ID는 `sourceEventId#n`으로 결정론적 → 모든 기기에서 같은 컵이 같은 ID
- 정정·철회·탕감 가결은 sourceEventId로 대상 컵을 찾아 추가/제거
- 탕감 가결은 마지막 찬성표의 `WaiveVoted`가 적용되는 순간 projection이 판정해 컵 제거 (별도 결론 이벤트 없음)
- `expiresAt` 이후의 투표 이벤트는 무시 (판정 기준 시각 = 서버 `server_at`, 오프라인 투표가 늦게 올라와도 일관)
- **Undo** = 직전 내 이벤트에 대한 보상 이벤트 (삭제 없음). 지각 기록의 undo는 `LateRetracted` (10분 제한)

### 5.4 상태 ↔ 애니메이션 분리

```
 Command ─► UseCase ─► LedgerEvent ─► SyncEngine (로컬 저장 + outbox → 서버)
                            │                      │
       원격 이벤트 수신 ◄────────────────────────────┘
                            │
                            ├─► project() ─► Store (항상 최종 상태)
                            │
                            └─► SceneDirector ─► AnimationQueue ─► Scene
                                (theme 매핑으로 이벤트 → 연출 시퀀스 번역)
```

예: `LateRecorded(cups: 2)` →
`[Focus(p), ReaperStamp('청구'), BillFly(p)×2, CupDrop(p)×2, GradeFlip?(p), Unfocus]`

- 씬의 각 컵은 **target(최종 위치)**과 **display(표시 위치)** 분리 → 스킵 시 snap
- 새 연출 추가 = theme의 매핑 + scene 컴포넌트 추가. core/store 무변경

### 5.5 멀티 디바이스 동기화

**구성**: Supabase (Postgres + Realtime + Storage + Auth)

```
groups(id, name, invite_code, created_at)
members(group_id, player_id, user_id, role)          -- role: owner | member
events(seq bigserial, id ulid unique, group_id, actor_id, type, payload jsonb,
       schema_version, client_at, server_at)          -- append-only, UPDATE/DELETE 금지(RLS)
assets(id, group_id, path)                            -- 증빙 사진
```

- **인증**: 익명 로그인 + **초대 링크/코드**로 관할 구역 가입 → 플레이어 프로필에 연결. 이후 Google/Apple 계정 연결로 기기 이전
- **오프라인 우선**: 로컬 IndexedDB에 이벤트 저장 + outbox. 온라인 시 push, 서버 `seq` 기준으로 정렬된 이벤트 pull/구독
- **정렬**: 확정 순서 = 서버 `seq`. 미전송 로컬 이벤트는 그 뒤에 낙관적으로 적용
- **충돌**: append-only라 대부분 무충돌. 의미 충돌만 규칙으로 처리
  - 같은 날 중복 지각 기록 → 둘 다 남기되 UI 경고 + 정정 유도
  - 이미 탕감·철회된 기록 정정 → 무시(no-op) + 알림
  - 같은 기록에 심의가 동시에 2건 발의 → 서버 seq가 앞선 것만 유효, 뒤의 것은 무효 처리 + 알림
  - 같은 투표자의 중복 투표 → 첫 표만 유효
  - 미상환보다 많은 상환 → 0에서 클램프
- **권한**: 그룹 멤버 누구나 기록·정정·탕감 발의 가능, 모든 변경은 actor와 함께 명세서에 노출 (투명성으로 견제). 규정 변경은 owner만. 투표는 `voters`에 포함된 본인만 (RLS로 강제)
- **`timestamp` 신뢰**: 철회 10분 제한·심의 기한은 클라이언트 시각이 아닌 서버 `server_at`으로 판정
- **알림**: 내 업보 청구됨 / 나에게 커피 상환됨(수령 확인 요청) — 웹 푸시 → 이후 네이티브 푸시

### 5.6 씬 구조 (scene)

```
<Canvas>
  <Environment theme="underworld" timeOfDay />
  <ReaperDesk>                         // 중앙 뒤
    <Reaper animState />               // idle / stamp / nod / tear / inspect
    <PaperStack />
  </ReaperDesk>
  <TowerArc players>                   // 인원수 따라 호/2열 자동 배치
    <Tower>
      <Pedestal name grade emoji />
      <CupStack instanced ageStages /> // InstancedMesh + 인스턴스 속성으로 외형 단계
      <ReceivedCoasters />
      <Decorations milestones />
    </Tower>
  </TowerArc>
  <FlyingLayer />                      // 청구서·승천 컵 등 이동 중 오브젝트
  <ParticlePool />                     // 김, 영혼, 먼지, 꽃잎
  <CameraRig />
</Canvas>
<StampOverlay />                       // 도장 인터랙션은 DOM/2D 오버레이 + 3D 인영 결과
```

- 캐릭터 애니메이션: glb 애니메이션 클립 + `AnimationMixer`, 상태는 작은 상태머신(`idle ↔ action → idle`)
- 성능: 컵 InstancedMesh, 파티클 풀, 30잔+ 압축 표시, DPR 상한(모바일 1.5)

### 5.7 기술 스택

| 영역 | 선택 |
|---|---|
| 언어/빌드 | TypeScript strict, Vite, pnpm workspace |
| UI | React 19 |
| 3D | three.js, @react-three/fiber, drei, @react-spring/three |
| 상태 | zustand |
| 로컬 저장 | IndexedDB (Dexie) |
| 서버 | Supabase (Postgres, Realtime, Auth, Storage) |
| 테스트 | Vitest (core/app), Playwright (e2e, 2-브라우저 동기화 시나리오) |
| 앱 확장 | PWA → Capacitor (iOS/Android: 햅틱, 카메라, 푸시) → Tauri (데스크톱/사무실 TV) |

### 5.8 포트

```ts
interface EventStore   { append(e: LedgerEvent[]): Promise<void>; loadAll(): Promise<LedgerEvent[]> }
interface RemoteSync   { push(e: LedgerEvent[]): Promise<Ack[]>; subscribe(groupId, cb): Unsubscribe }
interface Clock        { now(): Date }
interface Haptics      { impact(level: 'light' | 'medium' | 'heavy'): void }   // 도장 게이지·착지
interface MediaPicker  { capturePhoto(): Promise<Blob | null> }                 // 증빙 사진
interface PushNotifier { register(): Promise<void> }
```

### 5.9 디렉터리

```
coffee-maker/
├─ apps/web/
├─ packages/
│  ├─ core/        events.ts ruleset.ts judge.ts projection.ts credit.ts  __tests__/
│  ├─ app/         usecases/ store.ts sync/ director/ queue/
│  ├─ scene/       reaper/ tower/ cups/ particles/ camera/
│  ├─ ui/          sheets/ settings/ stamp/
│  ├─ theme/       underworld/ plain/
│  └─ adapters/    local-idb/ remote-supabase/ clock/ haptics-web/
├─ supabase/       migrations/ (RLS 포함)
├─ assets/         models/ sounds/
└─ docs/
```

---

## 6. 마일스톤

| 단계 | 범위 | 완료 기준 |
|---|---|---|
| **M0 도메인** | core 전체 + 테스트 | 시나리오: 청구→정정→철회/탕감 투표→부분 상환→대납→완납, 규정 변경 비소급 |
| **M1 정적 씬** | 탑 배치, 프리미티브 저승사자, 카메라, 등급 배지 | 데이터 변경 시 즉시 반영 |
| **M2 기록 UX + 로컬** | 빠른 기록/수동/정정 시트, 규정 설정, IndexedDB | 새로고침 후 유지, 규정 UI로 판정 변경 |
| **M3 동기화** | Supabase, 초대 링크, outbox, 실시간 구독 | 두 브라우저 실시간 반영 (Playwright) |
| **M4 핵심 연출** | 청구 연출, 낙하/흔들림, 철회, 탕감 심의 연출, 등급 플립, AnimationQueue, 스킵 | 4.1 표 (상환 제외) |
| **M5 상환 의식** | 도장 인터랙션, 승천, 수령인/한 턱/대납, 수령 확인, 완납 연출·증명서 | 3장 전체 |
| **M6 폴리시 & PWA** | 정식 3D 에셋, 저승사자 idle, 묵은 업보, 마일스톤, 사운드, 웹 푸시, reduced-motion | Lighthouse PWA |
| **M7 네이티브** | Capacitor 래핑, 햅틱, 카메라, 네이티브 푸시 | iOS/Android 빌드 |
| 후보 | 사무실 TV 대시보드 모드, Slack 봇, 저승사자 대사 확장, 일반 모드 테마 | |

---

## 7. 남은 결정 사항

현재 없음. 결정 내역은 상단 "확정된 결정" 표 참고.
