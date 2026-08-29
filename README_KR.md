# wifi-vtally-v1.5.6

vTally Hub와 ESP8266 탈리 리스너를 함께 정리한 Windows 실행 패키지입니다.

원격 저장소: [sunjoo1968-design/OBS-tally](https://github.com/sunjoo1968-design/OBS-tally)

## v1.5.6 변경 이력

- 현재 v1.5.x ESP8266 리스너 펌웨어 동작은 유지하면서 초기 NodeMCU 리스너 지원을 추가했습니다.
- 웹 `FIRMWARE` 탭에서 `Current v1.5.x ESP8266 Listener`와 `Legacy NodeMCU Listener`를 선택할 수 있습니다.
- 초기 NodeMCU 리스너는 IP/WiFi 변경 시 전체 재설치 없이 `tally-settings.ini`만 다시 업로드할 수 있습니다.
- 레거시 설정 화면에서 Operator/Stage RGB LED 타입과 WS2812 개수(각 0~10), GRB/RGB 색상 순서를 설정할 수 있습니다.
- 펌웨어 화면의 Hub IP는 현재 Hub PC의 물리 LAN/WiFi IPv4로 자동 입력되며 수동 수정도 가능합니다.
- 펌웨어 관리 API는 Hub PC 로컬 접속으로 제한하고 동시 플래시 요청을 차단했습니다.
- vMix 정상 연결 종료 후 재접속, 비연속 입력 번호, 빈 입력 XML, UDP 오류 복구와 로그 메모리 누적 문제를 개선했습니다.
- 빈 보드나 초기화가 필요한 보드는 `Erase and reinstall legacy firmware`로 NodeMCU 기본 펌웨어와 Lua/LC 파일을 다시 설치할 수 있습니다.
- 웹 상단 버전 표기를 `V1.5.6`으로 갱신했습니다.

## v1.5.5 변경 이력

- vMix Mix2 내부 PGM 소스가 Mix2가 메인 PGM/PVW에 없을 때도 tally로 반영되던 문제를 수정했습니다.
- Mix2 입력 자체가 vMix 메인 PGM에 있을 때만 Mix2 내부 PGM 소스를 적색으로 반영합니다.
- Mix2 입력 자체가 vMix 메인 PVW에 있을 때는 Mix2 내부 PGM 소스를 녹색으로 반영합니다.
- Mix2 입력이 메인 PGM/PVW 어디에도 없으면 Mix2 내부 PGM/PVW 소스를 tally 상태에 반영하지 않습니다.
- 웹 상단 버전 표기를 `V1.5.5`로 갱신했습니다.

## v1.5.0 변경 이력

- vMix 선택 시 Mix2 내부 소스 전환이 탈리 리스너에 늦게 반영되던 문제를 개선했습니다.
- vMix Mix 입력 상태 XML 조회 주기를 1초에서 250ms로 줄였습니다.
- vMix `TALLY OK` 이벤트 수신 직후 Mix 입력 상태를 재조회해 반응 시간을 단축했습니다.
- vMix TCP 응답을 버퍼링해 XML/명령이 조각나 들어와도 완성된 명령 단위로 처리하도록 안정화했습니다.
- vMix 재연결 시 기존 socket을 재사용하지 않고 새 socket으로 연결해 장애 복구 안정성을 높였습니다.
- `vmix-mix-debug.json` 파일은 `VTALLY_VMIX_DEBUG=true`일 때만 생성하도록 바꿔 평상시 디스크 I/O를 줄였습니다.
- 웹 상단에 `made by SunjooAN`과 `V1.5.0` 표기를 추가했습니다.

## 바로 실행

`release\vtally-web.exe`를 실행하면 됩니다.

같은 폴더에 `release\firmware` 폴더가 있어야 웹의 `FIRMWARE` 탭에서 ESP8266 펌웨어 기록 기능을 사용할 수 있습니다.

필요 파일:

- `release\vtally-web.exe`
- `release\firmware\ESP8266_vTally_Listener.bin`
- `release\firmware\esptool.exe`
- `release\firmware\legacy-nodemcu\*`

Windows 11에서는 별도 Java/Node/.NET 설치 없이 실행되도록 구성했습니다.

실행 후 브라우저에서 `http://localhost:3000/`으로 접속하면 됩니다.

## 웹 기능

- `TALLIES`: 탈리 카드 관리
- `CONFIGURATION`: OBS, vMix, ATEM 설정
- `FIRMWARE`: 현재 ESP8266 리스너 펌웨어 기록, 초기 NodeMCU 리스너 설정/재설치

펌웨어 탭에서 입력 가능한 값:

- COM Port
- WiFi SSID / Password
- 설정용 AP 이름
- Hub IP / Port
- Tally Name
- Front / Operator / Idle 밝기
- Idle Color

밝기는 `1`, `16`, `32`, `64`, `128`, `255`의 6단계 선택 방식입니다.

초기 NodeMCU 리스너는 밝기/Idle Color 항목을 사용하지 않습니다. IP 또는 WiFi만 바뀌었을 때는 `Legacy NodeMCU Listener`와 `Update IP/WiFi settings only`를 선택해 설정 파일만 다시 올리면 됩니다.

## 소스 구조

- `source\hub`: Hub 앱 소스
- `source\hub\tray-launcher`: Windows 트레이 실행기 소스
- `source\hub\firmware`: ESP8266 펌웨어 bin
- `source\hub\firmware\esptool.exe`: 펌웨어 기록 도구
- `source\ESP8266_vTally_Listener`: Arduino ESP8266 리스너 소스
- `source\Legacy_NodeMCU_Listener`: 초기 NodeMCU 리스너 펌웨어, 원본 Lua 소스와 테스트
- `config\wifi-tally.sample.json`: 새 PC용 샘플 설정

## 다시 빌드할 때

Hub 소스 폴더:

```powershell
cd source\hub
npm install --legacy-peer-deps
npm run build:backend
$env:CI='false'; $env:NODE_OPTIONS='--openssl-legacy-provider'; npm run build:frontend
```

프론트 빌드 후 `build` 내용을 `dist\frontend`로 복사해야 패키징된 서버가 웹 UI를 제공합니다.

```powershell
New-Item -ItemType Directory -Force dist\frontend
Copy-Item build\* dist\frontend -Recurse -Force
```

서버 exe:

```powershell
npx pkg dist/server.js --config .pkgrc.json --targets node18-win-x64 --output portable\vtally-server.exe
```

트레이 exe:

```powershell
dotnet publish tray-launcher\VtallyTray.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -o portable\single-build
```

릴리즈 반영:

```powershell
copy portable\single-build\vtally-web.exe ..\..\release\vtally-web.exe
```

## 검증 기준

v1.5.6 릴리즈 생성 시 확인할 항목:

- `npm run build:backend`
- `$env:CI='true'; npm test -- --watchAll=false --runInBand VmixConnector`
- `$env:CI='false'; $env:NODE_OPTIONS='--openssl-legacy-provider'; npm run build:frontend`
- `release\vtally-web.exe` 실행 후 `http://localhost:3000/` 응답 확인

## 정리 기준

포함한 것:

- 수정된 Hub 소스
- Windows 트레이 런처 소스
- ESP8266 리스너 소스
- 배포 실행 파일
- 펌웨어 기록용 bin/esptool
- 샘플 설정

제외한 것:

- `node_modules`
- `build`, `dist`
- `firmware-build`
- `tray-launcher\bin`, `tray-launcher\obj`
- 임시/디버그 파일
- 현재 PC에서 자동 생성된 실제 `wifi-tally.json`

## 라이선스와 원본 출처

이 프로젝트는 dev at xopn.de의 MIT 라이선스 `wifi-tally` 프로젝트를 기반으로 합니다. 원 저작권과 라이선스는 루트 `LICENSE`에 보존했으며, 초기 NodeMCU Lua 원본과 테스트는 `source\Legacy_NodeMCU_Listener\upstream-source`에 보존했습니다.
