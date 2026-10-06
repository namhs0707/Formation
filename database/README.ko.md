# Formation Inspection: Windows Server 2022 + PostgreSQL 18

현재 프로토타입의 모든 양식을 저장할 **빈 PostgreSQL 데이터베이스**를 만드는 준비물입니다. 회사 VM에는 아직 접속하지 않았으므로 이 파일을 VM에 복사한 뒤 설치합니다. 기존 Google Sheets/Drive 기록이나 각 사용자의 브라우저 기록은 자동 이전되지 않습니다.

## 데이터가 이동하는 경로

웹 브라우저 → VM의 웹/API 서버 → 같은 VM의 PostgreSQL

브라우저에서 PostgreSQL에 직접 연결하지 않습니다. DB는 VM의 127.0.0.1:5432에서만 접속하도록 두고, 팀원이 사용할 웹 주소만 사내망에 공개합니다. 현재 공개된 ChatGPT Sites 검토 링크는 이 PC의 PostgreSQL이나 회사 VM에 연결되어 있지 않습니다.

## 필요한 설치 파일

VM이 Windows Server 2022로 확인됐으므로 **PostgreSQL 18의 최신 보안·수정 버전**을 사용합니다. [PostgreSQL 공식 Windows 설치 페이지](https://www.postgresql.org/download/windows/)의 지원표에 Windows Server 2022가 PostgreSQL 18 설치 대상에 포함됩니다. 2026년 10월 현재 [공식 버전 정책](https://www.postgresql.org/support/versioning/)에 표시된 최신 18.x는 18.6입니다. 실제 설치 시점에는 공식 페이지의 최신 18.x를 다시 확인하세요.

회사 규정에 맞는 승인된 PC에서 Windows x64 설치 파일을 내려받아 승인된 내부 경로로 VM에 옮깁니다. VM에서 인터넷 접속은 필요하지 않습니다. 이 프로젝트의 Formation-PostgreSQL-VM.zip도 VM에 복사해 압축을 풀면 database 폴더가 생깁니다. PostgreSQL 설치 파일은 이 ZIP에 포함되지 않습니다.

설치 화면에서 PostgreSQL Server와 Command Line Tools를 선택하세요. pgAdmin은 GUI로 확인하고 싶을 때 선택하면 됩니다. StackBuilder의 추가 구성 요소는 현재 DB 구성에 필요하지 않습니다. 관리자 계정 postgres의 암호를 안전하게 보관하고, 포트는 5432를 사용합니다. 데이터 디렉터리는 백업할 수 있는 VM 내부 디스크에 둡니다.

## 최초 DB 생성

VM에서 PowerShell을 열고 압축을 푼 위치로 이동한 후 실행합니다. 아래 경로는 PostgreSQL 18의 기본 설치 위치입니다.

~~~powershell
.\database\windows\setup.ps1 -PostgresBin 'C:\Program Files\PostgreSQL\18\bin'
~~~

설치 경로를 다르게 지정했다면 PostgresBin 값도 바꾸세요. 스크립트는 다음을 수행합니다.

1. postgres 관리자 계정으로 접속해 formation_app 계정과 formation_inspection DB를 만듭니다. formation_app 암호를 화면에서 묻고 파일에는 기록하지 않습니다.
2. [001_initial.sql](001_initial.sql)을 트랜잭션으로 적용해 10개 테이블과 인덱스를 만듭니다.
3. formation_app 계정으로 [002_smoke_test.sql](002_smoke_test.sql)을 실행합니다. 모든 종류의 샘플 데이터를 넣고 즉시 롤백하므로 DB는 빈 상태로 끝납니다.

재실행할 경우 formation_app 암호를 다시 설정합니다. 나중에 API가 이미 연결되어 있다면 그 API의 암호 설정도 함께 갱신해야 합니다.

## 현재 양식과 테이블

| 화면 | PostgreSQL 테이블 |
| --- | --- |
| Appearance: Before HPCD, Jig Formation, Degas | appearance_inspections, appearance_photos |
| HTA Temperature | hta_readings |
| Area Temperature (CDC, PLT, DGS, EOL, JIG, PRA, RTA, SHA) | temperature_readings |
| EOL Tape/Knife Maintenance | eol_maintenance |
| Conductive Rubber | conductive_maintenance |
| Start-up: HPCD, Jig, Degas, CDC, EOL, Selector | startup_checks, startup_check_items |
| Resealing Machine | resealing_checks |
| DSF Daily IP Check | ip_checks, ip_measurements |

Start-up 점검 1건과 그 안의 세부 항목은 부모/자식 관계로 저장합니다. DSF IP도 점검 날짜·라인 1건과 A/B 또는 공통 측정 항목을 분리해 저장합니다. 측정 당시의 기준값과 판정도 함께 보관합니다. Appearance의 결함 종류에는 Unsealing pouch가 포함됩니다.

신규 Appearance 사진은 최대 8 MB까지 appearance_photos 테이블에 저장하도록 설계했습니다. 따라서 새 사진은 DB 백업에 함께 들어갑니다. 기존 Google Drive 사진은 파일 자체를 옮기기 전까지 참조 URL만 legacy_photo_url에 보관할 수 있습니다. source_key는 나중에 기존 기록을 가져올 때 중복 입력을 막기 위한 칸입니다.

## 설치 확인

~~~powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h 127.0.0.1 -U formation_app -d formation_inspection -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'formation' ORDER BY table_name;"
~~~

초기 설치 직후에는 빈 테이블이 보이며, 웹앱에서 제출한 뒤 기록을 확인할 수 있습니다. PostgreSQL 관리자 암호와 formation_app 암호를 웹페이지 코드나 Git 저장소에 넣지 마세요.

## 백업과 복구 연습

[PostgreSQL pg_dump 문서](https://www.postgresql.org/docs/current/app-pgdump.html)에 따라 custom 형식으로 백업합니다.

~~~powershell
.\database\windows\backup.ps1 -PostgresBin 'C:\Program Files\PostgreSQL\18\bin' -BackupDir 'C:\FormationBackups'
.\database\windows\restore-test.ps1 -PostgresBin 'C:\Program Files\PostgreSQL\18\bin' -BackupFile 'C:\FormationBackups\formation_inspection_YYYYMMDD_HHMMSS.dump'
~~~

복구 연습은 새로운 formation_restore_test_* DB에만 복원하며 운영 DB를 건드리지 않습니다. 백업 파일은 VM 밖의 회사 승인 저장소에도 보관하고, 주기적으로 복구 연습을 하세요. 실제 운영 DB를 복원할 때에는 별도의 중단·승인 절차가 필요합니다.

## 웹페이지와 API 실행

PostgreSQL에 제출·조회하는 앱 서버는 프로젝트의 server 폴더에 구현되어 있습니다. Formation-VM-App.zip에는 화면, 앱 서버, pg 드라이버와 이 DB 설치 파일이 함께 들어 있습니다. 상위 폴더의 VM-APP.ko.md를 따라 암호를 설정하고 앱을 실행하세요. 현재 로컬 PC에서 14종 양식과 사진 저장·조회를 검증했습니다. 실제 VM 설치와 상시 운영용 서비스, 로그인 권한, HTTPS는 회사 VM 환경에서 적용해야 합니다. 공개 ChatGPT Sites 링크와 회사 내부 DB는 직접 동기화되지 않습니다.

과거 기록을 이전할 때는 각 Google Sheet의 실제 헤더·행과 브라우저 localStorage 내보내기 파일을 확인한 후 source_key를 부여해 가져옵니다. 현재 스키마 생성은 이전 기록을 변경하지 않습니다.
