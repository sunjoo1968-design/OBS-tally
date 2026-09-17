# v1.5.10 빌드 안내

캐시·다운로드한 컴파일러·node_modules·빌드 중간 결과는 정리하여 배포하지 않습니다.
새 환경에서는 아래 도구/의존성을 먼저 준비합니다. 실행 ZIP을 사용하는 경우에는 빌드 도구가 필요하지 않습니다.

## Windows Hub

검증한 구성: Windows x64, Node.js/npm, .NET SDK 8, Git LFS.
새 clone은 `git lfs pull`로 펌웨어와 STL 실파일을 받습니다.

```powershell
cd source\hub
npm ci --legacy-peer-deps
npm run build:backend
$env:CI='true'
npm test -- --watchAll=false --runInBand --silent
$env:CI='false'
$env:NODE_OPTIONS='--openssl-legacy-provider'
npm run build:frontend
New-Item -ItemType Directory -Force dist\frontend | Out-Null
Copy-Item build\* dist\frontend -Recurse -Force
New-Item -ItemType Directory -Force portable | Out-Null
npx pkg dist/server.js --config .pkgrc.json --targets node18-win-x64 --output portable\vtally-server.exe
dotnet publish tray-launcher\VtallyTray.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -o portable\single-build
```

전체 소스 package-lock을 사용합니다. 호환성 검증 없이 `npm audit fix --force`를 적용하지 않습니다.
기존 NuGet 취약성 조회 실패/오래된 WebRequest 경고는 안정성 보고서에 기록했습니다.

## 리스너

- Arduino CLI, ESP8266 core 3.1.2, NodeMCU 1.0 `nodemcuv2`, 4MB DIO/80MHz
- WiFiManager 2.0.17, Adafruit NeoPixel/GFX/SSD1306/BusIO 라이브러리
- C++ 호스트 검사: MSVC 2022 BuildTools
- 레거시: NodeMCU 3.0-master_20200610의 `luac.cross`, 일반 `luac` 사용 금지

공식 NodeMCU 소스의 `msvc/luac-cross/luac-cross.vcxproj`를 Release/Win32/v143/SDK 10.0.26100.0으로
빌드합니다. host-test용 metatable 보완과 설정은 [레거시 README](../source/Legacy_NodeMCU_Listener/README.md)에 설명했습니다.
툴체인은 별도 도구 위치에 두고 다음처럼 명시적으로 전달할 수 있습니다.

```powershell
# 저장소 루트에서 실행; COM 포트나 실제 보드는 수정하지 않습니다.
.\scripts\build-listeners.ps1 -ArduinoCli 'C:\tools\arduino-cli.exe' -LuacCross 'C:\tools\nodemcu\luac.cross.exe'
```

스크립트 기본 Arduino 경로는 Arduino IDE 설치 경로이며, 기본 `luac.cross` 위치는
필요 시 다시 준비하는 `.build-tools/nodemcu-firmware-3.0-master_20200610/...`입니다.
`.build-tools/`, `.listener-build/`는 재빌드 시 생성 가능한 임시 경로로 Git에서 제외합니다.
배포용 펌웨어의 유일한 원본 위치는 `source/hub/firmware/`입니다.

## 패키징과 검사

Hub를 빌드한 뒤 저장소 루트에서 실행합니다.

```powershell
.\scripts\package-release.ps1
node scripts\verify-listener-binaries.cjs release\v1.5.10\firmware
cd source\hub
node scripts\verify-runtime.cjs portable\vtally-server.exe ..\..\release\v1.5.10
```

문서만 바뀌고 기존 검증 실행 파일을 사용할 때는 `package-release.ps1 -UseExistingExecutable`입니다.
실제 `wifi-tally.json`과 로그는 승인된 파일 목록에 없으므로 ZIP에 포함되지 않습니다.
SHA256SUMS는 런타임/펌웨어 ZIP별로 포함된 파일만 기록합니다.
기존 실제 설정은 Git에도 추가하지 않습니다.

GitHub 게시: 소스/펌웨어는 커밋 후 push, 실행 ZIP/릴리즈 문서/해시는 v1.5.10 Release asset으로 업로드합니다.
현재 워킹 트리에는 프로젝트 v1.5.10 배포물만 유지하며, Git 이력/이전 GitHub 릴리즈는 삭제하지 않습니다.
