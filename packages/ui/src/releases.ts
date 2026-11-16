/**
 * What changed for people using the app, newest first. Shown at the bottom of the account sheet.
 * Add an entry with each user-visible release; infrastructure-only changes stay out.
 */
export interface Release {
  date: string;
  notes: string[];
}

export const RELEASES: Release[] = [
  {
    date: '2026-11-16',
    notes: [
      '이력 메뉴: 출두·청구·심의·탕감·일정 변경 등을 한곳에서 보고, 분류를 여러 개 골라 걸러 봅니다.',
      '채무자 명단: 색 칸 대신 색 점을 눌러 바꾸고, 관전자는 따로 모아 보여 줍니다. 새 채무자는 "채무자 추가"를 눌러 입력합니다.',
      '계정 메뉴(👤)와 공사 규정 메뉴(⚙️)를 나눴습니다.',
      '탑 위 "관전 중" 표시를 반투명 바탕 위에 올려 더 잘 보이게 했습니다.',
      '앱 업데이트 이력을 계정 메뉴 맨 아래에서 볼 수 있습니다.',
      '새 버전이 나오면 열어 둔 화면도 알아서 새 버전으로 바뀝니다. 입력 중이거나 창이 열려 있을 때는 끝날 때까지 기다립니다.',
    ],
  },
  {
    date: '2026-11-13',
    notes: ['관전자의 탑 위에 "관전 중"이 표시됩니다.'],
  },
  {
    date: '2026-11-12',
    notes: [
      '관전자 지정 발의: 참가자를 관전자로 보내거나 다시 참가자로 데려옵니다. 남은 업보를 탕감할지도 함께 정합니다.',
      '출두 구역 지도를 크게 볼 수 있고, 구역이 더 눈에 띄게 칠해집니다.',
      '초대 링크를 복사하면 버튼 안에 확인 표시가 나타납니다.',
    ],
  },
  {
    date: '2026-11-02',
    notes: [
      '출두 구역: 정해 둔 장소 안에서만 출두 체크가 되고, 앱을 열면 자동으로 체크할 수도 있습니다.',
      '로그인은 Google 계정으로 합니다. 초대 링크로 들어오면 먼저 몰래 보기로 시작합니다.',
      '앱에서 Google 로그인이 되지 않던 문제를 고쳤습니다.',
    ],
  },
];
