# Data Sources And Verification

## Fixed Source Mix

Use a compact fixed-source system for every report. Do not casually add more sources just because search results exist.

### 0. `financial-analysis` / `marketInsight`

Role: first-pass data brief, anomaly discovery, and cross-check.

- Use it at the start of research to get candidate numbers, sector clues, capital-flow direction, and limit-up/ladder leads.
- Treat it as a helper source, not the sole display source, because it may return internal data without a public URL.
- If its number conflicts with public sources, keep the conflict in `数据来源与口径.md` and display the clearest public-source口径.

### 1. 东方财富行情 / 资金流向

Role: primary structured market data.

- Use for index close/pct, turnover, breadth when available, sector performance, sector capital flow, and stock capital flow.
- Prefer dated quote/API/page results that can be reproduced from the report date.
- Label capital data explicitly as `主力资金口径`, `特大单口径`, or the exact 东方财富口径 used.

### 2. 财联社收评 / 涨停分析

Role: primary short-term sentiment and limit-up review source.

- Use for daily market review, active themes, limit-up/down/broken-board counts, seal rate, highest board, and ladder clues.
- Prefer pages whose title or publish time clearly matches `report_date`.
- If 财联社 only provides narrative but not enough ladder details, use it as the main-line confirmation source and fill missing ladder fields from 证券时报·数据宝.

### 3. 证券时报·数据宝

Role: primary cross-check for capital style, sector strength, and leader/ladder details.

- Use for industry/sector capital flow, strong/weak sectors, high-recognition stocks, limit-up review, and market recap.
- Prefer original 证券时报/数据宝 pages. If the original page is inaccessible but the same 数据宝 article is syndicated by 新浪财经 or another major portal, record it as `证券时报·数据宝（转载页）`.
- Do not treat a syndicated copy as a separate independent source from 数据宝.

## Source Discipline

Routine reports should use exactly these four source families:

1. `financial-analysis`
2. 东方财富
3. 财联社
4. 证券时报·数据宝

Only add an extra source when one of the three public sources is unavailable or two fixed sources conflict on a key displayed number. When adding an extra source, write the reason in `数据来源与口径.md` and keep it out of the default workflow.

Prioritize dated pages whose publication date matches the report date. For a report date of `YYYY-MM-DD`, avoid accidentally using weekend commentary or the prior trading day.

For previous-day comparisons in images 3 and 4, first look for the previous completed trading day's local JSON:

```text
{current_output_dir_parent}/{previous_trading_date}/{previous_trading_date}-daily-data.json
```

Set source key `previous_daily_data` only when that file exists and is parsed. If it is unavailable, verify the prior values from 财联社 or 证券时报·数据宝 and record the fallback reason in `数据来源与口径.md`.

## Search Patterns

Use combinations like:

```text
YYYY年M月D日 A股 收评 成交额 上证指数 创业板指 科创50
YYYY年M月D日 A股 板块 资金流向 主力资金 特大单
YYYY年M月D日 涨停分析 连板梯队 封板率 炸板率
YYYY-MM-DD A股 涨停 梯队 空间龙 3板 2板
YYYY年M月D日 电力 商业百货 房地产 涨停 龙头
YYYY年M月D日 A股 主线 领涨 领跌 资金流向 题材
```

When a source is weak or syndicated, use it only after checking that names, counts, and board levels match another source.

## Data Brief Fields

Prepare `YYYY-MM-DD-daily-data.json` before making images. Use [report-schema.md](report-schema.md) as the authoritative schema. At minimum, source and verify these fields:

```text
report_date:
weekday:
theme:
market_summary:
  headline:
  action:
  style_shift:
indices:
  上证指数: close, pct
  深证成指: close, pct
  创业板指: close, pct
  科创50: close, pct
turnover:
  amount_text:
  amount_yuan:
  change_text:
  change_yuan:
breadth:
  up:
  down:
  notable:
capital_flow:
  metric_name:
  net_text:
  net_yuan:
  inflow_sectors:
  outflow_sectors:
  inflow_stocks:
limit_up:
  display口径:
  limit_up:
  limit_down:
  broken_board:
  seal_rate_pct:
  full_market:
  previous_day:
    date:
    limit_up:
    limit_down:
    broken_board:
    seal_rate_pct:
    source_key:
themes:
  concept_counts:
  industry_counts:
theme_interpretation:
  status:
  upside:
    name:
    stage:
    core_judgment:
    narrative:
    confirm_signal:
    invalidate_signal:
    source_keys:
  downside:
    name:
    stage:
    core_judgment:
    narrative:
    confirm_signal:
    invalidate_signal:
    source_keys:
  no_clear_mainline:
    stage:
    core_judgment:
    narrative:
    confirm_signal:
    invalidate_signal:
    source_keys:
ladder:
  highest_non_st_board:
  promotion:
  boards:
  previous_day:
    date:
    highest_non_st_board:
    consecutive_board_total:
    source_key:
leader_roles:
  空间龙:
  板块龙头:
  容量中军:
  核心助攻:
  中位接力:
  补涨前排:
  首板前排:
  风险负反馈:
emotion_model_v1:
  score:
  state:
  factors:
next_session_signals:
  确认信号:
  弱化信号:
  风险信号:
wechat_commentary_v1:
  text:
  core_judgment:
  capital_logic:
  validation_signal:
  source_keys:
sources:
```

Also save `YYYY-MM-DD-数据来源与口径.md` with:

- source URL/page name for each key number,
- chosen display口径,
- conflicting source numbers and why they were not displayed,
- missing data limitations,
- final investment disclaimer.

## Conflict Handling

If full口径 and non-ST short-term口径 differ, display both only where useful:

- Use full口径 for market-wide stress: `全口径：67涨停 / 64跌停 / 71炸板`.
- Use non-ST口径 for ultra-short trading: `非ST短线：49涨停 / 封板率56%`.

If ST names occupy the highest full-market board, call non-ST leaders `非ST空间龙` rather than `最高标`.

For `limit_up.previous_day`, keep the previous-day values in the same display口径 as image 3 wherever possible. If the prior local JSON used a different口径, record the conflict and chosen display口径 in `数据来源与口径.md`.

For `ladder.previous_day.consecutive_board_total`, count only 2-board and above stocks. Do not include first-board stocks. Today's image 4 total should be computed from `ladder.boards` using the same rule.

If theme counts and industry counts differ, label them separately. Do not say a sector has a count without saying whether it is `题材概念口径` or `行业口径`.

For `theme_interpretation`, use fixed sources to separate data evidence from interpretation:

- Use 东方财富 for industry涨跌幅, sector capital flow, and capacity-stock capital movement.
- Use 财联社 for active themes, limit-up structure, high-recognition negative feedback, and ladder clues.
- Use 证券时报·数据宝 for sector strength, leader clues, capital style, and broader market recap.
- Use `financial-analysis` for first-pass clue discovery and conflict checking, not as the only source for a displayed claim.
- In `narrative`, connect data evidence into a cause-effect path: money-selection reason, intraday confirmation or weakening, relation to index/turnover/previous emotion, and next-session implication.
- If a policy/news/catalyst background cannot be verified from the fixed sources or another explicitly recorded extra source, do not invent it. Use safer stage and narrative language such as `盘面逻辑`, `资金偏好`, `短线情绪路径`, `低位补涨试错`, `高位容量抱团`, `防御承接`, or `退潮负反馈`.

For `wechat_commentary_v1`, use the same verified evidence base but write a short view:

- `core_judgment`: infer from index action, emotion score, limit-up quality, theme deep-dive, and leader ladder.
- `capital_logic`: infer from capital flow, strong/weak sectors, capacity anchors, and whether money is attacking, rotating, defending, or retreating.
- `validation_signal`: choose one concrete next-session condition from `next_session_signals`, `theme_interpretation`, or `leader_roles`.
- `text`: write a commentary, not a recap. It must include a judgement phrase and a next-session validation condition, and must use at most 3 numeric values.

If a number cannot be verified from a dated source for the report date, do not put it on an image. Put it in `assumptions` or omit it.
