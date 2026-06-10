# Emotion Model v1

`复盘模型 v1` converts market data into a stable 0-100 short-term sentiment score. It is a model estimate, not source data. Store every factor in `daily-data.json.emotion_model_v1.factors`.

## Calculation Rules

- Use integer scores only.
- The 10 factor max values must sum to 100.
- Factor names and max values must exactly match [daily-data.schema.json](daily-data.schema.json).
- Total score = sum of factor scores. Do not add discretionary bonus points.
- If a factor's key data is missing, score no higher than the neutral midpoint for that factor and lower `emotion_model_v1.confidence`.
- If the result contradicts obvious market reality, keep the numeric score but add `override_reason`; do not silently move the state band.

## Factor Threshold Rules

### 1. 指数强度, max 15

Use 上证指数、深证成指、创业板指、科创50.

| Score | Threshold |
|---:|---|
| 13-15 | 4/4 indices up, or 3/4 up with 创业板指/科创50 at least +1.5% and no index below -0.3%. |
| 10-12 | At least 3/4 indices up and no index below -0.8%. |
| 7-9 | Mixed market: 2/4 indices up, or small broad moves within +/-0.8%. |
| 4-6 | At least 3/4 indices down, or 创业板指/科创50 below -1.5%. |
| 0-3 | 4/4 indices down, or any growth index below -3%, or broad index panic decline. |

### 2. 市场广度, max 12

Compute `up_ratio = up / (up + down)` when both values exist.

| Score | Threshold |
|---:|---|
| 11-12 | `up_ratio >= 65%`. |
| 8-10 | `50% <= up_ratio < 65%`. |
| 5-7 | `40% <= up_ratio < 50%`. |
| 2-4 | `25% <= up_ratio < 40%`. |
| 0-1 | `up_ratio < 25%`. |

### 3. 量能变化, max 8

Compute turnover change percentage when possible:

```text
previous_turnover = amount_yuan - change_yuan
turnover_change_pct = change_yuan / previous_turnover
```

| Score | Threshold |
|---:|---|
| 7-8 | Volume expands +10% to +35% with positive indices/breadth, or controlled放量突破. |
| 5-6 | Slight expansion from 0% to +10%, or mild缩量上涨 with breadth support. |
| 3-4 | Shrinking rebound, flat volume in a weak market, or moderate放量下跌. |
| 0-2 | Volume expands more than +20% with broad selloff, or severe shrinkage below -15% during weak sentiment. |

### 4. 主力资金, max 10

Prefer `capital_flow.net_yuan / turnover.amount_yuan`. If turnover is missing, use the source's direct主力净流入 conclusion and cap the score at 6.

| Score | Threshold |
|---:|---|
| 9-10 | Net inflow ratio >= +0.3% and leading sectors/stocks show concentration. |
| 7-8 | Net inflow ratio from 0% to +0.3%, or slight outflow with clear main-line receiving. |
| 5-6 | Net outflow ratio from -0.3% to 0%, no broad panic. |
| 3-4 | Net outflow ratio from -1.0% to -0.3%, or defensive rotation dominates. |
| 0-2 | Net outflow ratio < -1.0%, or high-beta/capacity leaders show large synchronized outflow. |

### 5. 涨停强度, max 15

Use the report's `limit_up.display口径`. If both full-market and non-ST values exist, score by non-ST短线口径 and mention full口径 in the reason.

| Score | 全口径 threshold | 非ST短线 threshold |
|---:|---:|---:|
| 13-15 | >=100 | >=75 |
| 10-12 | 70-99 | 50-74 |
| 7-9 | 45-69 | 30-49 |
| 4-6 | 25-44 | 15-29 |
| 0-3 | <25 | <15 |

### 6. 炸板风险, max 12

Use `seal_rate_pct`. Higher score means lower risk.

Display label in Image 2: `封板质量`. Keep the JSON factor name as `炸板风险` for schema compatibility.

