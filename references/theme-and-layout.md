# Theme And Layout

The report is a stable data product. Theme changes the visual skin only. It must not change image order, panel purpose, required fields, or口径 labels.

Default rendering is deterministic HTML/CSS. Do not call image generation for the normal workflow.

## Themes

The skill ships three independent visual themes. Each theme has its own self-contained HTML rendering function and CSS (no shared design tokens), and replicates the visual style of the corresponding midday report theme. Choose by reader mood: magazine drama, institutional report, or terminal tape.

There is no default theme. The skill does not fall back to a fourth style; the user must explicitly pick from the three themes before rendering.

### 暗金杂志封面风格

Use as the default. Suitable for dramatic WeChat information-flow review and high-impact close reports.

- Background: dark editorial color field, page-specific depth, no grid, no repeated line texture, no pseudo-candlestick pattern. Image 1 uses a spotlight cover background; images 2-4 use a low-noise dark-gold satin background.
- Cards: warm ivory panels with 6px radius, charcoal text, restrained gold borders and separators. Section headers are warm ivory on the dark field.
- Accents: A-share red/green for market direction, one neutral blue for model/structure emphasis, restrained gold for hierarchy. Bullish red `#d93f34`, bearish green `#0a9d70`, structural blue `#2c75b8`, gold `#d7b56d`.
- Tone: premium, dramatic, magazine-cover feel.

Visual direction: `深色金融 + 杂志标题 + 机构卡片`.

- Image 1 is the magazine cover page: stronger title with a red `情绪日报` tag, spotlight depth, slightly more breathing room.
- Images 2-3 are balanced terminal-analysis pages: clear charts, compact cards, stable scanning density.
- Image 4 is the high-density leader page: tighter spacing is allowed, but role labels and stock names must remain readable.

### 浅色机构午报风格

Use when the user asks for a cleaner, paper-like, research-report style.

- Background: warm off-white paper surface with soft tonal gradients, no grid and no repeated-line background. A thin inset paper frame sits 18-20px inside each poster.
- Cards: high-contrast white panels with 6px radius, blue-gray borders, restrained shadow. Section headers are deep navy `#153450`.
- Accents: A-share red/green plus one blue-gray structural color; gold is used only as a small hierarchy accent. Bullish red `#d93f34`, bearish green `#0a9d70`, structural blue `#1f6eb3`, gold `#b08d3e`.
- Tone: concise, research-report style, high readability, suitable for institutional clients and morning briefings.

### 深色终端杂志风格

Use when the user wants a Bloomberg-terminal feel fused with magazine composition.

- Background: deep navy field with subtle cool radial gradients, a faint inner frame, and a 1px gold outer hairline that frames each poster. Image 1 keeps a small blue radial highlight.
- Cards: dark panels `#111d27` with cool cyan/teal borders, warm cream text, 6px radius, subtle inner highlight. Section headers are warm gold `#f1c15c` against the dark field.
- Accents: A-share red/green plus a stronger cyan structural color; gold is used for hierarchy and tags. Bullish red `#ff4b55`, bearish teal `#11c5b7`, structural cyan `#31a6d6`, gold `#d7b56d`.
- Tone: terminal data dashboard with a magazine sensibility. Bullish red carries signal weight; bearish teal feels cooler than a flat green.

## Theme Token Contract

Each theme is implemented as a fully independent HTML+CSS render path. There is no shared `[data-theme]` token system. New themes should follow the same independent-path pattern; do not reintroduce a shared token map.

The executable theme sources are:

- [../scripts/themes.mjs](../scripts/themes.mjs) — theme id, name, and background.
- [../scripts/render-report.mjs](../scripts/render-report.mjs) — independent `renderDarkEditorialHtml`, `renderLightInstitutionalHtml`, `renderDarkTerminalHtml` functions, each owning its own CSS block and selector prefix (`de-`, `li-`, `dt-`).

Keep this reference document and the scripts in sync when adding or changing themes.

## Required Semantic Rules

These rules apply to every theme and override any per-theme styling:

- A-share semantic colors are fixed: bullish/up/long-favorable information uses red; bearish/down/short-favorable information uses green.
- Red means bullish/up/repair/strong. Use it for上涨家数, positive index moves, high emotion score bands, limit-up strength, high seal rate, confirmation signals, and strong themes.
- Green means bearish/down/risk/negative feedback. Use it for下跌家数, negative index moves, shrinking volume, limit-down, broken-board risk, risk signals, and weak themes.
- Use neutral blue/cyan for structure/model emphasis, including factor frameworks, role mapping, ladder structure, and concentration analysis.
- Use warning gold for mid-state/分歧/observation information, including弱化信号, 分歧震荡, and hierarchy accents.
- Panel radius must be `6px`; chip/tag radius must be `4px`.
- Do not encode data values in CSS.
- Do not change DOM order or field selection per theme.
- Do not create one-hue palettes; red/green/blue/gold or red/green/blue-gray/gold should stay distinguishable.
- Each theme's index cards must draw a canvas sparkline (走势装饰线) using the per-theme bullish/bearish color, matching the midday report's four sparkline templates.

## Background Rule

Built-in themes must use pure CSS backgrounds.

Allowed:

- solid color fields,
- soft linear or radial gradients,
- subtle paper or satin-like tonal variation,
- shadows and highlights that support content separation.

Forbidden in built-in themes:

- grid backgrounds,
- repeated-line backgrounds,
- pseudo-candlestick or pseudo-chart texture,
- generated text, pseudo-writing, logos, watermarks,
- image generation as a required step.

If the user explicitly requests an experimental generated background, treat it as optional. Exact text, stock names, numbers, labels, and chart content must still be rendered by HTML/CSS.

## HTML Layout Contract

Generate one self-contained `YYYY-MM-DD-report.html` containing four poster sections:

```html
<main id="report-root" data-report-date="YYYY-MM-DD" data-theme="dark-editorial-magazine">
  <section class="poster de-poster de-page1" data-page="1" data-title="市场全景与资金流">...</section>
  <section class="poster de-poster de-page2" data-page="2" data-title="短线情绪周期">...</section>
  <section class="poster de-poster de-page3" data-page="3" data-title="涨停与主线复盘">...</section>
  <section class="poster de-poster de-page4" data-page="4" data-title="强势板块龙头梯队">...</section>
</main>
```

Class prefix per theme:

- 暗金杂志封面风格 → `de-`
- 浅色机构午报风格 → `li-`
- 深色终端杂志风格 → `dt-`

Each `.poster` must be exactly:

```css
.poster {
  width: 1080px;
  height: 1440px;
  position: relative;
  overflow: hidden;
}
```

Use fixed 1080x1440 layout zones for every theme:

| Zone | Coordinates | Purpose |
|---|---|---|
| Header | x=42 y=36 w=996 h=160 | Title, date pill, one-line conclusion. |
| Main metrics | y=226-400 | Index/limit-up/sentiment headline cards. |
| Middle analysis | y=420-860 | Main data panel for the image purpose. |
| Lower analysis | y=884-1340 | Signals, interpretation, role mapping, or next-session panels. |
| Footer | y=1362-1408 | Source口径 and disclaimer. |

Safe-area rules:

- Keep all text at least 32px from image edges.
- Keep at least 18px between cards and 16px inside card padding.
- Never place body text below y=1338.
- Footer text must fit inside x=42-1038 and y=1362-1408.
- If a list is too long, show the most important 3-7 items and put the full list in `daily-data.json`.

## Typography

- Title: 56-66px bold.
- Subtitle: 28-32px bold.
- Metric numbers: 34-64px bold.
- Section headers: 26-32px bold.
- Body: 21-28px.
- Footer/source: 15-18px.

Use Microsoft YaHei, PingFang SC, Noto Sans CJK SC, or another reliable Chinese font. Do not use image generation to render exact text.

## Component Shape

- Content panels/cards: 6px radius.
- Chips/tags/date pills: 4px radius, except date pills may be fully rounded when the visual balance benefits.
- Progress bars: fully rounded capsule ends are allowed.
- Avoid nested cards. A panel may contain rows, chips, bars, and lightweight dividers, but not another full card.

## Theme Adaptation

For `暗金杂志封面风格`, prefer dark background, ivory panels, gold borders, and strong but controlled red/green state markers. Image 1 carries the magazine-cover treatment; images 2-4 use the satin analysis background.

For `浅色机构午报风格`, prefer off-white paper background, white panels, blue-gray borders, stronger panel/background contrast, and restrained shadows. Each page wraps content in an inset paper frame.

For `深色终端杂志风格`, prefer deep navy background, dark panels with cool cyan borders, cream text, and a thin gold outer hairline. Bullish red is slightly warmer; bearish teal replaces flat green for a Bloomberg-tape feel.

The card coordinates, fields, and order remain identical across themes so readers learn the format over time.
