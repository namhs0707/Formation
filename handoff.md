# Formation Inspection 인수인계 (2026-10-06 기준)

다음 세션은 이 문서부터 읽고 시작합니다. 예전 SharePoint 이전 계획은 폐기되었고, **회사 VM(Windows Server) + PostgreSQL 버전이 운영 대상**입니다.

## 1. 폴더와 브랜치

| 위치 | 브랜치 | 용도 |
|---|---|---|
| `C:\Users\heeseong_n\Desktop\Formation` | `feature/gdrive-backend` | Google Sheets/Apps Script 버전. **임시 사용 후 폐기 예정**, 보안 검토 대상 아님 |
| `C:\Users\heeseong_n\Desktop\Formation-vm-server` (git worktree) | `feature/vm-server` | **운영 대상 VM/PostgreSQL 버전.** 앞으로의 작업은 여기서 |
| `C:\Users\heeseong_n\Desktop\Formation-VM-이전` | — | VM으로 옮길 파일 모음 (ZIP, 설치 파일, `설치순서.txt`, 환경확인 스크립트) |

- 커밋은 모두 로컬에만 있고 **push하지 않았습니다.** 원격은 개인 GitHub(`namhs0707/Formation`, 공개 여부 미확인)입니다.
- worktree의 `node_modules`는 원래 프로젝트 `node_modules`를 가리키는 **링크(junction)**입니다. PowerShell `Remove-Item -Recurse`로 지우면 원본까지 삭제될 수 있으니 탐색기에서 링크만 지우세요.
- 두 브랜치의 화면 파일은 각자 `index.html`과 `public/formation.html`이 같아야 합니다. 하나를 고치면 다른 하나로 복사하세요. Sheets 브랜치는 `Code.gs`와 `apps-script/Code.js`도 같아야 합니다.

`feature/vm-server` 최근 커밋:
- `9838711` 검토자 로그인·계정 관리·기록 검토 화면
- `3962f3a` 검토자 계정과 기록 검토 API
- `f8c5b5e` 모든 제출 기록에 제출 기기 IP 저장
- `04eb914` Sheets 화면 기능을 VM 버전에 반영 (Temperature DB 지원 포함)

## 2. 회사 VM 환경 (확인된 사실)

- Windows Server 2022 Standard, VMware 위의 가상머신, CPU 4코어, RAM 8GB.
- 디스크 여유: C 43GB, D 100GB.
- **인터넷 불가**, 도메인 미가입(WORKGROUP), 관리자 권한 있음.
- PostgreSQL **17** 설치. 데이터 폴더는 C 드라이브 → **운영 전에 D로 옮기기로 함** (아직 안 함, 옮기는 스크립트도 아직 없음).
- Node 버전은 사용자가 VM에서 확인하기로 함. 22와 24 모두 테스트 통과.
- 앱은 `C:\FormationInspection`에 설치되어 포트 3000에서 실행 중입니다. 2026-10-06 초기 패키지 기준이고 `setup.ps1`까지 성공했습니다.
- **VM에 아직 최신 ZIP을 적용하지 않았습니다.** 적용하려면 `설치순서.txt`의 업데이트 순서대로 진행합니다: `apply-schema.ps1` → `create-admin.ps1` → `start-vm-server.ps1 -AllowHttpLogin`.
- 네트워크
  - VM → 도메인 컨트롤러 TCP 389/636: 시간 초과로 막힘. 업무 PC → 같은 도메인 컨트롤러 636: 정상.
  - 방화벽은 **본사가 고정 IP 단위로** 열어 줌. 사용자가 임의로 열 수 없음.
  - VM 밖에서의 접속 테스트는 아직 하지 않음.

## 3. 구현된 기능 (VM 버전)

