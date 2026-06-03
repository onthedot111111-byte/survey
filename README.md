# 설문 공유 인증 웹사이트

사진 인증을 접수하고, 관리자가 승인한 인원 수만 공개 순위에 반영하는 웹앱입니다. 공개 순위에는 이름이 마스킹되고, 실명·전화번호·사진은 관리자 화면에서만 볼 수 있습니다.

## 지금 설정

`.env` 파일을 만들어두었습니다.

```env
PORT=5174
ADMIN_PASSWORD=gghs0418
SURVEY_URL=https://example.com/your-survey
MAX_UPLOAD_MB=8
```

실제 설문 링크가 생기면 `.env`의 `SURVEY_URL`만 바꾸고 서버를 재시작하세요.

`.env`는 GitHub에 올리지 않도록 `.gitignore`에 포함되어 있습니다. Render에서는 같은 값을 Environment Variables에 직접 넣으면 됩니다.

## 실행

```bash
npm install
npm start
```

기본 주소는 `http://localhost:5174`입니다. 관리자 비밀번호는 `.env`에 설정한 `gghs0418`입니다.

## 운영 흐름

1. 참가자가 실명, 전화번호, 공유 대상, 인증 사진을 제출합니다. 사진은 한 번에 여러 장 올릴 수 있습니다.
2. 제출 직후에는 대기 상태라 공개 순위에 반영되지 않습니다.
3. 관리자가 사진과 개인정보를 확인합니다.
4. 같은 사람에게 여러 명이 공유한 경우 가장 먼저 인증한 사람만 인정합니다.
5. 단톡방 공유는 관리자가 실제 유효 인원 수를 인원 칸에 입력합니다.
6. 공개 순위는 승인된 인원 수 합계로 계산하고, 상위 3명을 기프티콘 후보로 표시합니다.

관리자 화면의 인원 칸은 언제든 수정할 수 있습니다. 중복 공유나 단톡방 인원 차감이 있으면 승인 인원을 직접 조정하세요.

## 공유 문구

인증 화면에는 게시용 공유 규칙과 전체 공유 문구 복사 칸이 있습니다. 전체 공유 문구에는 설문 안내, 설문 링크, 공유 규칙, 설문 공유 인증 사이트 링크가 한 번에 들어갑니다.

설문 링크는 `.env`의 `SURVEY_URL`에서 자동으로 붙습니다. 인증 사이트 링크는 접속 중인 사이트 주소를 기준으로 자동 생성됩니다.

안내문이나 기본 공유 규칙을 바꾸려면 `public/app.js`의 `SURVEY_INTRO_TEXT`, `SHARE_RULES`를 수정하세요.

## 백엔드 연결

이 프로젝트는 이미 백엔드가 연결된 구조입니다.

- 서버: `server.js`
- 화면: `public/index.html`, `public/styles.css`, `public/app.js`
- 데이터: `data/db.json`
- 사진: `uploads/`
- 설정: `.env`

참가자가 올린 사진은 `/uploads`로 공개하지 않습니다. 관리자 로그인 후 `/api/admin/photo/:fileName`을 통해서만 볼 수 있습니다. 인증 1건에는 최대 8장의 사진을 첨부할 수 있습니다.

## 배포 방법

Render, Railway, Fly.io 같은 Node 호스팅에 올릴 수 있습니다.

### GitHub에 올리기

```powershell
git init
git add .
git commit -m "Initial survey share proof app"
git branch -M main
git remote add origin https://github.com/USER/REPO.git
git push -u origin main
```

`node_modules`, `.env`, `data`, `uploads`, `screenshots`, 로그 파일은 `.gitignore`로 제외했습니다.

### Render에 배포하기

1. Render에서 New > Web Service를 선택합니다.
2. GitHub 저장소를 연결합니다.
3. Runtime: `Node`
4. Build command: `npm install`
5. Start command: `npm start`
6. Environment Variables에 아래 값을 넣습니다.

```env
ADMIN_PASSWORD=gghs0418
SURVEY_URL=실제_설문_링크
MAX_UPLOAD_MB=8
```

Render가 `PORT`를 자동으로 제공하므로 `PORT`는 따로 넣지 않아도 됩니다.

`render.yaml`도 추가해두었습니다. Render Blueprint로 배포하면 `ADMIN_PASSWORD`, `SURVEY_URL`은 대시보드에서 직접 입력하라는 형태로 뜹니다.

### 사진과 데이터 보존

기본 저장 방식은 서버 파일입니다. Render는 기본 파일 시스템이 임시 저장소라 재배포나 재시작 때 `data/db.json`과 `uploads/`가 사라질 수 있습니다.

유료 Persistent Disk를 붙일 경우:

1. Disk mount path를 `/var/data`로 설정합니다.
2. Environment Variables에 `STORAGE_DIR=/var/data`를 추가합니다.
3. 다시 배포합니다.

그러면 데이터는 `/var/data/data/db.json`, 사진은 `/var/data/uploads`에 저장됩니다.

무료 플랜으로 실제 운영한다면 장기 보존은 불안정합니다. 안전하게 운영하려면 PostgreSQL/Supabase Database와 Supabase Storage/S3 같은 외부 저장소로 옮기는 것을 권장합니다.

## 개인정보 체크

실명, 전화번호, 사진을 받으므로 실제 공개 전에는 HTTPS, 강한 관리자 비밀번호, 개인정보 수집 동의 문구, 보관 기간, 삭제 요청 창구를 정해두세요.
