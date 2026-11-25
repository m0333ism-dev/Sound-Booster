param(
    [ValidatePattern('^[a-p]{32}$')]
    [string] $ExtensionId,
    [switch] $BuildOnly,
    [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'
$hostName = 'com.sound_booster.spatial'
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
$buildDirectory = Join-Path $PSScriptRoot 'build'
$manifestPath = Join-Path $buildDirectory "$hostName.json"

if ($Uninstall) {
    if (Test-Path -LiteralPath $registryPath) {
        $registration = Get-Item -LiteralPath $registryPath
        if ($registration.GetValue('') -ne $manifestPath) {
            throw 'The registry entry points to a different installation.'
        }
        Remove-Item -LiteralPath $registryPath
    }
    return
}

$extensionDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'extension'
if (!$ExtensionId) {
    # Windows Chrome derives the unpacked ID from the absolute folder path in UTF-16LE.
    $normalized = (Resolve-Path -LiteralPath $extensionDirectory).ProviderPath
    $digest = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $digest.ComputeHash([Text.Encoding]::Unicode.GetBytes($normalized))
        $hex = [BitConverter]::ToString($bytes, 0, 16).Replace('-', '').ToLowerInvariant()
        $ExtensionId = -join ($hex.ToCharArray() | ForEach-Object { [char]([int][char]'a' + [Convert]::ToInt32($_.ToString(), 16)) })
    } finally {
        $digest.Dispose()
    }
}

$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'The 64-bit Windows .NET Framework compiler is required.' }
New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null
$executable = Join-Path $buildDirectory 'SoundBoosterSpatialHost-v3.exe'
$reference = Join-Path $framework 'System.Web.Extensions.dll'
& $compiler /nologo /target:exe /platform:x64 /optimize+ "/out:$executable" "/reference:$reference" (Join-Path $PSScriptRoot 'Program.cs') (Join-Path $PSScriptRoot 'SpatialOutput.cs') (Join-Path $PSScriptRoot 'StereoUpmixer.cs')
if ($LASTEXITCODE -ne 0) { throw 'Compilation of the Windows audio host failed.' }

$manifest = [ordered]@{
    name = $hostName
    description = 'Sound Booster Windows 7.1 Spatial Audio'
    path = $executable
    type = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
if ($BuildOnly) {
    Write-Output $manifest
    return
}
$registered = Test-Path -LiteralPath $registryPath
$existing = $null
if ($registered) {
    $existing = (Get-Item -LiteralPath $registryPath).GetValue('')
    if ($existing -and $existing -ne $manifestPath) { throw 'An existing host registration points to a different installation.' }
}
$newManifest = Join-Path $buildDirectory "$hostName.$PID.tmp"
try {
    [IO.File]::WriteAllText($newManifest, ($manifest | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $manifestPath) {
        [IO.File]::Replace($newManifest, $manifestPath, [NullString]::Value)
    } else {
        [IO.File]::Move($newManifest, $manifestPath)
    }
} finally {
    if (Test-Path -LiteralPath $newManifest) { Remove-Item -LiteralPath $newManifest }
}
if (!$registered) { New-Item -Path $registryPath -Force | Out-Null }
if (!$existing) { Set-Item -LiteralPath $registryPath -Value $manifestPath }
Write-Output $manifest
