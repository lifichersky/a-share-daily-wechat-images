---
name: a-share-daily-wechat-images
description: A股日报贴图 skill. Use when Codex needs to generate a WeChat public account daily A-share market emotion report for a specific trading date, including online research, market/sector/limit-up analysis, four 1080x1440 infographic images, and a sub-300 Chinese market commentary saved into a date-named output folder.
---

# A股日报贴图

## Goal

Generate a complete WeChat-ready A-share daily report for one trading date:

- 4 vertical PNG images, each 1080x1440.
- 1 Chinese WeChat commentary text file, no more than 300 Chinese characters.
- 1 structured `daily-data.json` file used as the single source of truth.
- 1 `数据来源与口径.md` file explaining source,口径, and conflicts.
- All outputs saved under a new folder named by report date.

Use a stable data product structure. Content,字段,口径, and chart layout stay consistent every day; only the visual theme may change.

1. Market overview and capital flow.
2. Short-term sentiment cycle.
3. Limit-up and main theme review.
4. Strong-sector leaders and ultra-short ladder.

The skill supports three visual themes, each implemented as an independent HTML+CSS render path (no shared design tokens), so themes differ in background, card fill, border, typography color, accent palette, sparkline style, and density rules. Available themes:

- `暗金杂志封面风格`: dark gold + magazine cover + institutional cards. Use when the user wants a strong cover/cover-feature feel.
- `浅色机构午报风格`: paper-like research-report feel. Use when the user wants a clean, print-style午报 look.
- `深色终端杂志风格`: Bloomberg-terminal look. Use when the user wants a data-dense, high-contrast terminal feel.

Theme changes the visual skin only; it must not change data fields, report order, or logic. There is **no default theme** — the agent must always confirm with the user which theme to use (see Workflow step 0).

## Theme Confirmation (Required Before Execution)

Before starting any task, the agent must determine which visual theme to render. This step is mandatory and must happen before any research, data collection, or HTML generation begins.

- **If the user's instruction explicitly names a theme** (e.g. "用暗金主题生成", "render in 浅色机构午报风格", "use the Bloomberg-terminal theme"), use that theme directly and proceed to step 1.
- **If the user's instruction does not name a theme** (e.g. "生成今天的 A 股日报", "跑一下 2026-05-29 报告"), the agent **must not pick a default theme on its own**. Instead, use the `AskUserQuestion` tool to ask the user which of the three themes they want, and wait for the answer before proceeding. The question should list all three themes with a short description of each. Do not start research, data collection, JSON building, or rendering until the user has answered.
- Do not infer a theme from prior sessions, from "usually we use X", or from the order of themes listed in this file. The user's instruction is the only valid source.
- The chosen theme must be recorded into `daily-data.json.theme` and used for all four images.

## Required Companion Skills

Use these skills when available:

- `financial-analysis`: for first-pass financial market insight, anomaly discovery, and cross-checking.
- `web-access`: for all live web search, source discovery, and verification.

Do not require `imagegen` for the default workflow. The report must be renderable with deterministic HTML/CSS and browser screenshots. Use generated images only when the user explicitly asks for an experimental background; never use image generation for exact Chinese text, stock names, numbers, labels, or chart content.

If the user asks for "今天", "昨日", "周五", or any relative date, resolve and state the exact report date before final delivery. If the date is a weekend or market holiday and the user did not specify a trading day, use the latest completed A-share trading day and state that choice.

## Output Folder

Default to the current workspace unless the user provides another destination.

Create:

```text
outputs/YYYY-MM-DD/
```

Save these files:

```text
YYYY-MM-DD-A股市场情绪日报-01-市场全景与资金流.png
YYYY-MM-DD-A股市场情绪日报-02-短线情绪周期.png
YYYY-MM-DD-A股市场情绪日报-03-涨停与主线复盘.png
YYYY-MM-DD-A股市场情绪日报-04-强势板块龙头梯队.png
YYYY-MM-DD-report.html
YYYY-MM-DD-微信公众号摘要.txt
YYYY-MM-DD-daily-data.json
YYYY-MM-DD-数据来源与口径.md
```

`YYYY-MM-DD-report.html` is the deterministic, self-contained render source for the four PNGs. It must be possible to rerender the PNGs later from the saved HTML and `daily-data.json`.

## Workflow

