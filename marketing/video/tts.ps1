param([int]$Rate = 1)
Add-Type -AssemblyName System.Speech
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$lines = Get-Content (Join-Path $dir 'lines.json') -Raw -Encoding UTF8 | ConvertFrom-Json
New-Item -ItemType Directory -Force (Join-Path $dir 'vo') | Out-Null
foreach ($cut in 'main', 'short') {
  $i = 0
  foreach ($t in $lines.$cut) {
    $i++
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $s.SelectVoice('Microsoft Hortense Desktop')
    $s.Rate = $Rate
    $s.Volume = 100
    $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(44100, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $s.SetOutputToWaveFile((Join-Path $dir ("vo\{0}{1}.wav" -f $cut, $i)), $fmt)
    $s.Speak($t)
    $s.Dispose()
  }
}
Get-ChildItem (Join-Path $dir 'vo') | ForEach-Object { '{0} {1:N2}s' -f $_.Name, (($_.Length - 44) / 88200) }
