# YT Digest

**라이브 데모: https://vibetest-yt-drcq.vercel.app/**

유튜브 채널을 구독하고, 최신 영상의 AI 요약을 카드 형태로 한눈에 확인하는 대시보드입니다.

## 주요 기능

- **채널 구독 관리** — YouTube 채널을 추가하고 사이드바에서 빠르게 탐색
- **자동 영상 수집** — 구독 채널의 최신 영상을 자동으로 가져옴 (Shorts 제외)
- **AI 요약** — Google Gemini API를 활용해 영상 자막을 3줄 불릿 요약으로 변환
- **관련 뉴스** — 영상 주제와 연관된 최신 뉴스 자동 매핑
- **관련 종목** — 영상 내용 기반 관련 주식 종목 표시
- **즐겨찾기 & 메모** — 영상별 즐겨찾기 등록 및 개인 메모 저장
- **다크/라이트/베이지 테마** — 사용자 설정 테마 지원

## 기술 스택

| 영역 | 기술 |
|------|------|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS v4 |
| Backend | Next.js Server Actions, Route Handlers |
| DB | Supabase (PostgreSQL) |
| AI 요약 | Google Gemini 2.5 Flash Lite |
| 자막 추출 | youtube-transcript, Azure Cognitive Services (fallback) |
| 배포 | Vercel |

## 시작하기

### 사전 준비

- Node.js 18+
- Supabase 프로젝트
- Google Gemini API 키
- YouTube Data API v3 키

### 설치

```bash
git clone https://github.com/skyekorea11/vibetest_yt
cd vibetest_yt
npm install
```

### 환경 변수 설정

`.env.local` 파일을 생성하고 아래 값을 채워 넣으세요:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
YOUTUBE_API_KEY=your_youtube_api_key
GEMINI_API_KEY=your_gemini_api_key
```

### DB 초기화

Supabase 대시보드 → SQL Editor에서 `lib/supabase/schema.sql` 내용을 실행하세요.

### 실행

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 을 열면 됩니다.

## 배포

Vercel에 연결 후 위 환경 변수를 Project Settings → Environment Variables에 등록하면 자동 배포됩니다.

## 라이선스

MIT