| Score | Threshold |
|---:|---|
| 11-12 | `seal_rate_pct >= 80%`. |
| 8-10 | `65% <= seal_rate_pct < 80%`. |
| 5-7 | `50% <= seal_rate_pct < 65%`. |
| 2-4 | `35% <= seal_rate_pct < 50%`. |
| 0-1 | `seal_rate_pct < 35%`. |

Adjustment: if `broken_board > limit_up`, subtract 1-2 points within the factor range and explain why.

### 7. 连板高度, max 10

Use `ladder.highest_non_st_board` unless the image explicitly labels a full-market highest board.

| Score | Threshold |
|---:|---|
| 9-10 | Highest non-ST board >= 7. |
| 7-8 | Highest non-ST board is 5-6. |
| 5-6 | Highest non-ST board is 3-4. |
| 3-4 | Highest non-ST board is 2. |
| 1-2 | Only first-board activity exists. |
| 0 | No credible height data or no limit-up ladder. |

### 8. 晋级率, max 8

Compute available stage rates:

```text
rate_3_to_4 = success / sample
rate_2_to_3 = success / sample
rate_1_to_2 = success / sample
weighted_rate = 0.4 * rate_3_to_4 + 0.35 * rate_2_to_3 + 0.25 * rate_1_to_2
```

Skip a stage only when `sample` is null or 0, then re-normalize the remaining weights.

| Score | Threshold |
|---:|---|
| 7-8 | `weighted_rate >= 55%`. |
| 5-6 | `35% <= weighted_rate < 55%`. |
| 3-4 | `20% <= weighted_rate < 35%`. |
| 1-2 | `10% <= weighted_rate < 20%`. |
| 0 | `weighted_rate < 10%` or no credible promotion data. |

If all promotion data is missing, cap this factor at 3 and lower confidence.

### 9. 主线集中度, max 6

This is a structured judgment from `themes`, `leader_roles`, and ladder breadth.

| Score | Threshold |
|---:|---|
| 6 | One or two main themes dominate and have `板块龙头`, `容量中军`, `核心助攻`, and lower-level followers. |
| 4-5 | Main themes are clear, but either capacity anchor or assist/follower structure is incomplete. |
| 2-3 | Themes rotate quickly; leaders exist but sector breadth or role mapping is weak. |
| 0-1 | Random isolated limit-ups, no usable main-line structure. |

### 10. 跌停负反馈, max 4

Higher score means weaker negative feedback.

Display label in Image 2: `负反馈控制`. Keep the JSON factor name as `跌停负反馈` for schema compatibility.

| Score | Threshold |
|---:|---|
| 4 | Full-market limit-down count <= 5 and no high-recognition failure. |
| 3 | Limit-down count 6-15, no broad亏钱效应. |
| 2 | Limit-down count 16-30, or one high-recognition failure. |
| 1 | Limit-down count 31-50, or multiple failed high-board/capacity names. |
| 0 | Limit-down count > 50, or down-limit expansion with high-board failures. |

## State Bands

| Score | State |
|---:|---|
| 0-24 | 冰点退潮 |
| 25-39 | 弱修复 |
| 40-54 | 分歧震荡 |
| 55-69 | 分歧修复初期 |
| 70-84 | 主线扩散 |
| 85-100 | 情绪高潮 |

Override the band only when there is a clear contradiction, and record the reason in `emotion_model_v1.override_reason`.

## Output Rules

- Image 2 shows score, state, score-band usage note, and all 10 factor bars.
- Image 2 should explain the score bands in reader-facing language instead of showing internal confidence text.
- The score dial uses A-share semantic color by band: `0-39` bearish green, `40-54` warning gold, `55-100` bullish red.
- Risk-control factors keep positive scoring semantics: higher score means lower risk and should be red; use display labels such as `封板质量` and `负反馈控制` to avoid implying "higher risk".
- `daily-data.json` stores all 10 factor scores and reasons.
- `daily-data.json.emotion_model_v1.confidence` should be `high`, `medium`, or `low`.
- Footer must label the score as `复盘模型 v1`.
- Missing data should reduce confidence, not invite invented precision.
