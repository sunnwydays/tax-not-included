# Builds the Chrome Web Store images from images/screenshots into store-assets/.
# Run from the project root: powershell -File tools/store-assets.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $root 'images\screenshots'
$out = Join-Path $root 'store-assets'
New-Item -ItemType Directory -Force $out | Out-Null

$bg = [System.Drawing.ColorTranslator]::FromHtml('#e8efe9')
$green = [System.Drawing.ColorTranslator]::FromHtml('#5a7f62')

# 24-bit RGB canvas (the store rejects alpha)
function New-Canvas($w, $h, $color) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.SmoothingMode = 'HighQuality'
    $g.TextRenderingHint = 'AntiAliasGridFit'
    $g.Clear($color)
    return @{ Bmp = $bmp; G = $g }
}

# Scale the image to fit the box, centred, with a soft shadow so a pale screenshot doesn't melt into the background
function Add-Image($g, $img, $x, $y, $boxW, $boxH, $maxScale) {
    $scale = [Math]::Min([Math]::Min($boxW / $img.Width, $boxH / $img.Height), $maxScale)
    $w = [int]($img.Width * $scale)
    $h = [int]($img.Height * $scale)
    $dx = $x + [int](($boxW - $w) / 2)
    $dy = $y + [int](($boxH - $h) / 2)
    $shadow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(40, 0, 0, 0))
    $g.FillRectangle($shadow, $dx + 4, $dy + 6, $w, $h)
    $g.DrawImage($img, $dx, $dy, $w, $h)
    $shadow.Dispose()
}

function Save-Png($canvas, $name) {
    $canvas.G.Dispose()
    $canvas.Bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Bmp.Dispose()
    Write-Host "$name"
}

# Screenshots, 1280x800. Popup first since it's the main one.
$shots = @(
    @{ File = 'popup.png';    Name = 'screenshot-1-popup.png';    MaxScale = 1.4 },
    @{ File = 'before.png';   Name = 'screenshot-2-before.png';   MaxScale = 1 },
    @{ File = 'after.png';    Name = 'screenshot-3-after.png';    MaxScale = 1 },
    @{ File = 'checkout.png'; Name = 'screenshot-4-checkout.png'; MaxScale = 1.4 }
)
foreach ($s in $shots) {
    $img = [System.Drawing.Image]::FromFile((Join-Path $src $s.File))
    $c = New-Canvas 1280 800 $bg
    Add-Image $c.G $img 40 40 1200 720 $s.MaxScale
    Save-Png $c $s.Name
    $img.Dispose()
}

$icon = [System.Drawing.Image]::FromFile((Join-Path $root 'images\icon-128.png'))
$popup = [System.Drawing.Image]::FromFile((Join-Path $src 'popup.png'))
$white = [System.Drawing.Brushes]::White
$center = New-Object System.Drawing.StringFormat
$center.Alignment = 'Center'

# Small promo tile, 440x280
$c = New-Canvas 440 280 $green
$c.G.DrawImage($icon, 156, 40, 128, 128)
$f = New-Object System.Drawing.Font('Segoe UI', 24, [System.Drawing.FontStyle]::Bold, 'Pixel')
$c.G.DrawString('Tax Not Included', $f, $white, (New-Object System.Drawing.RectangleF(0, 190, 440, 50)), $center)
$f.Dispose()
Save-Png $c 'promo-small-440x280.png'

# Marquee promo tile, 1400x560
$c = New-Canvas 1400 560 $green
$c.G.DrawImage($icon, 140, 130, 128, 128)
$f = New-Object System.Drawing.Font('Segoe UI', 56, [System.Drawing.FontStyle]::Bold, 'Pixel')
$c.G.DrawString('Tax Not Included', $f, $white, 300, 125)
$f.Dispose()
$f = New-Object System.Drawing.Font('Segoe UI', 28, [System.Drawing.FontStyle]::Regular, 'Pixel')
$c.G.DrawString("Prices with tax included,`nright where you shop.", $f, $white, 304, 215)
$f.Dispose()
Add-Image $c.G $popup 880 20 400 520 1.02
Save-Png $c 'promo-marquee-1400x560.png'

$icon.Dispose()
$popup.Dispose()
Write-Host "Done: $out"
