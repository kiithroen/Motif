# Motif 아키텍처

## 3단 추상화 모델

| 층 | 데이터 구조 | 사용자 조작 | 전이 |
|---|---|---|---|
| **L1. 블록 층** | `L1Blocks` (진행, 그루브, 윤곽, 에너지, 밀도) | 감정·분위기 단위 고수준 블록 선택 및 슬라이더 조절 | `L2로 펼치기(unpackBlocksToChain)` |
| **L2. 변형 체인 층** | `L2Chain` (마디별 `ChordSlot` 배열 + `ModifierState[]` 체인) | 코드 도수 교체, 변형 카드 온/오프·강도 조절, 전/후 diff 미리듣기 | `L3로 굽기(bake)` |
| **L3. 음표 층** | `NoteEvent[]` (`bakedMelody` 및 반주 트랙) | 2옥타브 피아노롤 직접 편집, 음표 길이 선택, 마디별 코드톤 가이드, 되돌리기/다시 실행 | `L2에서 다시 굽기` 또는 이론 분석기 역분석 |

## 모듈 분리

- `src/data/*.json`: 프리셋·그루브·윤곽·변형 메타데이터·음표 길이 옵션·분석 임계값(`presets.json`), 기타 6현 운지표(`guitarChords.json`), 6단계 마이크로 작곡 레슨 커리큘럼(`lessons.json`).
- `src/core/`: DOM·오디오 비의존 순수 로직(`theory.ts`, `model.ts`, `compiler.ts`, `analyzer.ts`, `history.ts`, `lesson.ts`, `midi.ts`).
- `src/audio/`: WebAudio 합성기(`instruments.ts`: 룸 리버브·컴프레서·Karplus-Strong 기타·FM 피아노·베이스·드럼)와 원본 곡 보존형 룩어헤드 스케줄러(`transport.ts`).
- `src/ui/`: 기타 코드 다이어그램 스트립 및 활성 마디 갱신(`guitarStrip.ts`), L1/L2/L3 에디터 및 플레이헤드 갱신(`layers.ts`), 이론 코치 패널(`coachPanel.ts`), 레슨 미션 배너(`lessonPanel.ts`).
