# 从 assets/icons/icon-512.png 生成 Android 图标（不依赖 ImageMagick）
# 用法：powershell -ExecutionPolicy Bypass -File android\gen-icons.ps1
# 产出：
#   res/mipmap-*/ic_launcher.png          传统图标（48/72/96/144/192）
#   res/mipmap-*/ic_launcher_foreground.png  自适应图标前景（108/162/216/324/432，白色卡片居中在安全区内）
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot          # C:\Code\Jizhang
$src  = Join-Path $root 'assets\icons\icon-512.png'
$res  = Join-Path $PSScriptRoot 'app\src\main\res'

$bitmap = [System.Drawing.Bitmap]::FromFile($src)
$W = $bitmap.Width; $H = $bitmap.Height

# ---- 1. 自动找白色卡片的外接矩形（近似：所有通道都 >= 235 的像素）----
$minX = $W; $minY = $H; $maxX = 0; $maxY = 0
for ($y = 0; $y -lt $H; $y += 2) {
  for ($x = 0; $x -lt $W; $x += 2) {
    $c = $bitmap.GetPixel($x, $y)
    if ($c.R -ge 235 -and $c.G -ge 235 -and $c.B -ge 235) {
      if ($x -lt $minX) { $minX = $x }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}
$cardW = $maxX - $minX
$cardH = $maxY - $minY
Write-Host "卡片区域: x=$minX y=$minY w=$cardW h=$cardH (源图 ${W}x${H})"

$densities = [ordered]@{ 'mdpi' = 1.0; 'hdpi' = 1.5; 'xhdpi' = 2.0; 'xxhdpi' = 3.0; 'xxxhdpi' = 4.0 }

function Save-Scaled([System.Drawing.Bitmap]$srcBmp, [int]$w, [int]$h, [string]$path) {
  $dst = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($srcBmp, (New-Object System.Drawing.Rectangle(0, 0, $w, $h)))
  $g.Dispose()
  $dst.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $dst.Dispose()
}

foreach ($d in $densities.Keys) {
  $scale = $densities[$d]
  $dir = Join-Path $res "mipmap-$d"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null

  # --- 传统图标：整张图等比缩放 ---
  $size = [int][math]::Round(48 * $scale)
  Save-Scaled $bitmap $size $size (Join-Path $dir 'ic_launcher.png')

  # --- 自适应前景：108dp 画布，卡片宽度占 58%（安全区 66dp 内）---
  $canvas = [int][math]::Round(108 * $scale)
  $fgW = [int][math]::Round($canvas * 0.58)
  $fgH = [int][math]::Round($fgW * ($cardH / $cardW))
  $fg = New-Object System.Drawing.Bitmap($canvas, $canvas, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($fg)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $srcRect = New-Object System.Drawing.Rectangle($minX, $minY, $cardW, $cardH)
  $dstX = [int](($canvas - $fgW) / 2); $dstY = [int](($canvas - $fgH) / 2)
  $dstRect = New-Object System.Drawing.Rectangle($dstX, $dstY, $fgW, $fgH)

  # 用圆角裁切，把卡片四角残留的渐变三角切掉（源图卡片是圆角，矩形裁切会带出边缘）
  $r = [int]($fgW * 0.13)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diam = $r * 2
  $path.AddArc($dstX, $dstY, $diam, $diam, 180, 90)
  $path.AddArc($dstX + $fgW - $diam, $dstY, $diam, $diam, 270, 90)
  $path.AddArc($dstX + $fgW - $diam, $dstY + $fgH - $diam, $diam, $diam, 0, 90)
  $path.AddArc($dstX, $dstY + $fgH - $diam, $diam, $diam, 90, 90)
  $path.CloseFigure()
  $g.SetClip($path)
  $g.DrawImage($bitmap, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.ResetClip()
  $path.Dispose()
  $g.Dispose()
  $fg.Save((Join-Path $dir 'ic_launcher_foreground.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $fg.Dispose()

  Write-Host "  mipmap-$d  ok (icon ${size}px, foreground ${canvas}px)"
}

$bitmap.Dispose()
Write-Host "图标生成完成。" -ForegroundColor Green