0. **Confirm the visual theme** (mandatory, before any work). If the user's instruction does not name one of the three themes (`暗金杂志封面风格`, `浅色机构午报风格`, `深色终端杂志风格`), use `AskUserQuestion` to ask the user which theme to use and wait for an answer. Do not start research or rendering until a theme is locked. The chosen theme is used for all four images and is recorded into `daily-data.json.theme`.
1. Determine the report date and create the output folder.
2. Research and verify the date's A-share data. Read [references/data-sources.md](references/data-sources.md). Use the fixed source mix: `financial-analysis`, 东方财富, 财联社, and 证券时报·数据宝. Add extra sources only when a fixed public source is unavailable or key numbers conflict, and record the reason in口径 notes.
3. Build and save `YYYY-MM-DD-daily-data.json` before making images. Follow [references/report-schema.md](references/report-schema.md), include `schema_version`, `emotion_model_version`, `data_quality`, and `wechat_commentary_v1`, then validate it against [references/daily-data.schema.json](references/daily-data.schema.json). Every image and the commentary text must read from this JSON, not from ad hoc notes.
4. Compute `emotion_model_v1` with the threshold rules in [references/emotion-model-v1.md](references/emotion-model-v1.md) and save all 10 factor scores in JSON. Image 2 should show the headline score/state, the score-band usage note, and all 10 factor bars; the JSON must keep the component scores, factor max values, reasons, and confidence.
5. Assign standardized leader roles in JSON: `空间龙`, `板块龙头`, `容量中军`, `核心助攻`, `中位接力`, `补涨前排`, `首板前排`, `风险负反馈`.
6. Fill previous-day comparison fields for images 3 and 4. Prefer the previous completed trading day's saved `daily-data.json` at `{current_output_dir_parent}/{previous_trading_date}/{previous_trading_date}-daily-data.json`; otherwise verify from fixed public sources. Fill `limit_up.previous_day` for `涨停 / 跌停 / 炸板 / 封板率` and `ladder.previous_day` for `非ST空间高度 / 连板总数`. `consecutive_board_total` counts only 2-board and above stocks.
7. Fill `theme_interpretation` for image 3 with the `题材深读 v2` investment-memo structure. Replace the old `高度 / 广度 / 风险` bottom blocks and the old four-line fill-in style. Prioritize one mainstream upside theme and one major downside/negative-feedback theme; use a second item on either side only when there is a real dual-mainline or dual-risk structure. Each item must include `stage`, `core_judgment`, `narrative`, `confirm_signal`, `invalidate_signal`, and `source_keys`. The writing must explain the theme's essence and cause-effect path, not merely repeat counts; do not invent unsourced policy/news catalysts.
8. Convert next-session observations into `确认信号`, `弱化信号`, and `风险信号`; avoid vague "关注某方向" wording without explicit conditions.
9. Lock the visual theme for this run. Read [references/theme-and-layout.md](references/theme-and-layout.md). The theme must already be locked by step 0 — do not pick or change it here. If the theme is still unset at this point, stop and ask the user. Use `暗金杂志封面风格` for the dark-gold + magazine-cover feel, `浅色机构午报风格` for a paper-like research-report feel, or `深色终端杂志风格` for a Bloomberg-terminal look. Do not fall back to a fourth style.
10. Generate a self-contained `YYYY-MM-DD-report.html` from `daily-data.json`. Follow [references/rendering-workflow.md](references/rendering-workflow.md). Prefer `scripts/render-report.mjs` for this step. The HTML must contain four 1080x1440 `.poster` sections and use local CSS for all text, numbers, charts, and theme styling.
11. Run browser-based preflight checks before export: JSON schema validation, four poster dimensions, safe-area checks, and text overflow checks. `scripts/render-report.mjs` runs these checks before PNG export. Fix overlapping text, clipped text, wrong order, stale data, missing role labels, or ambiguous口径 before final delivery.
12. Export each `.poster` to the required PNG filenames with browser screenshots. Rerender from the same JSON/HTML when only typography, spacing, or theme styling changes.
13. Write `YYYY-MM-DD-微信公众号摘要.txt` from `daily-data.json.wechat_commentary_v1.text`. This is `微信公众号短评 v2`, not a market-data summary. It must contain a clear market judgment, a capital-logic cause-effect chain, and a next-session validation condition; keep it <=300 visible Chinese characters and avoid listing more than 3 numeric values.
14. Run `scripts/validate-report.mjs --dir outputs/YYYY-MM-DD` as the final automated quality gate.
15. Final response: link the four images, `report.html`, commentary text file, `daily-data.json`, and口径 file; state main sources and any unresolved口径 assumptions.

## Four-Image Template

Read [references/four-image-template.md](references/four-image-template.md) before laying out the images.

Strict sequence:

