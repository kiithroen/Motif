# AGENTS.md

도레미·기타 코드 감각에서 시작해 3단 추상화(`L1 블록` -> `L2 변형 체인` -> `L3 음표 피아노롤`)로 작곡을 배우고 실험하는 웹 앱이다.

## 규칙

- 튜닝 값(코드 진행 프리셋, 그루브, 윤곽, 변형 기본값, 분석 임계값, 기타 운지표)은 `src/data/*.json` 에만 둔다. 코드·문서·테스트에 상수를 중복 기재하지 않는다.
- `src/core/` 는 DOM 과 WebAudio 에 의존하지 않는 순수 TypeScript 모듈로 유지한다(Node 환경 Vitest 에서 그대로 검증 가능해야 한다).
- 이론 분석기(`src/core/analyzer.ts`)의 새 진단 규칙은 반드시 의도적 결함을 주입한 테스트 케이스로 실제 탐지 및 `applyFix` 해소를 검증한다.
- 검증 명령은 `npm run typecheck && npm test && npm run build` 다. UI/레이아웃 변경 후에는 개발 서버를 띄워 실제 브라우저 스크린샷을 확인한다.
- [Docs/roadmap.md](Docs/roadmap.md) 에 현재 상태와 다음 작업을 유지한다.
- 기능 추가·수정 시 SemVer(버그·소폭 수정 PATCH, 기능 추가 MINOR, 구조·호환 변경 MAJOR)에 맞춰 `package.json`, `package-lock.json`, `android/app/build.gradle`(`versionName` 동기화 및 `versionCode` 1 증가)의 버전을 함께 올린다.
