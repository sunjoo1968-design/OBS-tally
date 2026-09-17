param(
    [string]$ArduinoCli = 'C:\Program Files\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe',
    [string]$LuacCross = '.build-tools\nodemcu-firmware-3.0-master_20200610\msvc\luac-cross\Win32\Release\luac.cross.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
$oldLuaRoot = $env:VTALLY_LUA_ROOT
$oldLuaExtension = $env:VTALLY_LUA_EXTENSION
try {
    $ArduinoCli = (Resolve-Path -LiteralPath $ArduinoCli).Path
    $LuacCross = (Resolve-Path -LiteralPath $LuacCross).Path
    New-Item -ItemType Directory -Force '.listener-build\arduino', '.listener-build\legacy', '.listener-build\firmware\legacy-nodemcu' | Out-Null
    if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
        $vs = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools'
        Import-Module "$vs\Common7\Tools\Microsoft.VisualStudio.DevShell.dll"
        Enter-VsDevShell -VsInstallPath $vs -SkipAutomaticLocation -DevCmdArguments '-arch=x86 -host_arch=x64'
    }
    & cl.exe /nologo /EHsc /W4 'source\ESP8266_vTally_Listener\tests\protocol-tests.cpp' /Fe:.listener-build\protocol-tests.exe /Fo:.listener-build\protocol-tests.obj
    if ($LASTEXITCODE -ne 0) { throw 'Protocol test compilation failed' }
    & '.listener-build\protocol-tests.exe'
    if ($LASTEXITCODE -ne 0) { throw 'Protocol tests failed' }
    & cl.exe /nologo /EHsc /W4 /Isource\ESP8266_vTally_Listener\tests\mocks 'source\ESP8266_vTally_Listener\tests\listener-tests.cpp' /Fe:.listener-build\listener-tests.exe /Fo:.listener-build\listener-tests.obj
    if ($LASTEXITCODE -ne 0) { throw 'Listener behavior test compilation failed' }
    & '.listener-build\listener-tests.exe'
    if ($LASTEXITCODE -ne 0) { throw 'Listener behavior tests failed' }
    & $ArduinoCli compile --fqbn esp8266:esp8266:nodemcuv2 --output-dir '.listener-build\arduino' --build-path '.listener-build\arduino-cache' --warnings more --jobs 4 'source\ESP8266_vTally_Listener'
    if ($LASTEXITCODE -ne 0) { throw 'Arduino build failed' }
    foreach ($file in Get-ChildItem 'source\Legacy_NodeMCU_Listener\src\my-*.lua') {
        # Refuse standard Lua: only the NodeMCU compiler can parse existing .lc files.
        & $LuacCross -p "source\hub\firmware\legacy-nodemcu\$($file.BaseName).lc"
        if ($LASTEXITCODE -ne 0) { throw "Incompatible NodeMCU compiler: $($file.Name)" }
        & $LuacCross -s -o ".listener-build\legacy\$($file.BaseName).lc" $file.FullName
        if ($LASTEXITCODE -ne 0) { throw "Legacy compilation failed: $($file.Name)" }
    }
    $env:VTALLY_LUA_ROOT = '.listener-build/legacy'
    $env:VTALLY_LUA_EXTENSION = '.lc'
    & $LuacCross -e 'source\Legacy_NodeMCU_Listener\tests\regression.lua'
    if ($LASTEXITCODE -ne 0) { throw 'Compiled NodeMCU regression tests failed' }
    $staging = '.listener-build\firmware'
    Copy-Item '.listener-build\arduino\ESP8266_vTally_Listener.ino.bin' "$staging\ESP8266_vTally_Listener.bin" -Force
    Copy-Item '.listener-build\arduino\ESP8266_vTally_Listener.ino.bin' "$staging\NodeMCU_V3_vTally_Listener.bin" -Force
    Copy-Item '.listener-build\legacy\*.lc' "$staging\legacy-nodemcu" -Force
    Copy-Item 'source\hub\firmware\legacy-nodemcu\*.bin', 'source\Legacy_NodeMCU_Listener\src\init.lua', 'source\hub\firmware\legacy-nodemcu\tally-settings.ini.example' "$staging\legacy-nodemcu" -Force
    & node 'scripts\verify-listener-binaries.cjs' $staging
    if ($LASTEXITCODE -ne 0) { throw 'Binary verification failed' }
    Copy-Item "$staging\*.bin" 'source\hub\firmware' -Force
    Copy-Item "$staging\legacy-nodemcu\*" 'source\hub\firmware\legacy-nodemcu' -Force
    Write-Output 'PASS: listener builds installed into source/hub/firmware (no hardware flashed)'
} finally {
    $env:VTALLY_LUA_ROOT = $oldLuaRoot
    $env:VTALLY_LUA_EXTENSION = $oldLuaExtension
    Pop-Location
}
