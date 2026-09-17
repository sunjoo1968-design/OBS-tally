param([string]$Version = '', [switch]$UseExistingExecutable)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Version) { $Version = (Get-Content "$root\source\hub\package.json" -Raw | ConvertFrom-Json).version }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid version' }
$output = Join-Path $root "release\v$Version"
New-Item -ItemType Directory -Force $output | Out-Null
if (-not $UseExistingExecutable) {
    Copy-Item "$root\source\hub\portable\single-build\vtally-web.exe" "$output\vtally-web.exe" -Force
}
if (-not (Test-Path -LiteralPath "$output\vtally-web.exe")) { throw 'Build the executable first' }
Copy-Item "$root\source\hub\firmware" $output -Recurse -Force
Copy-Item "$root\config\wifi-tally.sample.json" $output -Force
Copy-Item "$root\release\README_v$Version.md", "$root\docs\LISTENER_STABILITY_REVIEW_v$Version.md", "$root\docs\OBS_STABILITY_REVIEW_v$Version.md", "$root\docs\BUILD_v$Version.md" $output -Force
# Only approved release artifacts enter archives; runtime settings and logs never do.
$approved = @(
    'vtally-web.exe', 'wifi-tally.sample.json', "README_v$Version.md",
    "LISTENER_STABILITY_REVIEW_v$Version.md", "OBS_STABILITY_REVIEW_v$Version.md", "BUILD_v$Version.md",
    'firmware\ESP8266_vTally_Listener.bin', 'firmware\NodeMCU_V3_vTally_Listener.bin', 'firmware\esptool.exe',
    'firmware\legacy-nodemcu\nodemcu-3.0-master_20200610-cfe68233-float.bin',
    'firmware\legacy-nodemcu\init.lua', 'firmware\legacy-nodemcu\tally-settings.ini.example'
)
$approved += @('my-app', 'my-led', 'my-log-buffer', 'my-log', 'my-settings', 'my-tally', 'my-wifi') | ForEach-Object { "firmware\legacy-nodemcu\$_.lc" }
$files = @($approved | ForEach-Object { Get-Item -LiteralPath (Join-Path $output $_) } | Sort-Object FullName)
$relative = { param($file) [System.IO.Path]::GetRelativePath($output, $file.FullName).Replace('\', '/') }
$manifest = { param($entries)
    (($entries | ForEach-Object { "$( (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() )  $(& $relative $_)" }) -join "`n") + "`n"
}
$utf8 = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText("$output\SHA256SUMS.txt", (& $manifest $files), $utf8)
$firmwareFiles = @($files | Where-Object { $_.FullName.StartsWith("$output\firmware\", [System.StringComparison]::OrdinalIgnoreCase) -or $_.Extension -eq '.md' })
Add-Type -AssemblyName System.IO.Compression
$writeZip = { param($name, $entries, $hashes)
    $zipPath = Join-Path $root "release\OBS-tally-v$Version-$name.zip"
    $stream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Create)
    $zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $entries) {
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, (& $relative $file), [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
        $entry = $zip.CreateEntry('SHA256SUMS.txt')
        $writer = [System.IO.StreamWriter]::new($entry.Open(), $utf8)
        try { $writer.Write($hashes) } finally { $writer.Dispose() }
    } finally { $zip.Dispose(); $stream.Dispose() }
    Get-Item -LiteralPath $zipPath | Select-Object FullName, Length
}
& $writeZip 'runtime' $files (& $manifest $files)
& $writeZip 'firmware' $firmwareFiles (& $manifest $firmwareFiles)