- 14종 양식 저장과 조회, 사진(DB 저장), Temperature(영역별, `temperature_readings` 테이블).
- Conductive Rubber 참고 이미지와 공정·측정별 Unit 제한 (EOL IV는 1A, 1B, 2A, 2B).
- DSF Daily IP: Line 드롭다운(`EOL #4-1` 등), 대시보드(이미지 4장 + 점검별 1행 표, 스펙 아웃 강조).
- **IR** (메뉴 단독 버튼, process `ir`): Team, 이름, 위치(Degas / Shipping Aging), PKG Lot ID, Tray 1·2 붙여넣기(첫 줄 Tray ID + 채널 1~18이 OK 또는 숫자). 숫자가 100 미만이면 NG. 서버가 판정을 다시 계산합니다. 테이블은 `ir_checks`, `ir_values`(OK는 NULL)이며 검토·수정도 지원합니다. `record_reviews`의 record_type 제약은 스키마를 적용할 때마다 다시 만들어지므로, 기존 DB도 `apply-schema.ps1`만 실행하면 됩니다.
- **Summary** (앱 첫 화면, 메뉴 맨 위): `GET /api/summary`(`server/summary.mjs`)가 오늘(공장 시간대) 점검 상태를 계산합니다. 불량·스펙 아웃·NG·Flagged/Incomplete/No → Problem, 오늘 기록 없음 → No record today, EOL Tape/Knife와 Conductive Rubber는 수시 정비라 마지막 기록만 표시. 검토 대기는 최근 7일 미확인 건수. 판정 기준은 화면 하단 "How status is decided"에도 있습니다.
- **제출 기기 IP(`client_ip`)**: 모든 부모 테이블에 저장. 거래 단위 설정값을 컬럼 기본값으로 씀. 로컬 IIS(127.0.0.1)가 보낸 `X-Forwarded-For`만 신뢰.
- **검토자 임시 로그인** (`server/auth.mjs`)
  - 계정 신청 → 관리자가 역할(part_leader / engineer / supervisor / admin)을 정해 승인. ID는 자유 형식.
  - 비밀번호는 scrypt 해시로만 저장, 10자 이상 영문+숫자.
  - 5회 실패 시 15분 잠금. 세션은 30분 미사용 또는 12시간 경과 시 만료되고, 토큰은 SHA-256으로만 저장.
  - 관리자 초기화 시 임시 비밀번호를 발급하고 다음 로그인 때 강제 변경.
  - 90일 미접속 계정은 자동 비활성화되고 비밀번호 삭제. 이름은 이력에 남음.
  - 첫 관리자는 `scripts/create-admin.ps1`로만 생성.
  - 로그인은 **HTTPS일 때만** 켜짐 (로컬 프록시가 보낸 `X-Forwarded-Proto=https`). 예외로 `start-vm-server.ps1 -AllowHttpLogin`.
  - 계정·검토 관련 POST는 같은 출처의 JSON 요청만 받고, 로그인 시도는 기기당 10분 20회로 제한.
- **기록 검토** (`server/reviews.mjs`)
  - 누구든 한 명이 확인하면 완료.
  - 수정은 사유 필수, 필드별 검증 후 `record_reviews`에 **추가만** 함. 원본은 바뀌지 않음. 조회할 때 수정 내용을 반영하고 검토 상태를 붙임.
  - 수정한 뒤에는 다시 확인이 필요.
  - 앱 DB 계정은 검사 기록과 검토 이력을 수정·삭제할 수 없음. `app_users`와 `app_sessions`만 UPDATE 가능.
- **화면**
  - 날짜 칸 아래 검토 배지 → 검토 창 (필드 수정, 사유, 변경 전·후 확인 단계, 이력).
  - 헤더 계정 메뉴(👤 ▾): 계정 관리(관리자), 비밀번호 변경, 로그아웃.
  - 휴대폰 화면 대응.
- DB 변경 적용: 기존 DB에는 `database/windows/apply-schema.ps1`을 씁니다. 기록이 유지되고 앱 암호도 바뀌지 않습니다. `001_initial.sql`은 몇 번을 다시 실행해도 안전합니다.

## 4. 결정 사항

- **우선 HTTP로 운영**합니다. 서버는 `-AllowHttpLogin`으로 시작하고, 검토자에게는 회사 계정과 다른 비밀번호를 쓰도록 안내합니다.
- 보안성 검토를 요청해 보고, HTTPS가 필요하다고 하면 그때 다시 검토합니다. 사용자가 인증서·IIS 과정이 너무 길고 복잡하다고 판단함.
  - HTTPS를 하게 되면 추천 방식은 **Node가 인증서 파일로 직접 HTTPS를 처리**하는 것입니다(설치가 적음). 대안은 IIS를 앞에 두는 방식입니다.
  - 인증서는 회사 내부 CA가 1순위이고, 없으면 자체 서명 인증서를 씁니다. 내부 CA가 있는지는 업무 PC에서 `certutil -TCAInfo`로 확인할 수 있습니다(아직 안 함).
- Docker는 쓰지 않습니다(인터넷 불가, WSL 미설치, 리눅스 추가 설치 배제). VM에 직접 설치하는 방식으로 갑니다.
- 상용 SSO는 비용(약 1,500만원) 때문에 불가합니다. 회사 AD 연결(도메인 가입 또는 LDAPS 636 허용)은 IT가 VM → 도메인 컨트롤러 통신을 열어 줘야 가능하고, 열리면 로그인 부분만 AD로 교체합니다.
- 오퍼레이터는 로그인 없이 제출합니다. 추적은 본사가 관리하는 고정 IP 허용 목록과 제출 기기 IP 기록으로 합니다.

