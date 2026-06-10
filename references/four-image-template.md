# Four-Image Template

All four images must be rendered from `daily-data.json`. The layout and data fields stay stable across themes. Visual themes affect the visual skin only: color, background depth, card treatment, typography, title treatment, and density rules.

## 01 市场全景与资金流

Purpose: let readers understand the whole market in 5 seconds.

Include:

- Title: `A股市场情绪日报`.
- Visual treatment: magazine cover page. Use the dark theme's spotlight cover background, a strong Chinese title treatment with `A股市场` plus a red `情绪日报` tag, and slightly more breathing room than the other pages.
- Exact report date.
- One-line market conclusion, e.g. `放量分歧 · 科技兑现 · 防御承接`.
- Index cards: 上证指数, 深证成指, 创业板指, 科创50.
- Total turnover and day-over-day change.
- In the market status block, color turnover change by A-share semantics: shrinking volume/negative `change_yuan` is green; expanding volume/positive `change_yuan` is red.
- Breadth: up/down count or a clear phrase such as `下跌超3800只`.
- In breadth text, color上涨家数 red and下跌家数 green.
- Capital cards:
  - total net flow,
  - strongest receiving directions,
  - strongest selling directions.
- Bottom sector temperature: relative strong and relative weak directions.

Do not include detailed leader ladder here. Save it for image 4.

## 02 短线情绪周期

Purpose: convert raw data into a clear emotion-state diagnosis.

Visual treatment: terminal-analysis page. Use the dark-gold satin background, balanced information density, compact factor bars, and clear signal cards.

Include:

- Emotion state: e.g. `强分歧 / 退潮确认期`, `修复初期`, `主升扩散`, `冰点反抽`.
- Emotion score from 0 to 100. Use `复盘模型 v1`; label it as model output, not source data.
- Use a compact HTML/CSS sentiment dial for the score and compact factor bars for model components.
- Under the state title, show the score-band usage note instead of internal `confidence` text.
- Show all 10 factor bars. For schema factors named `炸板风险` and `跌停负反馈`, use display labels `封板质量` and `负反馈控制` because their scores mean risk is being controlled.
- Three next-session signal cards:
  - `确认信号`: what would prove repair/continuation.
  - `弱化信号`: what would show the repair is fading.
  - `风险信号`: what would turn sentiment back to分歧/退潮.

Use full口径 for broad stress if necessary, and label it.

## 03 涨停与主线复盘

Purpose: explain why the strongest themes mattered that day.

Visual treatment: structure review page. Use balanced card density, compact bar charts, and a bottom theme deep-dive module.

Include:

- Full口径 limit-up/down/broken-board count.
- Non-ST short-term count/seal rate when available.
- Top metric comparison:
  - `涨停` must include previous trading day's value, e.g. `昨日 63 · 较昨 -14`.
  - `跌停` must include previous trading day's value, e.g. `昨日 21 · 较昨 +38`.
  - `炸板` must include previous trading day's value, e.g. `昨日 42 · 较昨 -5`.
  - `封板率` must include previous trading day's value, e.g. `昨日 60% · 较昨 -4pct`.
  - Use A-share semantics by indicator: more涨停 and higher封板率 are red; more跌停 and more炸板 are green; unchanged is gold/neutral.
- Main theme counts. Label `题材概念口径` or `行业口径`.
- Use compact bar charts for theme/industry counts so readers can compare strength at a glance.
- A bottom `题材深读` module driven by `theme_interpretation`:
  - If both upside and downside themes qualify, render `主线炒作解读` and `领跌负反馈解读` side by side.
  - If only upside themes qualify, render one wide `主线炒作解读` module.
  - If only downside themes qualify, render one wide `领跌负反馈解读` module.
  - If no clear theme qualifies, render one wide `无明确主线状态` module.
- `题材深读` uses the v2 investment-memo structure:
  - Prefer 1 upside theme and 1 downside/negative-feedback theme. Add a second item only when there is a real dual-mainline or dual-risk structure.
  - Each interpreted theme must include a stage tag such as `新主线`, `老主线反抽`, `高位容量抱团`, `低位补涨试错`, `防御承接`, `权重护盘`, or `退潮负反馈`.
  - `本质判断`: one sentence explaining what the theme really is today, such as new mainline, old-line rebound, capacity crowding, low-level catch-up, defensive rotation, or retreat feedback.
  - `来龙去脉`: one compact paragraph that connects why money selected it, how the intraday evidence confirmed or weakened it, and how it relates to index, turnover, previous emotion, and capital style.
  - `确认`: the next-session signal that would prove continuation or repair.
  - `证伪`: the next-session signal that would show one-day rotation, crowding unwind, or continued drag.
