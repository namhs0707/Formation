# Formation 웹앱과 PostgreSQL 실행 안내

현재 구조는 **브라우저 → 앱 서버 → PostgreSQL**입니다. 화면에서 제출하면 앱 서버가 데이터를 검사하고 PostgreSQL 저장이 완료된 뒤 성공을 응답합니다. 사진도 formation.appearance_photos에 저장되므로 DB 백업에 함께 포함됩니다.

## 내 PC에서 테스트

PowerShell에서 아래 명령을 실행한 채 창을 열어 두세요. 현재 폴더와 관계없이 실행할 수 있습니다.

~~~powershell
& 'C:\Users\heeseong_n\Desktop\Formation\scripts\start-local-server.ps1'
~~~

브라우저에서 http://127.0.0.1:3000/formation.html 을 엽니다. HTML 파일을 직접 더블클릭해서 열면 API가 실행되지 않습니다. 기존 공개 검토 링크도 이 로컬 DB에 연결되어 있지 않습니다.

모든 14종 양식의 신규 제출과 조회는 formation_inspection DB를 사용합니다. pgAdmin에서 해당 테이블을 우클릭하고 View/Edit Data → All Rows로 기록을 확인할 수 있습니다. Start-up과 IP는 제출 1건과 그 안의 상세 항목이 각각 부모·자식 테이블에 저장됩니다. Start-up, Resealing, IP 화면은 최근 제출 1,000건을 표시합니다.

서버를 종료하려면 실행 중인 PowerShell 창에서 Ctrl+C를 누릅니다. PostgreSQL Windows 서비스와 기록은 계속 유지됩니다.

## Windows Server 2022 VM에 옮기기

VM으로 옮길 파일은 Formation-VM-App.zip, PostgreSQL Windows x64 설치 파일, 회사에서 승인한 Node.js LTS Windows x64 설치 파일입니다. 앱 ZIP에는 pg 드라이버와 실행에 필요한 의존성이 포함되어 있으므로 VM에서 npm 다운로드를 할 필요가 없습니다. Node.js 공식 설치 파일은 https://nodejs.org/en/download 에서 준비합니다. 이 PC에서 검증한 Node 버전은 22.23.2입니다.

1. VM에 PostgreSQL과 Node.js를 직접 설치합니다.
2. Formation-VM-App.zip을 C:\FormationInspection에 압축 해제합니다. server, public, scripts, node_modules, database 폴더가 바로 그 아래에 있어야 합니다.
3. database\README.ko.md의 절차대로 formation_app 계정, formation_inspection DB와 테이블을 만듭니다.
4. 앱을 실행할 Windows 사용자 계정으로 다음 명령을 실행하고 DB 설정 때 정한 formation_app 암호를 입력합니다.

~~~powershell
& 'C:\FormationInspection\scripts\save-vm-app-password.ps1'
~~~

5. 같은 Windows 사용자 계정으로 앱 서버를 시작합니다.

~~~powershell
& 'C:\FormationInspection\scripts\start-vm-server.ps1'
~~~

6. VM 안에서는 http://127.0.0.1:3000/formation.html, 팀원 PC에서는 http://VM호스트이름:3000/formation.html 로 접속합니다. 회사 IT가 앱 포트 3000을 필요한 내부망에만 허용해야 합니다. PostgreSQL 포트 5432는 VM 안에서만 사용합니다.

암호 파일은 VM의 현재 Windows 사용자 프로필에 Windows 암호화 방식으로 저장됩니다. 다른 PC나 다른 Windows 계정으로 복사하면 해독되지 않으므로 그 계정에서 다시 암호를 입력해야 합니다. ZIP에는 이 PC의 DB 암호나 기록이 포함되지 않습니다.

현재 실행 스크립트는 수동으로 앱을 시작합니다. 상시 운영 시에는 회사 IT가 같은 실행 계정을 사용하는 Windows 서비스 또는 작업 스케줄러, 내부 HTTPS, 접근 권한 정책을 적용해야 합니다. 앱 자체의 사용자 로그인·권한 구분은 아직 없습니다.

## 저장 대상

| 양식 | PostgreSQL 테이블 |
| --- | --- |
| Appearance: Before HPCD / Jig Formation / Degas | appearance_inspections, appearance_photos |
| HTA | hta_readings |
| Area Temperature (CDC, PLT, DGS, EOL, JIG, PRA, RTA, SHA) | temperature_readings |
| EOL Tape/Knife | eol_maintenance |
| Conductive Rubber | conductive_maintenance |
| Start-up: HPCD / Jig / Degas / CDC / EOL / Selector | startup_checks, startup_check_items |
| Resealing Machine | resealing_checks |
| DSF Daily IP | ip_checks, ip_measurements |

새 버전은 Google Sheet와 Google Drive에 새 데이터를 보내지 않습니다. 기존 Sheet·Drive 기록과 브라우저 로컬 저장 기록은 그대로 남아 있으며 아직 PostgreSQL에 가져오지 않았습니다.

## 확인한 테스트

별도 테스트 DB에서 14종 양식 제출·재조회, 사진 저장·조회, 잘못된 입력 거절과 트랜잭션 롤백을 확인했습니다. 브라우저에서도 Appearance, Start-up, Resealing, IP 입력·저장·화면 재조회가 동작했습니다. 테스트 기록은 실제 formation_inspection DB에 넣지 않았습니다.