## 5. 다음 할 일 (우선순위)

1. **보안성 검토 자료 작성**: 사용자가 붙여 준 "AI 소스코드 산출물 보안 자가점검" 6개 항목 양식을 따릅니다.
   - 표가 아니라 구조화된 텍스트로 쓰고, 소스코드로 알 수 없는 내용은 "확인할 수 없음"으로 적습니다.
   - 항목 중 하나라도 🟡/🔴이면 하단 🚨 안내 문구를 반드시 넣습니다.
   - 시스템 아키텍처 구성도(데이터 흐름, 업로드 데이터 종류 포함)도 함께 작성합니다.
   - 현재 상태 예상:
     - 1 🔴 (HTTP)
     - 2 🟡 (추가·수정 있음. 다만 확인 단계, 사유, 이력, 삭제 불가)
     - 3 🟢
     - 4 🟡 (작업자 이름, 배터리 공정 데이터. 국가핵심기술 해당 여부는 확인할 수 없음)
     - 5 🟡 또는 🟢
     - 6 🟡 (자체 임시 로그인, 사진 업로드)
2. VM에 최신 ZIP 적용과 관리자 생성. 사용자가 진행합니다.
3. 남은 보완 작업:
   - 오퍼레이터 제출 전 확인 화면
   - 서버에서 사진 파일 내용 검사(실제 이미지인지)
   - 사진 해상도 3000px → 2000px 검토 (사용자 결정 대기)
   - 목록 화면의 이름 마스킹
   - DB 제약 오류 메시지 일반화
   - 요청 횟수 제한 확대
4. PostgreSQL 데이터 폴더 C → D 이동 스크립트. 운영 전에 필요합니다.
5. 기존 Google Sheets 기록을 DB로 가져오기. 할지 말지 사용자가 아직 정하지 않았고, 테이블의 `source_key`는 중복 방지용으로 준비되어 있습니다.
6. 상시 실행: VM 재부팅 시 자동 시작(작업 스케줄러 또는 서비스).
7. 업데이트 편의: 화면에 버전 표시, VM 업데이트 스크립트 하나로 묶기. 제안만 하고 아직 미정입니다.

## 6. 테스트 방법

- `C:\Users\heeseong_n\Desktop\Formation-vm-server\scripts\test-on-temp-db.ps1`
  - 이 PC의 PostgreSQL 18에 **임시 DB**를 만듭니다.
  - 스키마 2회, 스모크 테스트, 관리자 생성, 서버 실행, `server/test-api.mjs`, `server/test-auth.mjs`를 차례로 돌린 뒤 임시 DB를 삭제합니다.
  - 실제 `formation_inspection` DB는 건드리지 않습니다. 이 PC의 DB 계정 정보는 `%LOCALAPPDATA%\FormationInspection\postgres-local-credentials.json`(Windows 암호화)에 있습니다.
  - 2026-10-06에 전부 통과했습니다.
- 화면 테스트는 Playwright로 임시 스크립트를 만들어 진행했습니다(저장소에는 없음).
  - 로그인과 승인을 화면에서 시험하려면 서버를 `FORMATION_ALLOW_HTTP_LOGIN=1`로 띄웁니다.
  - 표 안의 배지는 `button.review-badge[data-review-type]`, 계정 메뉴는 `.account-menu summary`입니다.
- VM 패키지는 worktree에서 `scripts\package-vm.ps1`로 만듭니다. 압축 중 파일 잠김 오류가 나면 다시 실행하세요(백신 검사 때문).
  - 결과는 `Formation-vm-server\Formation-VM-App.zip`이고, `Formation-VM-이전` 폴더로 복사합니다.

## 7. 작업 시 주의

- 서버 `.mjs` 파일 중 일부는 CRLF 줄바꿈입니다. 스크립트로 문자열을 바꿀 때는 줄바꿈을 맞추세요.
- Windows PowerShell 5.1에서 `$ErrorActionPreference='Stop'` 상태로 psql이나 node에 `2>&1`을 붙이면, NOTICE 같은 안내 메시지에도 실행이 중단됩니다.
- VM용 `.ps1` 파일에 한글이 있으면 UTF-8 BOM으로 저장해야 합니다.
- 사용자는 비전문가입니다. 설명은 한국어로 짧게 하고, 필요하면 그림(PNG)으로 보여 주세요. 길고 복잡한 절차는 선호하지 않습니다.
