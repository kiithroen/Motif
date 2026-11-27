# Motif 아키텍처

## 3단 학습 모드 및 추상화 구조

| 모드 / 층 | 데이터 구조 | 사용자 조작 | 전이 |
|---|---|---|---|
| **기초 입문 (4유닛 20강)** | `BasicLessonDefinition` (`basics.json`) | 4유닛 코스 목차, 완료한 강 랜덤 복습, A/B 소리 비교, 원리 카드, 건반 선택·피아노롤·코드 교체·캐논 편곡 | `실전 미션` 또는 `자유 스케치`로 편곡 내보내기 |
| **실전 미션 (4유닛 20강)** | `LessonDefinition` (`lessons.json`) | 4유닛 미션 목차, 완료한 미션 랜덤 복습, L1/L2/L3 샌드박스 위 퍼즐 목표·이론 코치 체크리스트 달성 | `자유 스케치`와 진행도 분리 저장 |
| **자유 스케치 (L1→L2→L3)** | `L1Blocks` → `L2Chain` → `NoteEvent[]` | 블록 조립, 변형 체인 전/후 비교, 2옥타브 피아노롤 직접 편집 | 상단 탭·버튼으로 층 간 왕복 |

## 모듈 분리

- `src/data/*.json`: 프리셋·그루브·윤곽·변형 메타데이터·음표 길이 옵션·분석 임계값(`presets.json`), 기타 6현 운지표(`guitarChords.json`), 20강 기초 원리·클래식 해부 커리큘럼(`basics.json`), 20강 실전 미션 커리큘럼(`lessons.json`).
- `src/core/`: DOM·오디오 비의존 순수 로직(`theory.ts`, `model.ts`, `compiler.ts`, `analyzer.ts`, `history.ts`, `basics.ts`, `lesson.ts`, `midi.ts`).
- `src/audio/`: WebAudio 합성기(`instruments.ts`: 룸 리버브·컴프레서·Karplus-Strong 기타·FM 피아노·베이스·드럼)와 원본 곡 보존형 룩어헤드 스케줄러(`transport.ts`).
- `src/ui/`: 기초 코스 목차 및 집중 학습 뷰(`basicsView.ts`), 실전 미션 목차 및 배너(`lessonPanel.ts`), 기타 코드 다이어그램 스트립(`guitarStrip.ts`), L1/L2/L3 및 집중 피아노롤(`layers.ts`), 이론 코치 패널(`coachPanel.ts`).
