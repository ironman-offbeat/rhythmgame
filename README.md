# Rhythm Game

모바일과 데스크톱 브라우저에서 실행할 웹 리듬게임 프로젝트입니다.

> **현재 단계:** 개발 환경 초기화. 게임 규칙, 판정, 채보, 곡 선택, 사운드 및 실제 플레이 화면은 기획 확정 후 구현합니다.

## 기술 구성

- **Vite 8 + React 19 + TypeScript**: 웹 앱 빌드 및 UI 개발
- **Web Audio API(예정)**: 음원 재생 및 시간 동기화
- **Canvas / requestAnimationFrame(예정)**: 게임 노트와 연출을 프레임 단위로 렌더링
- **Vercel(예정)**: 정적 웹 앱 배포

리듬 판정 시각은 화면 프레임이 아니라 오디오 타임라인에 기반하도록 설계할 계획입니다. 게임 기획 전까지 판정 방식이나 레인 수 등은 미확정입니다.

## 로컬 실행

Node.js 22.12 이상이 필요합니다.

```bash
npm install
npm run dev
```

개발 서버가 표시하는 로컬 주소에서 확인합니다.

```bash
npm run typecheck
npm run build
npm run preview
```

- `npm run typecheck`: TypeScript 검사
- `npm run build`: `dist/` 정적 배포 파일 생성
- `npm run preview`: 빌드 결과 미리보기

## 폴더 구성

```text
public/                   정적 에셋(향후 음악/이미지 등)
src/
  game/                  게임 로직 추가 예정
  App.tsx                앱 진입 화면
  main.tsx               React 초기화
  styles.css             전역·반응형 스타일
.github/workflows/ci.yml 자동 타입 검사 및 빌드
```

음원 및 이미지 등의 저작권·용량·라이선스를 확인한 후 저장 위치와 전송 전략을 정합니다. 대형 음원은 무조건 GitHub 저장소에 넣지 않습니다.

## Vercel 배포 (추후)

1. Vercel에서 이 GitHub 저장소를 Import합니다.
2. **Framework Preset:** Vite
3. **Build Command:** `npm run build`
4. **Output Directory:** `dist`
5. **Node.js:** 22.x 이상(지원되는 버전)

현 시점에는 Vercel 연결·배포를 하지 않았습니다.

## 개발 원칙

1. 초기에는 모바일 브라우저를 우선하며, 데스크톱 반응형으로 확장합니다.
2. 오디오 시간 동기화와 렌더링 상태 관리를 분리합니다.
3. 사용자 입력(터치·키보드)의 지연을 측정하고 불필요한 React 재렌더링을 피합니다.
4. 게임 기획 확정 전에는 게임플레이 규칙을 임의로 추가하지 않습니다.
5. 기능 단위로 테스트하고 안정적인 상태를 `main`에 반영합니다.
