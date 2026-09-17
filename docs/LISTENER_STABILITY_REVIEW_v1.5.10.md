# v1.5.10 리스너 안정성 검토

검토/빌드: 2026-09-17. 대상은 현재 ESP8266, NodeMCU Lua WiFi V3 Arduino,
초기 NodeMCU Lua/LC 리스너입니다. 하드웨어 배선과 UDP 명령 형식은 유지했습니다.
Hub의 OBS/vMix 동작은 v1.5.9 그대로이며 버전 표시·패키지만 갱신합니다.

## 발견 문제와 수정

| 대상 | 기존 문제 | 수정 |
| --- | --- | --- |
| Arduino | 식별 흰색·미확인 파랑·노랑/자홍을 idle로 오판 | 명시적 idle 판별, flash 먼저 처리, 색상/표시 분류 보완 |
| Arduino | 반복 패킷마다 flash 시작점 재설정 | 명령 비교, 바뀐 명령만 위상 초기화, 전용 unsigned 시간 계산 |
| 공통 | 불완전·범위 초과·임의 발신 UDP 수신 | 숫자/RGB/hex/시간 검증, 정상 패킷만 생존 시간 갱신, Hub IP/포트 확인 |
| Arduino | UDP String 누적/매번 LED/OLED/로그 출력 | 64바이트 수신 버퍼, 루프당 최대 8개 패킷, 동일 색상 출력 생략, OLED 제한 |
| Arduino | 버튼 홀드 동안 처리 중단·설정 포털 대기 | 통신 루프 유지, 수동 포털 비차단, WiFi 저장 전 상태 해제, 연결 대기 10초 설정 |
| Arduino | WiFi 단절/IP 변경·UDP bind 실패 복구 부족 | 상태 해제, 소켓 재바인딩, 1초 bind 재시도, 연결 즉시 등록 |
| Arduino | EEPROM 문자열/데이터 손상 및 불필요한 부팅 저장 | NUL/값 검증, 기존 Config 뒤 CRC 추가, 지운 CRC 슬롯의 이전 설정 허용, 저장 실패 로그 |
| Arduino | 포털 WiFi 변경 후 옛 자격정보 재사용 | WiFi 저장 콜백 후 SDK의 최신 SSID/password를 Config에 동기화 |
| 레거시 | 잘못된 패킷도 생존 갱신, 32비트 타이머 가정 | 유효한 패킷만 갱신, 31비트 순환 계산, 만료 시간 폐기 |
| 레거시 | WiFi 재연결 타이머 누적·오래된 UDP 소켓 | 단일 재사용 타이머, 수동 종료 시 취소, 새 IP에서 새 소켓, bind 재시도 |
| 레거시 | 전송 실패 로그 재귀와 버퍼 로그 유실 | send 내부 네트워크 로깅 제거, 실패 기록 재보관, 10개/80바이트 제한 유지 |
| 레거시 | INI 숫자/형식/빈 암호/등호 처리 불안정 | IPv4/port/정수 LED 개수 검증, GRB/RGB 대소문자, 빈 암호/암호 내 등호 지원 |

레거시 WS2812 개수는 기존 웹/하드웨어 계약대로 operator/stage 각각 0~10입니다.
Arduino 고정 개수는 앞 8개 + 뒤 8개입니다. 레거시 PWM 핀과 D4 스트립 순서도 유지했습니다.

## 검증

- C++ 프로토콜/색상/flash/CRC: 20,092 assertions 통과. 10,000회 동일 명령 처리의 반복 비교가 포함되므로 독립 테스트 사례 20,092개라는 뜻은 아닙니다.
- 실제 `.ino`를 하드웨어 mock과 함께 컴파일한 동작 검사: 32 assertions 통과. EEPROM 이전 형식/손상, 중복 flash, 색상, 패킷 한도/발신자, timeout, WiFi/IP/bind 복구, 버튼 중 통신, 포털 저장 전 해제, 값 검증, millis 순환을 검사했습니다.
- 레거시 소스와 실제 NodeMCU `.lc` 출력 각각 89 assertions 통과. 잘못된 패킷/timeout/31비트 순환, 발신자, UDP 실패/복구, 100회 WiFi 이벤트, 수동 종료, INI, 10,000회 LED 중복, flash 위상, 로그 제한과 7개 모듈 동시 시작을 검사했습니다.
- Hub 기존 회귀: 25 suites, 250 tests 통과, 기존 제외 1개.
- ESP8266 core 3.1.2 / `esp8266:esp8266:nodemcuv2` / 4MB DIO / 80MHz 실제 컴파일 성공.
- 바이너리 검사: Arduino 2개 이미지의 버전과 Hub patch marker 각 10개 단일 위치/NUL 종료 확인. 레거시 `.lc` 7개 및 init 확인.
- 기존 레거시 기본 이미지 SHA256 `566bdb85ff566da9a7b8e384d84716017e892fac7fbcefaff6571436c5f52d40` 유지.
- Windows backend/frontend/pkg/.NET 빌드 성공. 실제 패키지의 OBS v5(MessagePack) 연결, 500개 이벤트 병합, 컬렉션 교체, 소켓 단절 재접속, 설정 복원 smoke 5개 통과.