1. `01 市场全景与资金流`: market-level conclusion and capital style shift.
2. `02 短线情绪周期`: emotion score, risk/recovery state, next-session observation points.
3. `03 涨停与主线复盘`: limit-up counts, main themes, seal/broken-board risk, and theme deep-dive interpretation.
4. `04 强势板块龙头梯队`: specific leaders, board count, ladder position, leader/assist/follower role.

The sequence, core panels, and data fields are fixed across all themes. A theme may change background, card fill, border, typography color, and accent style only.

##口径 Discipline

Always label口径 when mixing data types:

- `全口径`: includes ST, 科创/创业/北交所 differences, and all涨跌停 statistics from a source.
- `非ST短线口径`: excludes ST and focuses on ordinary ultra-short trading board counts.
- `题材概念口径`: theme/concept count such as 电力14只 or 商业百货10只.
- `行业口径`: industry board count such as 一般零售、电力、房地产开发.
- `特大单/主力资金口径`: do not mix with all-order net flow without labeling.
- `复盘模型 v1`: emotion score is model output, not source data.

If sources disagree, choose the clearest mainstream source for the displayed number and note the口径 in the footer, commentary, or `数据来源与口径.md`. Do not silently blend conflicting numbers.

## Visual Standards

- Use vertical 1080x1440 PNGs.
- Use the selected theme from [references/theme-and-layout.md](references/theme-and-layout.md).
- Keep layout coordinates, panel order, text hierarchy, and data fields stable across themes.
- For `暗金杂志封面风格`, use the approved `深色金融 + 杂志标题 + 机构卡片` direction: image 1 is a magazine-cover page, images 2-3 are balanced terminal-analysis pages, and image 4 is a high-density leader page. Image 1 uses a spotlight cover background and the Chinese title treatment `A股市场` plus a red `情绪日报` tag. Images 2-4 use the dark-gold satin analysis background.
- Avoid one-hue palettes. Do not use grid/repeated-line backgrounds in the default themes.
- Use small rounded corners for content blocks: 6px for panels/cards and 4px for tags/chips.
- Use fixed color semantics: red for bullish/up/repair/strong, green for bearish/down/risk/negative feedback, blue for model/structure, and gold for分歧/observation/hierarchy.
- Keep all text readable on mobile: large headers, short lines, no dense paragraphs in small cards.
- Add a footer with data口径/source and "仅供复盘，不构成投资建议".
- Use HTML/CSS for all exact text, stock names, numbers, charts, and dates.

## Final Quality Gate

Before telling the user the report is complete, verify:

- `scripts/validate-report.mjs --dir outputs/YYYY-MM-DD` passes.
- The four images exist in the date folder and are 1080x1440.
- `YYYY-MM-DD-report.html` exists and contains four 1080x1440 `.poster` sections.
- The commentary text file is generated from `daily-data.json.wechat_commentary_v1.text`, matches it exactly, and is <=300 Chinese characters.
- `daily-data.json` exists, is valid JSON, passes `references/daily-data.schema.json`, and contains `schema_version`, `emotion_model_version`, `data_quality`, `report_date`, `theme`, `indices`, `capital_flow`, `limit_up.previous_day`, `theme_interpretation`, `ladder.previous_day`, `emotion_model_v1`, `leader_roles`, `next_session_signals`, `wechat_commentary_v1`, and `sources`.
- `data_quality.status` is not `incomplete` unless the user explicitly accepted the limitation.
- `emotion_model_v1.factors` contains all 10 model factors with integer scores, correct max values, and reasons.
- `数据来源与口径.md` exists and records source URLs or page names for key numbers.
- Browser preflight found no text overflow, clipped text, panel overflow, or safe-area violations.
- Image 1 explains the whole market and capital style.
- Image 2 explains the emotional cycle and next-session watch points.
- Image 3 explains the limit-up structure, includes previous-day comparison for `涨停 / 跌停 / 炸板 / 封板率`, and renders `题材深读 v2`: theme essence, cause-effect narrative, confirmation signal, and invalidation signal for mainstream upside / downside themes or the no-clear-mainline state.
- Image 4 names concrete leaders, board counts, ladder roles, and previous-day comparison for `非ST空间高度` and `连板总数`.
- Image 4 includes standardized roles, including `容量中军` when a large-cap/high-turnover stock drives the theme.
- Next-session observations include `确认信号`, `弱化信号`, and `风险信号`.
- `wechat_commentary_v1.text` reads as a short commentary, not a data recap: it includes an explicit judgment, a capital-logic chain, and a next-session validation condition.
- All important numbers are sourced and口径-labeled.
