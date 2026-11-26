# Motif 아키텍처

## 3단 추상화 모델

| 층 | 데이터 구조 | 사용자 조작 | 전이 |
|---|---|---|---|
| **L1. 블록 층** | `L1Blocks` (진행, 그루브, 윤곽, 에너지, 밀도) | 감정·분위기 단위 고수준 블록 선택 및 슬라이더 조절 | `L2로 펼치기(unpackBlocksToChain)` |
| **L2. 변형 체인 층** | `L2Chain` (마디별 `ChordSlot` 배열 + `ModifierState[]` 체인) | 코드 도수 교체, 변형 카드 온/오프·강도 조절, 전/후 diff 미리듣기 | `L3로 굽기(bake)` |
| **L3. 음표 층** | `NoteEvent[]` (`bakedMelody` 및 반주 트랙) | 2옥타브 피아노롤 직접 편집, PC 건반 연주, 스케일/코드톤 가이드 | `L2에서 다시 굽기` 또는 이론 분석기 역분석 |

## 모듈 분리

- `src/data/*.json`: 프리셋, 그루브 16스텝 패턴, 윤곽 곡선, 변형 메타데이터, 분석 임계값, 기타 6현 운지표.
- `src/core/`: DOM·오디오 비의존 순수 로직(`theory.ts`, `model.ts`, `compiler.ts`, `analyzer.ts`, `midi.ts`).
- `src/audio/`: WebAudio 합성기(`instruments.ts`: 룸 리버브·컴프레서·Karplus-Strong 기타·FM 피아노·베이스·드럼)와 룩어헤드 스케줄러(`transport.ts`).
- `src/ui/`: 트랜스포트 바, 기타 코드 다이어그램 스트립, L1/L2/L3 에디터, 코치 패널.
