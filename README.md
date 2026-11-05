# Relicta Session v0.8.5 · SillyTavern 확장

《렐릭타 온라인》 카드 전용 확장입니다. 매 턴 현재 세션 기록, 장소별 인물 명부, 실제 등장인물 정보, 숨은 제단 대기열을 AI에게 넣어 줍니다. 응답 끝의 숨은 ROAI 기록을 받아 상태창에 표시합니다. 추가 모델 호출은 없습니다.

## 설치

실리태번의 확장 설치 메뉴에 이 저장소 주소를 넣습니다. 그다음 《렐릭타 온라인》 v0.8.5 카드를 가져옵니다. 렐릭타 카드가 아닌 채팅에서는 아무것도 하지 않으며, 채팅 기록에 데이터를 남기지도 않습니다.

## 파일

| 파일 | 역할 |
|---|---|
| `index.js` | 실리태번 연결, 설정 패널, 슬래시 명령 `/relicta` |
| `ai-judgement.mjs` | 요청 주입문 작성, ROAI 검사와 부분 반영, 이름 언급 감지 |
| `router.mjs` | 장소별 명부, 실제 등장인물 정보, 숨은 해금 조건 |
| `altar.mjs` | 숨은 제단 대기열, 행운 보정 6단계, 정사 예외 기록 |
| `session.mjs`, `engine.mjs` | 세션 정규화, 제작자 시험 명령 |
| `status-ui.mjs`, `style.css` | 읽기 전용 상태창 |
| `presentation.mjs`, `st-presentation.mjs` | 꿈터 표시, 대화 사본 정리 |
| `sealed.mjs`, `cast-data.sealed.json` | 봉인된 인물 데이터와 해제 |
| `rules.json`, `catalog.json` | 성장식 초안, 샘플 아이템·스킬 |

인물 데이터는 봉인 파일로 들어 있습니다. 고칠 때는 배포 패키지의 `source/cast-data.json`을 편집하고 `node tools/seal-cast.mjs`로 다시 봉인합니다.

## 제작자 명령

- `/relicta 상태`
- `/relicta 행운 1~6` — 플레이어 본인의 소환·룰렛 행운 보정
- `/relicta 연결 이름` · `/relicta 연결해제 이름` — 현실 신원 연결
- `/relicta 심층 이름` · `/relicta 심층해제 이름` — 심층 전체 참고
- `/relicta 로그아웃` · `/relicta 접속`
- `/relicta 사망` · `/relicta 부활 일반|다이아|골드`

설정 패널의 인물 목록은 이름 검색으로 찾을 수 있습니다.
