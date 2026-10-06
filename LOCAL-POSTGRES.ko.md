# 내 PC에서 Formation DB 구조 보기

PostgreSQL 18.6과 pgAdmin 4가 현재 PC에 설치되어 있습니다. Windows 서비스 이름은 postgresql-x64-18이며, DB는 127.0.0.1:5432에서만 접속을 받습니다. 데이터베이스 이름은 formation_inspection입니다. 로컬 웹앱의 신규 기록은 이 DB에 저장됩니다. 기존 Google Sheet·Drive와 브라우저 기록은 아직 가져오지 않았습니다.

## 웹페이지에서 입력 테스트

PowerShell에서 아래 명령을 실행하고 창을 열어 둔 뒤 http://127.0.0.1:3000/formation.html 에 접속하세요.

~~~powershell
& 'C:\Users\heeseong_n\Desktop\Formation\scripts\start-local-server.ps1'
~~~

프로젝트 폴더의 Start-Formation.cmd를 더블클릭해도 실행할 수 있습니다. 14종 양식의 제출·조회와 새 사진은 PostgreSQL을 사용합니다. 서버 종료는 실행 창에서 Ctrl+C를 누릅니다. 자세한 VM 실행 절차는 VM-APP.ko.md에 있습니다.
## 바로 테이블 목록 보기

프로젝트 폴더에서 PowerShell을 열고 실행하세요.

~~~powershell
.\scripts\local-postgres.ps1 -Action Tables
~~~

SQL 명령으로 상세 구조를 볼 때는 다음을 실행합니다.

~~~powershell
.\scripts\local-postgres.ps1 -Action Shell
~~~

연결된 화면에서 \dt formation.* 는 테이블 목록, \d formation.startup_checks 는 특정 테이블의 칼럼과 제약 조건을 보여줍니다. \q 를 입력하면 나옵니다.

## pgAdmin 화면에서 보기

이 PC의 pgAdmin에는 `Formation Local` 연결을 등록해 두었습니다. pgAdmin을 이미 열어 둔 상태였다면 화면을 새로고침하거나 다시 열어 왼쪽 `Servers`에서 확인하세요.

1. `Formation Local`을 클릭합니다.
2. 암호 입력 창이 뜨면 PowerShell에서 아래 명령을 실행합니다. 현재 폴더와 관계없이 실행할 수 있습니다.

~~~powershell
& 'C:\Users\heeseong_n\Desktop\Formation\scripts\local-postgres.ps1' -Action CopyAppPassword
~~~

3. 복사된 암호를 pgAdmin에 붙여넣고 연결합니다. PowerShell로 돌아와 Enter를 누르면 클립보드가 지워집니다.
4. 왼쪽에서 `Servers → Formation Local → Databases → formation_inspection → Schemas → formation → Tables`를 펼칩니다. 현재 테이블은 10개입니다. 원하는 테이블 아래의 `Columns`를 펼치면 칼럼 구성을 볼 수 있습니다.

연결 정보는 `127.0.0.1:5432`, 데이터베이스 `formation_inspection`, 사용자 `formation_app`입니다. 암호는 pgAdmin 연결 정의에 저장하지 않았습니다.

formation_app 계정은 기록 조회와 추가만 할 수 있습니다. 스키마 변경이나 삭제 권한은 없습니다. 암호는 현재 Windows 사용자 프로필에 암호화되어 있고 프로젝트 파일이나 대화에 저장되지 않았습니다.

## 양식과 테이블의 관계

| 화면 | 테이블 |
| --- | --- |
| Appearance: Before HPCD / Jig Formation / Degas | appearance_inspections |
| Appearance 사진 | appearance_photos |
| HTA 온도 | hta_readings |
| 영역별 온도 (CDC, PLT, DGS, EOL, JIG, PRA, RTA, SHA) | temperature_readings |
| EOL Tape/Knife Maintenance | eol_maintenance |
| Conductive Rubber Maintenance | conductive_maintenance |
| Start-up: HPCD / Jig / Degas / CDC / EOL / Selector | startup_checks와 startup_check_items |
| Resealing Machine | resealing_checks |
| DSF Daily IP | ip_checks와 ip_measurements |

~~~mermaid
erDiagram
    appearance_inspections ||--o| appearance_photos : "사진 0~1개"
    startup_checks ||--|{ startup_check_items : "점검 항목 여러 개"
    ip_checks ||--|{ ip_measurements : "측정 항목 여러 개"
~~~

이 PC에는 VM용으로 준비한 database/001_initial.sql을 그대로 적용했습니다. 같은 스키마를 VM에도 설치할 수 있습니다. 현재 공개된 ChatGPT 검토 사이트와 이 로컬 DB는 연결되어 있지 않습니다.

## VM에 옮길 준비 파일

이 PC의 Downloads 폴더에 공식 서명이 유효한 postgresql-18.6-4-windows-x64.exe가 있습니다. 프로젝트 폴더에는 화면·API·DB 설치 파일이 포함된 Formation-VM-App.zip이 있습니다. VM-APP.ko.md를 따라 PostgreSQL 설치 파일과 Node.js 설치 파일을 함께 준비하세요.

로컬 DB의 첫 백업은 현재 Windows 사용자 프로필의 AppData\Local\FormationInspection\Backups 폴더에 생성했습니다. 첫 백업에는 생성 시점의 빈 테이블 구조가 들어 있습니다. 신규 기록을 입력한 뒤에는 백업을 다시 만들어야 합니다.

스키마 수정 등 관리자 작업이 필요하면 .\scripts\local-postgres.ps1 -Action CopyAdminPassword로 postgres 관리자 암호를 같은 방식으로 복사할 수 있습니다. 평소 구조 확인에는 formation_app 계정을 사용하세요.
