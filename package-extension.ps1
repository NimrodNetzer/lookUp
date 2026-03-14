$src = Join-Path $PSScriptRoot "extension"
$dest = Join-Path $PSScriptRoot "LookUp-extension.zip"
if (Test-Path $dest) { Remove-Item $dest }

Add-Type -Assembly System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($dest, 'Create')

$include = @("manifest.json","background.js","content.js","sidepanel.js","sidepanel.html","storage.js","groq-client.js")
foreach ($f in $include) {
    $full = Join-Path $src $f
    if (Test-Path $full) {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $full, $f) | Out-Null
    }
}
foreach ($d in @("icons","built")) {
    $dir = Join-Path $src $d
    if (-not (Test-Path $dir)) { continue }
    Get-ChildItem -Recurse $dir | Where-Object { -not $_.PSIsContainer } | ForEach-Object {
        $rel = $_.FullName.Substring($src.Length + 1)
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel) | Out-Null
    }
}
$zip.Dispose()
$size = [math]::Round((Get-Item $dest).Length / 1MB, 2)
Write-Host "Created LookUp-extension.zip ($size MB) at $dest"