빌드 메모리: RAM 32,244/80,192 bytes(40%), IRAM 61,255/65,536 bytes(93%, 캐시 포함), flash code 344,900/1,048,576 bytes(32%).
기존 .NET WebRequest 사용 경고와 NuGet 취약성 조회 실패 경고는 남아 있습니다. 컴파일은 성공했지만 NuGet 취약성 온라인 점검을 완료한 것은 아닙니다.

현재/V3는 동일 소스·동일 보드 프로파일이므로 같은 바이너리를 두 이름으로 제공합니다.
레거시는 공식 NodeMCU 전용 컴파일러로 재컴파일했고 기본 펌웨어/하드웨어 API는 교체하지 않았습니다.

## 실무 적용과 제한

1. 방송 외 시간에 기존 Hub 설정 및 각 리스너의 WiFi/Hub/이름/밝기/레거시 INI 값을 기록합니다.
2. v1.5.10 Windows 패키지를 실행합니다. Hub 변경만으로 리스너가 자동 업데이트되지는 않습니다.
3. 각 보드에 맞는 FIRMWARE target으로 새 펌웨어를 설치합니다. 기존 워크플로는 erase를 수행하므로 필요한 값을 먼저 입력합니다.
4. 레거시는 전체 재설치를 선택해야 `.lc`가 바뀝니다. 설정만 업데이트하는 모드는 프로그램 패치를 적용하지 않습니다.
5. 전원 재부팅, 라우터 재연결, Hub 중지/재시작, PGM/PVW, 식별, OBS 단절, Mix2를 실제 보드에서 확인합니다.
6. 예비 보드 한 대에 먼저 적용하고 충분한 연속 운용 후 나머지로 확장합니다. 작업 폴더에는 현재 버전만 유지하며 이전 배포는 GitHub 릴리즈/이력에서 확인합니다.

물리 보드 기록/광량/전원/실제 WiFi 끊김/장시간 방송은 이번 환경에서 시험하지 않았습니다.
호스트 mock은 MCU SDK/무선 환경을 완전히 재현하지 못합니다. UDP는 무응답 전송이므로 send 성공은 수신 보장이 아닙니다.
정상 패킷 미수신 시 Arduino는 3초 초과에, 레거시는 3초 초과와 최대 1초 검사 주기에 미확인 표시로 전환합니다.
설정 포털의 루프는 비차단이지만 WiFiManager가 WiFi 저장 시 내부적으로 대기할 수 있습니다. 대기 전에 이전 탈리를 지웁니다.
CRC는 설정 손상을 검출하여 펌웨어 기본값으로 돌아가는 방식이며 전원 차단 중 원자적 저장/자동 복구를 보장하지 않습니다.
OLED buffer 할당 실패는 우회하지만 물리적인 I2C 오류/없음을 완전히 검출하는 것은 아닙니다.
현재 IRAM 사용은 약 93%(캐시 예약 32KB 포함)로 여유가 작습니다. 클럭/캐시/전원 조건은 변경하지 않았습니다.

## 근거와 재현

- [ESP8266 WiFi auto-reconnect API](https://arduino-esp8266.readthedocs.io/en/3.1.2/esp8266wifi/station-class.html)
- [NodeMCU tmr.now: 31비트 microsecond 순환](https://nodemcu.readthedocs.io/en/release/modules/tmr/#tmrnow)
- [NodeMCU 컴파일/교차 컴파일 안내](https://nodemcu.readthedocs.io/en/dev/compiling/)
- [적용한 NodeMCU 2020 소스](https://github.com/nodemcu/nodemcu-firmware/tree/3.0-master_20200610)

`scripts/build-listeners.ps1`은 native 회귀 검사, Arduino 빌드, NodeMCU 호환성 검사,
`.lc` 실행 검사와 patch marker 검증을 수행한 후 배포용 펌웨어를 복사합니다. COM 포트에는 접근하지 않습니다.
배포 펌웨어의 원본 위치는 `source/hub/firmware` 하나로 통합했습니다. 레거시 수정 소스는 `source/Legacy_NodeMCU_Listener/src`입니다.
전용 컴파일러의 host-test metatable 오타 보완은 레거시 README에 설명했습니다.
`.build-tools/`와 `.listener-build/`는 로컬 도구/중간 파일이며 Git과 실행 ZIP에서 제외합니다.
