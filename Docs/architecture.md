# Motif 아키텍처

## 3단 학습 모드 및 추상화 구조

| 모드 / 층 | 데이터 구조 | 사용자 조작 | 전이 |
|---|---|---|---|
| **기초 입문 (4유닛 14강)** | `BasicLessonDefinition` (`basics.json`) | 4유닛 코스 목차, 완료한 강 랜덤 복습, A/B 소리 비교, 원리 카드, 라벨 표시/숨김 건반 귀 훈련·피아노롤·화성 기능 코드 교체·캐논 편곡 | `실전 미션` 또는 `자유 스케치`로 편곡 내보내기 |
| **실전 미션 (4유닛 12강)** | `LessonDefinition` (`lessons.json`) | 4유닛 미션 목차, 완료한 미션 랜덤 복습, L1/L2/L3 샌드박스 위 퍼즐 목표·브릿지·이론 코치 체크리스트 달성 | `자유 스케치`와 진행도 분리 저장 |
| **자유 스케치 (L1→L2→L3)** | `L1Blocks` → `L2Chain` → `NoteEvent[]` | 블록 조립, 변형 체인 전/후 비교, 2옥타브 피아노롤 직접 편집, 읽기 전용 Gemini 이론 튜터 비교 청취 | 상단 탭·버튼으로 층 간 왕복 |

## 모듈 분리

- `src/data/*.json`: 프리셋·그루브·윤곽·변형 메타데이터·음표 길이 옵션·분석 임계값·믹서/메트로놈 재생 설정·곡 라이브러리 제한(`presets.json`), 기타 6현 운지표(`guitarChords.json`), 14강 기초 원리·귀 훈련·클래식 해부 커리큘럼(`basics.json`), 12강 실전 미션 커리큘럼(`lessons.json`), Gemini 튜터 모델·생성 옵션·국소 비교 제한·질문 프리셋(`coach.json`).
- `src/core/`: DOM·오디오·네트워크 비의존 순수 로직(`theory.ts`, `model.ts`, `projectLibrary.ts`, `compiler.ts`, `analyzer.ts`, `coachPatch.ts`, `history.ts`, `pianoRollOps.ts`, `playbackControl.ts`, `basics.ts`, `lesson.ts`, `midi.ts`).
- `src/ai/`: 브라우저 `fetch` 기반 Gemini REST API 어댑터 및 로컬 설정 저장(`geminiCoach.ts`).
- `src/audio/`: `smplr` 기반 실제 악기 샘플 엔진(`SplendidGrandPiano`, 나일론 기타·일렉 핑거 베이스 Soundfont, `LM-2` 드럼 머신)과 클린 폴백 신스·악기별 EQ·메트로놈 버스(`instruments.ts`), 건반 기본·기타 전환형 화음 반주 및 Seek·구간 반복·트랙 볼륨·메트로놈 룩어헤드 스케줄러(`transport.ts`).
- `src/ui/`: 기초 코스 목차 및 집중 학습 뷰(`basicsView.ts`), 실전 미션 목차 및 배너(`lessonPanel.ts`), 자유 스케치 다중 곡 슬롯·JSON 백업 바(`songLibraryBar.ts`), 피아노 건반(기본)/기타 운지표 전환형 코드 스트립(`guitarStrip.ts`), L1/L2/L3 및 마디 Seek·구간 반복 피아노롤(`layers.ts`), 로컬 이론 코치 및 읽기 전용 Gemini 이론 튜터 패널(`coachPanel.ts`).