- `复盘结论`: whether the market is expanding, splitting, retreating, or switching style.

Avoid giving long lists of individual stocks here. Use only the names needed as evidence; keep the detailed stock list and repeated ladder height for image 4. The bottom module should read like a short research memo, not a data table.

## 04 强势板块龙头梯队

Purpose: connect sector emotion to concrete tradable标志性个股.

Visual treatment: high-density leader page. Use the dark-gold satin background and a `B偏C` density: tighter role cards and ladder rows are allowed, but text must remain readable and pass overflow checks.

Include:

- Main active sectors.
- `非ST空间龙` or `全口径最高标`, whichever is accurate.
- Top metric comparison:
  - `非ST空间高度` must include previous trading day's height, e.g. `昨日 4板 · 较昨 -1板`.
  - `连板总数` must include previous trading day's consecutive-board total, e.g. `昨日 16只 · 较昨 -5只`.
  - Count `连板总数` from 2-board and above stocks only; first boards do not enter this total.
  - Use A-share semantics: expansion/opening space is red, contraction/compression is green, unchanged is gold/neutral.
- Standard role blocks:
  - `空间龙`: highest non-ST board or market-height anchor.
  - `板块龙头`: strongest stock inside a main theme.
  - `容量中军`: high-turnover large-cap/core stock that drives index or sector emotion.
  - `核心助攻`: supports the leader and keeps sector breadth alive.
  - `中位接力`: 2-4 board stock testing relay strength.
  - `补涨前排`: lower-position stock following the main branch.
  - `首板前排`: high-recognition first board or strong-seal stock.
  - `风险负反馈`: down-limit, failed high-board, large-loss, or broken-board representative.
- Ladder:
  - `N板 · 空间龙`,
  - `3-4板 · 中位接力`,
  - `2板 · 补涨前排`,
  - `首板 · 板块前排`.
- Use a compact ladder strip plus the eight standardized role blocks; do not collapse multiple roles into one generic card.
- Compact sector/leader mapping through the metric header, standardized role blocks, and ladder strip, e.g. `电力: 华电能源`, `通信/CPO: 中兴通讯/工业富联`.
- Watch panel:
  - `确认信号`,
  - `弱化信号`,
  - `风险信号`.
- Optional strong-seal/watch names when data is available.
- Bottom ladder interpretation:
  - who is leading,
  - who is assisting,
  - which names are followers or补涨,
  - what failure would mean for ultra-short sentiment.

Use role labels consistently:

- `空间龙`: highest non-ST board or the main market height anchor.
- `板块龙头`: strongest stock within an active sector.
- `容量中军`: large/high-turnover stock anchoring a theme and affecting index/sector risk appetite.
- `核心助攻`: supports the leader and keeps sector breadth alive.
- `中位接力`: 2-4 board stock that tests接力 strength.
- `补涨前排`: lower-position stock following the main branch.
- `首板前排`: high-recognition first board or strong seal stock.
- `风险负反馈`: failed high-recognition stock or loss-making signal that may suppress接力.

## WeChat Commentary Text

The standalone `YYYY-MM-DD-微信公众号摘要.txt` file is a short market commentary, not a market-data summary. It must be generated from `daily-data.json.wechat_commentary_v1.text`.

Keep it under 300 visible Chinese characters. Prefer 180-240 characters when possible.

Required structure:

1. A clear core judgment: what the market really was today.
2. A capital-logic chain: where money moved from, where it moved to, and why.
3. A next-session validation condition: what would confirm or invalidate the judgment.

Hard rules:

- Include at least one explicit judgment phrase such as `不是...而是...`, `本质上`, `更像`, `说明`, or `关键`.
- Include a next-session condition with `明日`, `次日`, `若`, or `如果`.
- Use at most 3 numeric values; avoid turning the text into a data list.
- Do not merely concatenate index, turnover, breadth, sector,涨停, and ladder data.

Example shape:

```text
{date}A股不是简单{surface_action}，而是{core_judgment}。{capital_logic}。明日关键不在{surface_validation}，而在{validation_signal}；若{risk_condition}，短线情绪将{risk_path}。
```
