# Rendering Workflow

Default rendering path:

```text
daily-data.json -> report.html -> browser preflight -> four PNG screenshots
```

Do not use native image generation for the normal workflow.

Use the bundled scripts when available:

```bash
node scripts/render-report.mjs --data outputs/YYYY-MM-DD/YYYY-MM-DD-daily-data.json --out outputs/YYYY-MM-DD
node scripts/validate-report.mjs --dir outputs/YYYY-MM-DD
```

If Node cannot find Playwright in the normal environment, set `NODE_PATH` to a node_modules directory that contains Playwright. In Codex desktop, the bundled runtime path is available from `load_workspace_dependencies`.

## Required Inputs

- `YYYY-MM-DD-daily-data.json`, already validated against [daily-data.schema.json](daily-data.schema.json).
- Theme name from `daily-data.json.theme`: `暗金杂志封面风格` / `浅色机构午报风格` / `深色终端杂志风格`.
- Output folder: `outputs/YYYY-MM-DD/`.

## Required Outputs

```text
YYYY-MM-DD-report.html
YYYY-MM-DD-A股市场情绪日报-01-市场全景与资金流.png
YYYY-MM-DD-A股市场情绪日报-02-短线情绪周期.png
YYYY-MM-DD-A股市场情绪日报-03-涨停与主线复盘.png
YYYY-MM-DD-A股市场情绪日报-04-强势板块龙头梯队.png
```

## HTML Structure

`report.html` must be self-contained:

- inline CSS,
- inline sanitized data derived from `daily-data.json`,
- no remote fonts,
- no remote images,
- no generated raster background required.

The document must contain:

```html
<main id="report-root" data-report-date="YYYY-MM-DD" data-theme="dark-editorial-magazine">
  <section class="poster" data-page="1" data-title="市场全景与资金流">...</section>
  <section class="poster" data-page="2" data-title="短线情绪周期">...</section>
  <section class="poster" data-page="3" data-title="涨停与主线复盘">...</section>
  <section class="poster" data-page="4" data-title="强势板块龙头梯队">...</section>
</main>
```

Each `.poster` must be exactly 1080x1440 CSS pixels.

## One-Click Rerender

The renderer must support rerendering from existing data:

```text
render(daily-data.json, theme) -> overwrite report.html -> overwrite four PNGs
```

Command shape:

```bash
node scripts/render-report.mjs --data outputs/YYYY-MM-DD/YYYY-MM-DD-daily-data.json --out outputs/YYYY-MM-DD --theme 暗金杂志封面风格
node scripts/render-report.mjs --data outputs/YYYY-MM-DD/YYYY-MM-DD-daily-data.json --out outputs/YYYY-MM-DD --theme 浅色机构午报风格
node scripts/render-report.mjs --data outputs/YYYY-MM-DD/YYYY-MM-DD-daily-data.json --out outputs/YYYY-MM-DD --theme 深色终端杂志风格
```

Rerendering must not recollect market data or modify `daily-data.json` except when the user explicitly requests a data correction.

## Browser Preflight

Run preflight in a real browser context before screenshots.

Required checks:

1. There are exactly four `.poster` elements.
2. Every `.poster` has `width=1080` and `height=1440`.
3. Every `.poster` is visible.
4. No element marked with `[data-fit]`, `.fit-text`, `.panel`, `.metric-card`, `.signal-card`, `.leader-row`, `.footer`, or `.source-line` overflows:

```js
const hasOverflow =
  el.scrollWidth > el.clientWidth + 8 ||
  el.scrollHeight > el.clientHeight + 8;
```

The 8px tolerance absorbs browser font and subpixel rounding noise. It must not be used to ignore visibly clipped or overlapping text.

5. No visible text-bearing element is outside the poster safe area.
6. Content panels/cards must not overlap the footer/source line.
7. Footer text fits within the footer zone.

If any check fails, stop export and report:

- page number,
- selector,
- element text snippet,
- overflow direction, safe-area violation, or footer overlap.

Do not export PNGs after a failed preflight.

## Screenshot Export

Use browser screenshots of each poster element, not full-page screenshots.

Expected mapping:

| Selector | Output |
|---|---|
| `.poster[data-page="1"]` | `YYYY-MM-DD-A股市场情绪日报-01-市场全景与资金流.png` |
| `.poster[data-page="2"]` | `YYYY-MM-DD-A股市场情绪日报-02-短线情绪周期.png` |
| `.poster[data-page="3"]` | `YYYY-MM-DD-A股市场情绪日报-03-涨停与主线复盘.png` |
| `.poster[data-page="4"]` | `YYYY-MM-DD-A股市场情绪日报-04-强势板块龙头梯队.png` |

After export, verify each PNG is exactly 1080x1440.

## Text Handling

- Use HTML text, not raster text.
- Use `Microsoft YaHei`, `PingFang SC`, or `Noto Sans CJK SC`.
- Prefer shorter lines over shrinking body text below 21px.
- If content is too long, show the top 3-7 items and keep the full list in `daily-data.json`.

## Failure Policy

- Missing key data: fix `daily-data.json` before rendering.
- Overflow: adjust layout, shorten displayed list, or rerender with the same data.
- Theme issue: adjust CSS tokens and rerender.
- Browser/export failure: do not fall back to image generation; fix the renderer or browser environment.
