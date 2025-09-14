# 집수리 직원관리 스타터 (Next.js + Supabase)

이 폴더를 그대로 사용하면 **로그인 → 대시보드 → 스케줄/자재/경비/급여 목록** 까지 바로 확인할 수 있습니다.
(이미지에 나온 ERD 테이블 이름을 그대로 사용합니다.)

---

## 0) 준비물 설치
- Node.js 18 이상 (https://nodejs.org/)
- 코드 에디터 (VS Code 추천)
- Git (선택)

## 1) 프로젝트 내려받기 & 설치
```bash
# 압축 해제 후 폴더로 이동
cd staff-admin-starter

# 패키지 설치
npm install
```

## 2) Supabase 프로젝트 생성
- https://supabase.com 에서 새 프로젝트 생성
- **Project URL** 과 **anon key** 를 복사

## 3) 환경변수 설정
- 프로젝트 루트에 `.env.local` 파일을 만들고, 아래처럼 붙여넣기
- 값은 본인 프로젝트 값으로 교체
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

## 4) 데이터베이스 준비
- 이미 제공된 스키마(ERD)를 사용하세요.
- RLS가 켜져 있으면 아래 예시 정책을 참고해 최소한의 권한을 설정하세요.

### RLS 정책 예시 (필요 시 `sql/policies.sql` 참고)
- `profiles` : 본인은 본인 row 읽기/수정 가능, `role='admin'` 은 전체 읽기/쓰기 가능
- `schedules/materials/expenses/payrolls` : 
  - 직원(`staff`)은 `employee_id = auth.uid()` 인 레코드만 읽기
  - 관리자는 전체 읽기

## 5) 개발 서버 실행
```bash
npm run dev
# 브라우저에서 http://localhost:3000 접속
```

- `/login` 페이지에서 계정을 생성/로그인 후
- 사이드바 메뉴에서 각 페이지로 이동하면 DB 데이터가 표로 보입니다.

## 6) 배포 (Vercel)
- https://vercel.com 에서 **New Project** → Git 레포 연결
- **Environment Variables** 에 `.env.local` 과 동일한 값 추가
- Deploy

---

## 폴더 구조 (어디에 무엇을 붙여넣는지)
```
/app
  /dashboard/page.tsx   ← 대시보드 지표 계산/표시 (서버 컴포넌트)
  /login/page.tsx       ← 로그인 화면 (Supabase Auth UI)
  /schedules/page.tsx   ← 스케줄 목록
  /materials/page.tsx   ← 자재 목록
  /expenses/page.tsx    ← 경비 목록
  /payrolls/page.tsx    ← 급여 목록
  layout.tsx            ← 공통 레이아웃(사이드바)
  globals.css           ← Tailwind 스타일
/components
  Sidebar.tsx           ← 좌측 메뉴
  MetricCard.tsx        ← 대시보드 카드 컴포넌트
/lib
  supabaseClient.ts     ← 클라이언트에서 Supabase 사용
  supabaseServer.ts     ← 서버 컴포넌트/라우트에서 Supabase 사용
/middleware.ts          ← 로그인 필요 페이지 보호
```

### 파일 수정 포인트 (정확한 위치)
1. **환경변수**: 프로젝트 루트에 `.env.local` 생성 (새 파일) → 위 값 붙여넣기
2. **대시보드 지표 계산을 바꾸고 싶다면**  
   - 파일: `app/dashboard/page.tsx`
   - 위치: 파일 맨 아래의 `return (...)` 위쪽에서 `labor/material/revenue` 계산 로직을 수정
3. **사이드바 메뉴 이름/경로 바꾸기**  
   - 파일: `components/Sidebar.tsx`
   - 위치: `items` 배열 (파일 상단) 값 수정
4. **테이블 컬럼명이 다를 때**  
   - 각 페이지(`app/*/page.tsx`) 상단의 `.select(...)` 안 필드명과 `order(...)` 기준을 실제 DB 컬럼으로 바꾸기

---

## 자주 막히는 포인트
- **The default export is not a React Component**  
  → `app/login/page.tsx` 등 **페이지 파일은 반드시 `default export function ...`** 형태여야 함 (이미 적용되어 있음).
- **Auth 세션이 안 살아남음**  
  → `.env.local` 이 올바른지 확인. 도메인이 바뀌었으면 `NEXT_PUBLIC_SITE_URL` 값을 실제 배포 도메인으로 교체.
- **권한 오류**  
  → RLS 정책에서 현재 로그인 사용자가 읽을 수 있는지 확인.

---

## 다음 단계 (확장)
- 신규 스케줄/자재/경비 입력 폼 추가 (서버 액션 또는 라우트 핸들러 이용)
- 역할별 화면 분리 (관리자 전용 작성/수정)
- 매출/손익 그래프 (recharts) 추가
- CSV/엑셀 다운로드 기능
