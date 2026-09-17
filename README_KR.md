# OBS Tally v1.5.10

SunjooAN이 유지보수하는 OBS/vMix/ATEM 무선 탈리 프로젝트입니다.
Windows Hub, 현재 ESP8266/NodeMCU V3, 초기 NodeMCU Lua 리스너를 지원합니다.

## 실행 및 다운로드

- [전체 Windows 실행 패키지](https://github.com/sunjoo1968-design/OBS-tally/releases/download/v1.5.10/OBS-tally-v1.5.10-runtime.zip)
- [펌웨어 전용 패키지](https://github.com/sunjoo1968-design/OBS-tally/releases/download/v1.5.10/OBS-tally-v1.5.10-firmware.zip)
- [릴리즈 안내](release/README_v1.5.10.md)

ZIP을 풀고 `vtally-web.exe`를 실행합니다. 웹 주소는 `http://localhost:3000/`입니다.
같이 제공되는 `firmware/` 폴더를 실행 파일 옆에 유지합니다.
Windows x64에서는 별도 Java/Node/.NET 설치가 필요하지 않습니다.
이 작업 폴더의 실행 위치는 `release/v1.5.10/vtally-web.exe`입니다.

기존 Hub를 먼저 종료하고 실제 `wifi-tally.json`, `vtally-web-options.json`을 백업한 뒤 교체합니다.
기존 실제 설정은 v1.5.10 실행 폴더에 보존하고 Git/ZIP에는 포함하지 않습니다.
배포 ZIP에는 샘플 설정만 있습니다. Windows 자동 시작은 새 실행 위치에서 트레이 메뉴로 설정합니다.

## 유지한 기능

- OBS v5 장면·그룹·소스 탈리, 컬렉션 교체 중 요청 중지, 제한 시간·재연결·이벤트 병합
- vMix Mix2가 메인 PGM/PVW에 표시될 때만 내부 탈리 반영, ATEM 지원
- 채널 AND/OR 지정과 재부팅 후 복원, 웹 리스너, Windows 트레이 실행
- 로컬 PC의 FIRMWARE 탭에서 보드별 설치 및 레거시 INI 설정
- 기존 핀 배치와 STL 케이스 모델

## 리스너 개선

- UDP 형식·RGB·Hub IP/포트 검증, 정상 패킷만 연결 생존 갱신
- 반복 패킷에도 깜박임 위상 유지, 식별/미확인/노랑/자홍 표시 수정
- WiFi 단절·IP 변경 시 이전 표시 해제 및 UDP 재바인딩/실패 재시도
- 버튼 조작 중 통신 유지, 비차단 수동 포털, WiFi 저장 전 이전 표시 해제
- EEPROM 문자열/CRC 검증, 최신 WiFi 설정 동기화, LED/OLED 불필요한 갱신 감소
- 레거시 타이머 순환·재접속 타이머 누적·로그 실패 재귀/유실·INI 파싱 개선

**리스너마다 새 펌웨어를 기록해야 적용됩니다.** Hub 교체만으로 자동 업데이트되지 않습니다.
웹 플래시는 보드 설정을 초기화하므로 WiFi/Hub/이름/밝기/레거시 INI 값을 먼저 확인하고 입력합니다.
레거시는 설정-only가 아닌 전체 재설치를 선택해야 새 `.lc`가 설치됩니다.
V3 Arduino 대상은 Lua 런타임을 교체하므로 초기 레거시 대상과 구분합니다.

## 폴더 정리 기준

v1.5.10 소스·테스트·필수 펌웨어·빌드 스크립트·문서·STL·라이선스만 보존합니다.
이전 버전 배포물, 중복 원본/바이너리, 임시 컴파일러/캐시/빌드 결과는 제거합니다.
레거시 수정 소스는 `source/Legacy_NodeMCU_Listener/src`, 배포 펌웨어는 `source/hub/firmware`가 기준입니다.
실행 패키지는 GitHub Releases에, 펌웨어와 STL은 Git LFS에 저장합니다.
Git 이력과 이전 GitHub 릴리즈는 복구 기록으로 유지하며 삭제하지 않습니다.

## 검증 및 빌드

Hub 250 tests 통과(기존 제외 1개), 실행 패키지 smoke 5개 통과.
실제 Arduino 소스의 hardware mock 32 assertions, 레거시 소스/컴파일 결과 각각 89 assertions 통과.
프로토콜 반복 검사, 펌웨어 marker, 기본 이미지 보존 및 ZIP 해시도 확인했습니다.
실제 보드·전원·무선 환경·장시간 방송은 예비 보드에서 추가 검증해야 합니다.

- [빌드 방법](docs/BUILD_v1.5.10.md)
- [OBS 안정성 검토](docs/OBS_STABILITY_REVIEW_v1.5.10.md)
- [리스너 안정성 검토](docs/LISTENER_STABILITY_REVIEW_v1.5.10.md)

웹 관리는 신뢰할 수 있는 LAN에서만 사용하고 인터넷에 포트를 공개하지 않습니다.
OBS WebSocket 인증을 활성화합니다. 기존 의존성의 보안 이슈 전체를 해결한 버전은 아닙니다.

## 라이선스

MIT wifi-tally 프로젝트(Copyright (c) 2020 dev at xopn.de)를 기반으로 합니다.
원 저작권/라이선스는 [LICENSE](LICENSE), 레거시 출처는 [UPSTREAM.md](source/Legacy_NodeMCU_Listener/UPSTREAM.md)에 보존합니다.
