# wifi-vtally-v1.0.1

vTally Hub와 ESP8266 탈리 리스너를 함께 정리한 v1.0.1 버전입니다.

v1.0.0과 기능은 동일하고, 실행 파일 구조만 가볍게 바꾸었습니다.
`vtally-web.exe` 안에 서버를 내장하지 않고 같은 폴더의 `vtally-server.exe`를 실행합니다.

## 바로 실행

`release\vtally-web.exe`를 실행하면 됩니다.

같은 폴더에 `release\vtally-server.exe`와 `release\firmware` 폴더가 있어야 합니다.

필요 파일:

- `release\vtally-web.exe`
- `release\vtally-server.exe`
- `release\firmware\ESP8266_vTally_Listener.bin`
- `release\firmware\esptool.exe`

Windows 11에서는 별도 Java/Node/.NET 설치 없이 실행되도록 구성했습니다.

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
