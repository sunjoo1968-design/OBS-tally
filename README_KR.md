# wifi-vtally-v1.5.5

vTally Hub와 ESP8266 탈리 리스너를 함께 정리한 Windows 실행 패키지입니다.

원격 저장소: [sunjoo1968-design/OBS-tally](https://github.com/sunjoo1968-design/OBS-tally)

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

Windows 11에서는 별도 Java/Node/.NET 설치 없이 실행되도록 구성했습니다.

실행 후 브라우저에서 `http://localhost:3000/`으로 접속하면 됩니다.

## 웹 기능

- `TALLIES`: 탈리 카드 관리
- `CONFIGURATION`: OBS, vMix, ATEM 설정
- `FIRMWARE`: ESP8266 NodeMCU 펌웨어 기록 및 초기 설정값 입력

펌웨어 탭에서 입력 가능한 값:

- COM Port
- WiFi SSID / Password
- 설정용 AP 이름
- Hub IP / Port
- Tally Name
- Front / Operator / Idle 밝기
- Idle Color

밝기는 `1`, `16`, `32`, `64`, `128`, `255`의 6단계 선택 방식입니다.

## 소스 구조

- `source\hub`: Hub 앱 소스
- `source\hub\tray-launcher`: Windows 트레이 실행기 소스
- `source\hub\firmware`: ESP8266 펌웨어 bin
- `source\hub\portable-tools`: esptool 실행 파일
- `source\ESP8266_vTally_Listener`: Arduino ESP8266 리스너 소스
- `config\wifi-tally.sample.json`: 새 PC용 샘플 설정

## 다시 빌드할 때

Hub 소스 폴더:

```powershell
cd source\hub
npm install
npm run build:backend
$env:CI='false'; $env:NODE_OPTIONS='--openssl-legacy-provider'; npm run build:frontend
```

프론트 빌드 후 `build` 내용을 `dist\frontend`로 복사해야 패키징된 서버가 웹 UI를 제공합니다.

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

v1.5.5 릴리즈 생성 시 확인할 항목:

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
