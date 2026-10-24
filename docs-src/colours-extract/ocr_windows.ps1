# Step 2a: OCR the rendered code columns with the Windows built-in OCR engine.
#   powershell -NoProfile -ExecutionPolicy Bypass -File ocr_windows.ps1 <workdir>
# Writes <workdir>/ocr_windows.json: [{ page, lines: [{ text, y, h }] }]
param([string]$Work)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$type) {
  $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result
}
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime] | Out-Null
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()   # en-GB on this machine
$out = @()
Get-ChildItem -Path $Work -Filter 'p*.png' | Sort-Object Name | ForEach-Object {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($_.FullName)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = @()
  foreach ($l in $res.Lines) {
    $ys = $l.Words | ForEach-Object { $_.BoundingRect.Y }
    $hs = $l.Words | ForEach-Object { $_.BoundingRect.Height }
    $xs = $l.Words | ForEach-Object { $_.BoundingRect.X }
    $lines += [pscustomobject]@{ text = $l.Text; x = ($xs | Measure-Object -Minimum).Minimum; y = ($ys | Measure-Object -Minimum).Minimum; h = ($hs | Measure-Object -Maximum).Maximum }
  }
  $stream.Dispose()
  $out += [pscustomobject]@{ page = [int]($_.BaseName.Substring(1)); lines = $lines }
}
$out | ConvertTo-Json -Depth 5 | Out-File -Encoding utf8 (Join-Path $Work 'ocr_windows.json')
Write-Output ("windows ocr: " + $out.Count + " pages, max image dim " + [Windows.Media.Ocr.OcrEngine]::MaxImageDimension)
