# Motif 로드맵

## 목표

도레미와 기초 기타 코드만 아는 초보자가 **기초 입문(4유닛 14강) → 실전 미션(4유닛 12강) → 자유 스케치(L1 블록 → L2 변형 체인 → L3 피아노롤)** 사다리를 밟으며 작곡 원리를 귀와 손으로 익히고, 실시간 음악 이론 분석기와 읽기 전용 Gemini 이론 튜터의 설명·비교 청취를 통해 스스로 곡을 다듬는 웹 기반 작곡 학습·스케치 앱을 만든다.

## 지금 상태

- **기초 입문 14강(4유닛, 총 26강 중 1부) 완료:** 4유닛 코스 목차 대시보드, 완료한 강 랜덤 복습, 이번 강 핵심 배지, A/B 소리 비교, 라벨 숨김 귀 훈련(`hidePickLabels`)과 전용 실습 UI(`src/data/basics.json`, `src/core/basics.ts`, `src/ui/basicsView.ts`)를 통해 화음·음계·장단조·4/4 강박과 약박·당김음·도약 보상·화성 기능(I-IV-V7-I)·클래식 해부(「작은 별」, 「환희의 송가」)·캐논 8마디 편곡까지 단계별로 학습한다.
- **실전 미션 12강(4유닛 × 3강) & 자유 스케치 완료:** L1 블록 설계 → L2 변형 체인과 L3 브릿지 → L3 정밀 편집(음표 추가/삭제, 음표 본체 드래그로 음높이·박자 이동, 오른쪽 끝 드래그로 길이 조절, 실시간 화성 색상·미리듣기, 1마디 모티프 직접 변주, 잦은 큰 도약 교정)·이론 코치 → 8마디 클라이맥스·조바꿈·풀 파이프라인 완곡까지 12개 미션을 4유닛 목차 및 랜덤 복습 UI(`src/data/lessons.json`, `src/core/lesson.ts`, `src/ui/lessonPanel.ts`)로 연결했고, `자유 스케치` 샌드박스·`smplr` 실제 악기 샘플 오디오 엔진(피아노·나일론 기타·베이스·드럼 + 클린 폴백)·`.mid` 내보내기·GitHub Pages 자동 배포까지 완료했다.
- **Gemini 이론 튜터 연동 및 시각 비교 완료:** `src/data/coach.json`, `src/core/coachPatch.ts`, `src/ai/geminiCoach.ts`, `src/ui/coachPanel.ts`, `src/ui/layers.ts` 를 통해 로컬 `DiagnosisReport` 및 마디별 멜로디 컨텍스트 기반 해설, `x-goog-api-key` 헤더 인증 기반의 짧은 멀티턴 후속 질문·대화 초기화, 직접 따라 해보기(`manualSteps`) 안내, 국소 대안 비교 재생, 그리고 L3 피아노롤 고스트 노트·바뀐 코드 마디 시각 겹쳐보기를 제공한다.
- **기반 안정화 완료:** 슬라이더 드래그 DOM 유지 및 Undo 스냅샷 정합성 보완, 이론 분석기(`out_of_scale`·`monotone_rhythm`·`no_breathing_room`) 및 기타 운지표(`#`/♭ 이명동음·`dim` 폼) 수정, MIDI 동일 틱 Note Off 우선 정렬 및 악기 프로그램 반영, 폴백 신스 정지 및 샘플 로딩 타임아웃, 코스 목차 화면 `Space` 재생 차단을 반영했다.
- **재생 제어 및 믹서 고도화 완료:** 피아노롤 마디 헤더 클릭 Seek, `↻` 버튼·Shift 확장·헤더 드래그 기반 마디 구간 반복 및 SVG 하이라이트, 드럼 음소거 연동 자동 메트로놈 클릭과 수동 토글, 트랙별(멜로디·코드·베이스·드럼) 볼륨 믹서를 반영했다.
- **L3 비파괴 보호 및 편집 편의성 개선 완료:** L2 마디 코드 변경 시 L3 수동 편집 멜로디(`bakedMelody`) 유지 옵션과 덮어쓰기 초기화, 드래그·리사이즈 중 `getBoundingClientRect()` 재계산 스크롤 보정, 16분(1칸)·점4분(6칸) 음표 길이 옵션, 단순 클릭(선택·미리듣기)과 삭제(더블클릭·우클릭·Delete/Backspace) 분리, 마키 다중 선택·Shift/Ctrl 토글·Ctrl+A/C/X/V/D 복사·붙여넣기·복제·일괄 드래그·Alt+드래그 복사·방향키 미세 이동·옥타브 이동 선택 툴바를 반영했다.
- **다중 곡 슬롯 및 JSON 백업 완료:** 자유 스케치 프로젝트를 최대 슬롯 한도 내에서 생성·복제·이름 변경·2단계 삭제·드로어 목록 전환으로 관리하고(`src/core/projectLibrary.ts`, `src/ui/songLibraryBar.ts`), 단일 곡(`motif-song`)·전체 라이브러리(`motif-library`)·단일 프로젝트 JSON 내보내기/불러오기 및 기존 단일 프로젝트(`motif_project_v1`) 자동 마이그레이션을 반영했다.
- **구조·성능 리팩토링 완료:** `src/core/compiler.ts`의 `previewModifierDiff`에 기준 컴파일 재사용 및 bounded 캐싱을 적용해 L2 변형 카드 렌더링과 전/후 비교 미리듣기의 중복 컴파일을 줄였고, `src/main.ts`의 저장소·파일 다운로드(`src/app/storage.ts`), 키보드 단축키(`src/app/shortcuts.ts`), Gemini/로컬 이론 코치 제어(`src/app/coachController.ts`) 책임을 분리했다.
- **갤럭시 Z 폴드7 모바일 최적화·터치 UX·PWA 완료:** 접힌 커버 화면(`<=600px`)과 펼친 메인 화면(`601px~1060px`) 듀얼 폼팩터 반응형 레이아웃, 접이식 상단 도구 바, 하단 고정 엄지 독(`#mobile-thumb-dock`), 가로 스와이프 코드 스트립 활성 마디 추적, L3 피아노롤 터치 스크롤/탭 분리·`입력/이동`·`범위 선택` 도구 전환·3단계 배율(`작게`/`보통`/`크게`)·터치 정밀 편집(반음·스텝·음표 길이 `adjustPianoRollNotesDuration`) 및 `manifest.webmanifest`·`sw.js` 기반 standalone PWA 설치를 반영했다.
- **Capacitor Android 패키징 및 디버그 APK 빌드 완료:** `@capacitor/core`·`@capacitor/android`·`@capacitor/filesystem`·`@capacitor/share` 기반 Android 프로젝트(`capacitor.config.ts`, `android/`)를 구성하고, Android WebView `.mid`/`.json` 네이티브 공유 브릿지(`src/app/storage.ts`), 네이티브 환경 SW 비활성화 가드, 폴더블 화면 전환 유지(`resizeableActivity`·`configChanges`), 다크 런처 아이콘·테마 및 `app-debug.apk` 빌드를 완료했다.

## 다음 작업

### 실기기 설치·플레이스토어 릴리스 서명 (선택)
- 필요 시 무선 ADB 연결로 폴드7 실기기 설치 테스트 및 릴리스 키스토어 서명(`.aab`) 구성을 검토한다.
