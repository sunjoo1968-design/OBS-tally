# OBS Tally v1.5.6 Release

## 포함 파일

- `vtally-web.exe`
- `firmware/ESP8266_vTally_Listener.bin`
- `firmware/esptool.exe`
- `firmware/legacy-nodemcu/*`
- `wifi-tally.sample.json` 샘플 설정

## 실행 방법

1. 압축을 풀고 `vtally-web.exe`를 실행합니다.
2. 브라우저가 자동으로 열리지 않으면 `http://localhost:3000/`에 접속합니다.
3. 기존 v1.5.x 리스너는 `FIRMWARE` 탭에서 `Current v1.5.x ESP8266 Listener`를 선택합니다.
4. 초기 NodeMCU 리스너는 `Legacy NodeMCU Listener`를 선택합니다.

## v1.5.6 변경 사항

- OBS `always` 모드에서는 불필요한 스트림/녹화 상태 요청을 보내지 않도록 변경했습니다.
- OBS 스트림/녹화 연동 모드에서도 선택한 모드에 필요한 출력 상태만 조회하여 OBS 32.2.2의 `GetOutputStatus` 크래시 경로 노출을 줄였습니다.
- 기존 v1.5.5 Mix2 tally 동작은 유지했습니다.
- 현재 v1.5.x ESP8266 리스너 펌웨어는 기본값으로 그대로 사용합니다.
- 초기 NodeMCU 리스너용 설정 업로드 기능을 추가했습니다.
- Hub IP 또는 WiFi가 바뀐 경우 `Update IP/WiFi settings only`로 `tally-settings.ini`만 다시 업로드할 수 있습니다.
- 레거시 설정에서 Operator/Stage WS2812 LED 개수(각 0~10), GRB/RGB 색상 순서와 RGB LED 타입을 지정할 수 있습니다.
- Hub IP는 Hub PC의 LAN/WiFi IPv4 주소가 자동 입력되며 필요하면 수동 수정할 수 있습니다.
- vMix 재접속, 비연속 입력 번호, UDP 오류 복구와 장시간 로그 메모리 사용을 안정화했습니다.
- 빈 보드 또는 초기화가 필요한 보드는 `Erase and reinstall legacy firmware`로 NodeMCU 기본 펌웨어와 Lua/LC 프로그램 파일을 다시 설치할 수 있습니다.
- 웹 상단 버전 표기를 `V1.5.6`으로 갱신했습니다.

## 주의

레거시 NodeMCU 리스너는 밝기와 Idle Color 값을 사용하지 않습니다. 필요한 값은 WiFi SSID, WiFi Password, Hub IP, Hub Port, Tally Name입니다.
