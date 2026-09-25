# Generates assets/img/og-cover.png (1200x630) - the link-preview cover
# shown when a page is shared to WeChat / QQ / Weibo.
#
# Uses Windows GDI+ so Chinese text renders exactly (no AI image needed).
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File tools\make-og-cover.ps1
# Text lives in tools\og-strings.json (UTF-8) - edit there, not here.

Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$dir = Join-Path $root 'assets\img'
$out = Join-Path $dir 'og-cover.png'
$strings = Join-Path $here 'og-strings.json'

if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
if (-not (Test-Path -LiteralPath $strings)) { throw "strings file not found: $strings" }

$data = Get-Content -Raw -Encoding UTF8 $strings | ConvertFrom-Json

function C([string]$hex) { return [System.Drawing.ColorTranslator]::FromHtml($hex) }

$W = 1200
$H = 630
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# 1) background: the site canvas (#CB9243) + the same soft top light as body
$rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
$bg = New-Object System.Drawing.SolidBrush((C '#CB9243'))
$g.FillRectangle($bg, $rect)

$light = New-Object System.Drawing.Drawing2D.GraphicsPath
$light.AddEllipse(-200, -430, 1600, 780)
$lgb = New-Object System.Drawing.Drawing2D.PathGradientBrush($light)
$lgb.CenterColor = [System.Drawing.Color]::FromArgb(56, 255, 255, 255)
$lgb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 255, 255))
$g.FillPath($lgb, $light)

# 2) soft glow behind the sun
$glow = New-Object System.Drawing.Drawing2D.GraphicsPath
$glow.AddEllipse(740, 85, 420, 420)
$pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush($glow)
$pgb.CenterColor = [System.Drawing.Color]::FromArgb(72, 255, 255, 255)
$pgb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 255, 255))
$g.FillPath($pgb, $glow)

# 3) two halo rings
$ringColors = @([System.Drawing.Color]::FromArgb(60, 255, 253, 251),
                [System.Drawing.Color]::FromArgb(36, 255, 253, 251))
$r = 200
foreach ($rc in $ringColors) {
  $pen = New-Object System.Drawing.Pen($rc, 22)
  $g.DrawEllipse($pen, (880 - $r), (265 - $r), (2 * $r), (2 * $r))
  $pen.Dispose()
  $r -= 44
}

# 4) the sun (same recipe as .sun in assets/css/style.css)
$sun = New-Object System.Drawing.Drawing2D.GraphicsPath
$sun.AddEllipse(742, 127, 276, 276)
$sgb = New-Object System.Drawing.Drawing2D.PathGradientBrush($sun)
$sgb.CenterPoint = New-Object System.Drawing.PointF(820, 200)
$sgb.CenterColor = (C '#FFF8EA')
$sgb.SurroundColors = @((C '#F0C06B'))
$g.FillPath($sgb, $sun)

# 5) text block (deep brown text: the only thing readable on the gold canvas)
$fBrand = New-Object System.Drawing.Font('Microsoft YaHei', 60, [System.Drawing.FontStyle]::Bold)
$fLine = New-Object System.Drawing.Font('Microsoft YaHei', 22, [System.Drawing.FontStyle]::Regular)
$fNote = New-Object System.Drawing.Font('Microsoft YaHei', 14, [System.Drawing.FontStyle]::Regular)

$bBrand = New-Object System.Drawing.SolidBrush((C '#241708'))
$bLine = New-Object System.Drawing.SolidBrush((C '#3B2A1B'))
$bNote = New-Object System.Drawing.SolidBrush((C '#3B2A1B'))

$g.DrawString($data.brand, $fBrand, $bBrand, 82, 186)
$g.DrawString($data.line, $fLine, $bLine, 88, 326)
$g.DrawString($data.note, $fNote, $bNote, 88, 386)

# 6) small brand bar
$bar = New-Object System.Drawing.SolidBrush((C '#FFF6EC'))
$g.FillRectangle($bar, 88, 440, 92, 7)

$g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$info = Get-Item -LiteralPath $out
Write-Output ("saved " + $out + " (" + $info.Length + " bytes)")
