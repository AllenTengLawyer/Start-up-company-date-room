# PNG 导出说明（可选）

SVG 源文件本身支持任意分辨率缩放；如果需要在特定场景使用 PNG（例如邮件/导出报告封面），推荐导出 1x/2x/3x 三套。

## Inkscape（推荐）
```bash
inkscape founder-day1.svg --export-type=png --export-width=640  --export-filename=founder-day1@1x.png
inkscape founder-day1.svg --export-type=png --export-width=1280 --export-filename=founder-day1@2x.png
inkscape founder-day1.svg --export-type=png --export-width=1920 --export-filename=founder-day1@3x.png
inkscape founder-day1-line.svg --export-type=png --export-width=640  --export-filename=founder-day1-line@1x.png
inkscape founder-day1-line.svg --export-type=png --export-width=1280 --export-filename=founder-day1-line@2x.png
inkscape founder-day1-line.svg --export-type=png --export-width=1920 --export-filename=founder-day1-line@3x.png
```

## rsvg-convert
```bash
rsvg-convert -w 640  founder-day1.svg -o founder-day1@1x.png
rsvg-convert -w 1280 founder-day1.svg -o founder-day1@2x.png
rsvg-convert -w 1920 founder-day1.svg -o founder-day1@3x.png
```
