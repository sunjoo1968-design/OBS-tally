# OBS Tally v1.5.10 Release

## 주요 변경

현재 ESP8266/NodeMCU V3 및 초기 NodeMCU Lua 리스너의 방송 안정성 패치입니다.
하드웨어 배선, 레거시 기본 펌웨어, OBS/vMix Hub 핵심 로직은 v1.5.9에서 유지했습니다.

- 잘못된 UDP/외부 송신자가 연결 상태를 연장하지 않도록 검증합니다.
- 반복 명령에 깜박임 위상을 유지하고 식별·미확인·노랑/자홍 표시를 수정합니다.
- WiFi/IP/UDP 재연결, 버튼 중 통신, 비차단 수동 설정 포털을 보완합니다.
- 동일 LED 출력 생략, OLED 갱신 제한, EEPROM CRC/문자열 검증을 적용합니다.
- 레거시 타이머 순환/누적과 로그 실패 재귀/유실을 수정하고 INI 파싱을 강화합니다.

## 설치

1. 방송 외 시간에 기존 Hub를 종료하고 `wifi-tally.json`, `vtally-web-options.json`을 백업합니다.
2. runtime ZIP을 새 폴더에 풀고 기존 설정을 가져온 뒤 `vtally-web.exe`를 실행합니다.
3. `http://localhost:3000/`에서 `V1.5.10`을 확인합니다. 같은 Hub를 동시에 실행하지 않습니다.
4. 각 리스너의 WiFi/Hub IP/이름/밝기를 확인하고 FIRMWARE 탭에 입력한 뒤 대상별로 설치합니다.
5. 레거시는 INI 전체 값을 기록한 후 `Erase and reinstall legacy firmware`로 설치합니다.
6. 예비 보드부터 재부팅/PGM/PVW/식별/Hub 단절/네트워크 복구를 확인하고 방송에 적용합니다.

**중요:** 실행 파일 교체만으로 리스너 패치는 적용되지 않습니다.
기존 웹 플래시는 설정을 초기화합니다. 레거시 설정-only 모드는 새 `.lc` 파일을 설치하지 않습니다.
`wifi-tally.sample.json`은 참고용이며 기존 설정 파일을 덮어쓰지 않습니다.
NodeMCU V3 Arduino 대상은 Lua 런타임을 교체하므로 초기 레거시 보드와 구분합니다.
bare `.bin`은 기본 Hub/WiFi 값이 비어 있습니다. 웹 플래시는 입력 값을 패치하며, 직접 기록 시 설정 AP를 사용합니다.

## 파일

- `vtally-web.exe`: Windows x64 독립 실행 Hub, 별도 Node/.NET 설치 불필요
- `firmware/ESP8266_vTally_Listener.bin`: 현재 Arduino 리스너
- `firmware/NodeMCU_V3_vTally_Listener.bin`: 같은 펌웨어의 V3 대상 이름
- `firmware/esptool.exe`
- `firmware/legacy-nodemcu/`: 변경하지 않은 base `.bin`, 재빌드한 7개 `.lc`, `init.lua`
- `wifi-tally.sample.json`
- `README_v1.5.10.md`, `LISTENER_STABILITY_REVIEW_v1.5.10.md`, `OBS_STABILITY_REVIEW_v1.5.10.md`, `BUILD_v1.5.10.md`, `SHA256SUMS.txt`

runtime ZIP은 위 파일 전체를 포함합니다. firmware ZIP은 펌웨어 폴더와 문서/해시만 포함합니다.
작업 폴더에는 v1.5.10 배포물만 유지합니다. 소스·펌웨어는 저장소에서, 실행 ZIP은 GitHub Releases에서 제공합니다.
실제 PC 설정은 공개하지 않으며 패키지에는 샘플 설정만 포함합니다.

## 검증

프로토콜/색상/flash/CRC 20,092 assertions(반복 비교 포함), 실제 Arduino 소스 mock 검사 32 assertions,
레거시 소스/컴파일 결과 각각 89 assertions 및 Hub 250 tests 통과(기존 제외 1개).
Arduino/NodeMCU 전용 compiler 및 Windows backend/frontend/pkg/.NET 빌드에 성공했습니다.
실행 패키지의 OBS v5 연결·이벤트 폭주·컬렉션 교체·재접속·설정 복원 smoke 5개도 통과했습니다.

실제 하드웨어/광량/전원 품질/장시간 방송은 별도 검증이 필요합니다.
상세 제한과 점검 범위는 함께 포함된 리스너 안정성 보고서를 참고합니다.

## 정리된 작업 폴더

실행 위치는 `release/v1.5.10/vtally-web.exe`입니다. 기존 실제 `wifi-tally.json`은
같은 v1.5.10 폴더로 보존하며 Git/배포 ZIP에서는 제외합니다.
이전 버전 파일과 빌드 캐시는 제거했습니다. Git 이력과 기존 GitHub 릴리즈는 복구 기록으로 유지합니다.
