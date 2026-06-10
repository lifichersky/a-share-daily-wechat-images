# Report Schema

Create `YYYY-MM-DD-daily-data.json` before rendering images. Treat it as the single source of truth for all text, numbers, charts, and the standalone WeChat commentary text.

Current schema version: `1.6.0`.

Validate every completed `daily-data.json` against [daily-data.schema.json](daily-data.schema.json) before rendering images.

## Required JSON Shape

```json
{
  "schema_version": "1.6.0",
  "emotion_model_version": "emotion_model_v1",
  "report_date": "YYYY-MM-DD",
  "weekday": "周一",
  "theme": "暗金杂志封面风格",
  "data_quality": {
    "status": "complete",
    "confidence": "high",
    "source_coverage": {
      "financial_analysis": true,
      "eastmoney": true,
      "cls": true,
      "stcn_databao": true
    },
    "missing_fields": [],
    "conflicts": [
      {
        "field": "turnover.amount_text",
        "values": ["3.34万亿", "3.32万亿"],
        "chosen": "3.34万亿",
        "reason": "采用沪深京全市场成交额口径",
        "resolved": true
      }
    ],
    "warnings": []
  },
  "market_summary": {
    "headline": "缩量深V修复 · 科技容量抱团 · 连板分化回暖",
    "action": "低开探底后修复",
    "style_shift": "科技硬件回流，消费医药承压"
  },
  "indices": [
    {"name": "上证指数", "close": 4098.64, "pct": 0.12, "source_key": "eastmoney_index"},
    {"name": "深证成指", "close": 15861.89, "pct": 0.80, "source_key": "eastmoney_index"},
    {"name": "创业板指", "close": 4125.07, "pct": 1.96, "source_key": "eastmoney_index"},
    {"name": "科创50", "close": 1844.25, "pct": 1.59, "source_key": "eastmoney_index"}
  ],
  "turnover": {
    "amount_text": "2.97万亿",
    "amount_yuan": 2968200000000,
    "change_text": "较上日缩量2704亿",
    "change_yuan": -270400000000,
    "source_key": "market_review"
  },
  "breadth": {
    "up": 3018,
    "down": 2365,
    "flat": null,
    "notable": "超3000股上涨",
    "source_key": "market_review"
  },
  "capital_flow": {
    "metric_name": "主力资金",
    "net_text": "-49.20亿",
    "net_yuan": -4920000000,
    "inflow_sectors": [{"name": "通信", "amount_text": "+97.01亿"}],
    "outflow_sectors": [{"name": "计算机", "amount_text": "-37.44亿"}],
    "inflow_stocks": [{"name": "工业富联", "amount_text": "+32.26亿", "role_hint": "容量中军"}],
    "source_key": "capital_flow"
  },
  "limit_up": {
    "display口径": "非ST短线口径",
    "limit_up": 102,
    "limit_down": 8,
    "broken_board": 21,
    "seal_rate_pct": 83,
    "full_market": {"limit_up": 127, "口径": "Wind全口径"},
    "source_key": "limit_review",
    "previous_day": {
      "date": "2026-05-28",
      "limit_up": 63,
      "limit_down": 21,
      "broken_board": 42,
      "seal_rate_pct": 60,
      "source_key": "previous_daily_data"
    }
  },
  "themes": {
    "concept_counts": [{"name": "PCB概念", "up": 4, "sample": 6, "口径": "题材概念口径"}],
    "industry_counts": [{"name": "通信", "pct": 4.59, "口径": "行业口径"}],
    "strong": ["通信", "电子", "CPO/光模块"],
    "weak": ["食品饮料", "医药生物", "非银金融"]
  },
  "theme_interpretation": {
    "status": "both",
    "upside": [
      {
        "name": "通信/CPO",
        "stage": "高位容量抱团",
        "core_judgment": "通信/CPO不是单纯补涨，而是科技容量资金在分歧后的二次抱团",
        "narrative": "指数修复时资金优先回流辨识度高、容量足的成长硬件主线；通信行业领涨，容量核心与首板前排共同承接，说明风险偏好仍围绕算力链展开，但后续要看中军能否继续承接。",
        "confirm_signal": "容量中军继续放量承接，并带动后排扩散",
        "invalidate_signal": "中军冲高回落并带动高位科技补跌",
        "source_keys": ["stcn_databao", "capital_flow"]
      }
    ],
    "downside": [
      {
        "name": "食品饮料",
        "stage": "防御让位",
        "core_judgment": "食品饮料走弱说明资金从低弹性防御切向高弹性成长",
        "narrative": "成长修复日里，食品饮料行业表现靠后且资金承接弱于科技硬件方向，说明防御消费暂时失去比较优势；如果指数再分歧时仍不能回流，防御承接也会被削弱。",
        "confirm_signal": "指数分歧时消费重新获得承接并缩小跌幅",
        "invalidate_signal": "继续缩量走弱且资金仍向成长主线集中",
        "source_keys": ["capital_flow"]
      }
    ]
  },
  "ladder": {
    "highest_non_st_board": 4,
    "promotion": {
      "3_to_4": {"success": 3, "sample": 3},
      "2_to_3": {"success": 1, "sample": 4},
      "1_to_2": {"success": 5, "sample": 39},
      "first_board": {"success": 93, "sample": 118}
    },
    "boards": [
      {"board": 4, "stocks": [{"name": "华电能源", "theme": "热电联产", "role": "空间龙"}]}
    ],
    "previous_day": {
      "date": "2026-05-28",
      "highest_non_st_board": 5,
      "consecutive_board_total": 22,
      "source_key": "previous_daily_data"
    }
  },
  "leader_roles": {
    "空间龙": [{"name": "华电能源", "theme": "热电联产", "board": 4, "reason": "最高非ST连板高度"}],
    "板块龙头": [],
    "容量中军": [],
    "核心助攻": [],
    "中位接力": [],
    "补涨前排": [],
    "首板前排": [],
    "风险负反馈": []
  },
  "emotion_model_v1": {
    "score": 68,
    "state": "分歧修复初期",
    "confidence": "high",
    "factors": [
      {"name": "指数强度", "score": 11, "max": 15, "reason": "主要指数收红，成长指数领涨"},
      {"name": "市场广度", "score": 8, "max": 12, "reason": "上涨家数占优但未达强扩散"},
      {"name": "量能变化", "score": 5, "max": 8, "reason": "缩量修复，承接力度中性"},
      {"name": "主力资金", "score": 5, "max": 10, "reason": "总量流出但主线方向有承接"},
      {"name": "涨停强度", "score": 12, "max": 15, "reason": "非ST涨停数量维持较高水平"},
      {"name": "炸板风险", "score": 9, "max": 12, "reason": "封板率处于良性区间"},
      {"name": "连板高度", "score": 6, "max": 10, "reason": "非ST高度处于3-4板区间"},
      {"name": "晋级率", "score": 5, "max": 8, "reason": "中高位晋级率中性偏强"},
      {"name": "主线集中度", "score": 4, "max": 6, "reason": "通信和电子主线清晰但扩散未全面"},
      {"name": "跌停负反馈", "score": 3, "max": 4, "reason": "跌停负反馈可控"}
    ]
  },
  "next_session_signals": {
    "确认信号": ["空间龙晋级且封单稳定"],
    "弱化信号": ["中位票亏钱效应扩大"],
    "风险信号": ["容量中军冲高回落并带动主线分歧"]
  },
  "wechat_commentary_v1": {
    "text": "6月3日A股不是单纯修复，而是科技容量抱团后的分歧检验。资金仍在算力硬件里寻找弹性，但封板率回落和炸板增加说明追高承接变谨慎。明日关键不在指数小涨，而在容量中军能否继续承接；若中军补跌，短线会从修复转向风险释放。",
    "core_judgment": "科技容量抱团后的分歧检验，不是单纯指数修复",
    "capital_logic": "资金仍围绕算力硬件寻找弹性，但追高承接因封板质量下降而变谨慎",
    "validation_signal": "明日看容量中军能否继续承接；若中军补跌，短线转向风险释放",
    "source_keys": ["capital_flow", "limit_review", "stcn_databao"]
  },
  "sources": {
    "financial_analysis": {"name": "financial-analysis marketInsight", "url": null},
    "eastmoney_index": {"name": "东方财富行情API", "url": "https://push2his.eastmoney.com/api/qt/stock/kline/get"},
    "eastmoney_market": {"name": "东方财富市场数据", "url": "https://quote.eastmoney.com/"},
    "market_review": {"name": "证券时报/财联社/每经收评", "url": "https://www.stcn.com/"},
    "capital_flow": {"name": "证券时报·数据宝", "url": "https://www.stcn.com/"},
    "limit_review": {"name": "财联社涨停复盘", "url": "https://www.cls.cn/"},
    "stcn_databao": {"name": "证券时报·数据宝", "url": "https://www.stcn.com/"},
    "previous_daily_data": {"name": "上一交易日daily-data.json", "url": null}
  },
  "assumptions": ["若来源口径冲突，图片采用display口径，口径文件列出差异。"]
}
```

## Rules

- Do not render images until the JSON is saved and parseable.
- Do not render images until the JSON passes [daily-data.schema.json](daily-data.schema.json).
- `schema_version` must be `1.6.0` until the JSON contract changes again.
- `emotion_model_version` must match the active model reference, currently `emotion_model_v1`.
- Every displayed number must include either `source_key` or an obvious parent object with `source_key`. `theme_interpretation` uses `source_keys` because a judgement can combine multiple evidence sources.
- Do not silently compute missing source data. Use `null` and note the limitation in `assumptions`.
- Keep `theme` in JSON so the same data can be rerendered with another visual theme.
- `theme_interpretation` is required for image 3. Use v2 investment-memo fields to write judgement-oriented theme interpretation, not a repeat of raw counts.
- `limit_up.previous_day` is required for image 3 top comparison. It must include previous trading day's `limit_up`, `limit_down`, `broken_board`, `seal_rate_pct`, `date`, and `source_key`.
- `leader_roles` may contain empty arrays, but the keys must always exist.
- `ladder.previous_day` is required for image 4 top comparison. It must include previous trading day's `highest_non_st_board`, `consecutive_board_total`, `date`, and `source_key`.
- `next_session_signals` must always contain `确认信号`, `弱化信号`, and `风险信号`.
- `wechat_commentary_v1` is required for the standalone `微信公众号摘要.txt` file. The file must match `wechat_commentary_v1.text`.
- `emotion_model_v1.factors` must contain exactly the 10 model factors, no more and no fewer.

## Theme Interpretation

`theme_interpretation` controls the bottom module of image 3 (`涨停与主线复盘`). It replaces the old `高度 / 广度 / 风险` distribution blocks.

Required fields:

- `status`: one of `both`, `upside_only`, `downside_only`, `no_clear_mainline`.
- `upside`: mainstream speculative/upside themes, max 2 items.
- `downside`: major leading-downside or negative-feedback themes, max 2 items.
- Each theme item must include `name`, `stage`, `core_judgment`, `narrative`, `confirm_signal`, `invalidate_signal`, and `source_keys`.
- When `status` is `no_clear_mainline`, `upside` and `downside` must be empty and `no_clear_mainline` must include `stage`, `core_judgment`, `narrative`, `confirm_signal`, `invalidate_signal`, and `source_keys`.

Selection rules:

- Upside candidates: concept limit-up count top 3 and at least 5 stocks; or industry performance top 3 and above `+1%`; or has `板块龙头 / 容量中军 / 核心助攻`; or fixed sources clearly identify it as the active mainline.
- Downside candidates: industry decline top 3 and below `-1.5%`; or sector capital outflow top 3; or includes down-limit, broken-board, or high-recognition negative feedback; or fixed sources state it is dragging the market.
- Daily default: write 1 upside theme and 1 downside/negative-feedback theme. Use a second item only for a real dual-mainline or dual-risk structure. Hard maximum: at most 2 upside themes and at most 2 downside themes. Tie-break by core stock, capacity anchor, ladder evidence, then capital-flow evidence.
- If no theme qualifies, set `status` to `no_clear_mainline` and explain rotation, dispersion, low-volume wait-and-see, retreat, or defensive shift.
- `stage` should be a compact market-structure tag such as `新主线`, `老主线反抽`, `高位容量抱团`, `低位补涨试错`, `防御承接`, `权重护盘`, or `退潮负反馈`.
- `core_judgment` must answer what the theme really is today, such as new mainline, rebound, crowding, low-level catch-up, defensive rotation, or retreat feedback.
- `narrative` must be a compact cause-effect paragraph that connects why money selected it, how the intraday evidence confirmed or weakened it, and how it relates to index, turnover, previous emotion, and capital style.
- `confirm_signal` and `invalidate_signal` must be specific next-session conditions. Avoid vague wording such as `继续关注`.
- Do not invent policy/news/catalyst background. If no reliable source verifies a catalyst, use safer language such as `盘面逻辑`, `资金偏好`, `短线情绪路径`, `低位补涨试错`, `高位容量抱团`, `防御承接`, or `退潮负反馈`.

## WeChat Commentary v1

`wechat_commentary_v1` controls the standalone `YYYY-MM-DD-微信公众号摘要.txt` output.

Required fields:

- `text`: final commentary text written to the txt file.
- `core_judgment`: the market's essence in one sentence.
- `capital_logic`: the cause-effect chain of where money moved and why.
- `validation_signal`: the next-session condition that confirms or invalidates the view.
- `source_keys`: at least one source key supporting the data evidence behind the judgement.

Writing rules:

- This file is a short commentary, not a data recap.
- Keep `text` <=300 visible Chinese characters. Prefer 180-240 characters.
- Include an explicit judgement phrase such as `不是...而是...`, `本质`, `更像`, `说明`, `关键`, or `核心`.
- Include a next-session condition using `明日`, `次日`, `若`, `如果`, `一旦`, or `除非`.
- Use at most 3 numeric values. Avoid listing index, turnover, breadth, sector,涨停, and ladder data in sequence.
- `scripts/render-report.mjs` writes the txt file from `wechat_commentary_v1.text`; `scripts/validate-report.mjs` checks that the saved txt matches the JSON.

## Previous-Day Data Path

When using the prior report as the preferred source for previous-day comparisons, resolve the path from the current report output folder:

```text
previous_daily_data_path =
{current_output_dir_parent}/{previous_trading_date}/{previous_trading_date}-daily-data.json
```

Examples:

```text
C:\Reports\A股日报\2026-06-03
-> C:\Reports\A股日报\2026-06-02\2026-06-02-daily-data.json

{workspace}\outputs\2026-06-03
-> {workspace}\outputs\2026-06-02\2026-06-02-daily-data.json
```

Rules:

- `previous_trading_date` must be the previous completed A-share trading day, not simply the calendar day before.
- Use `source_key: "previous_daily_data"` only when the local prior JSON was found and parsed.
- If the local prior JSON does not exist, use fixed public sources to fill previous values and use that actual source key instead.

## Limit-Up Previous-Day Comparison

`limit_up.previous_day` controls the top comparison tags in image 3.

Required fields:

- `date`: previous completed A-share trading day.
- `limit_up`: previous day's displayed口径涨停数.
- `limit_down`: previous day's displayed口径跌停数 or full-market pressure number if that is the display口径.
- `broken_board`: previous day's displayed口径炸板数.
- `seal_rate_pct`: previous day's displayed口径封板率.
- `source_key`: prefer `previous_daily_data` when the prior report folder has a valid `YYYY-MM-DD-daily-data.json`; otherwise use the fixed public source used to verify the prior numbers.

Rendering and color rules:

- Image 3 `涨停` card must show `昨日 N · 较昨 +/-N`; increasing is red, decreasing is green, unchanged is gold/neutral.
- Image 3 `跌停` card must show `昨日 N · 较昨 +/-N`; increasing is green, decreasing is red, unchanged is gold/neutral.
- Image 3 `炸板` card must show `昨日 N · 较昨 +/-N`; increasing is green, decreasing is red, unchanged is gold/neutral.
- Image 3 `封板率` card must show `昨日 N% · 较昨 +/-Npct`; increasing is red, decreasing is green, unchanged is gold/neutral.

## Ladder Previous-Day Comparison

`ladder.previous_day` controls the top comparison tags in image 4.

Required fields:

- `date`: previous completed A-share trading day, not simply the calendar day.
- `highest_non_st_board`: previous day's non-ST space height.
- `consecutive_board_total`: previous day's consecutive-board total, counting only 2-board and above stocks; do not include first boards.
- `source_key`: prefer `previous_daily_data` when the prior report folder has a valid `YYYY-MM-DD-daily-data.json`; otherwise use the fixed public source used to verify the prior ladder.

Rendering rules:

- Image 4 `非ST空间高度` card must show `昨日 N板 · 较昨 +/-N板`.
- Image 4 `连板总数` card must show `昨日 N只 · 较昨 +/-N只`.
- Higher than yesterday is red, lower than yesterday is green, unchanged is gold/neutral.
- Today's `连板总数` should be computed from `ladder.boards` where `board > 1`, not manually duplicated in JSON.

## Data Quality

`data_quality` is the machine-readable audit status for the report.

| Field | Required values | Rule |
|---|---|---|
| `status` | `complete`, `review_needed`, `incomplete` | Use `complete` only when all displayed key numbers are sourced and conflicts are resolved. Use `review_needed` when non-critical fields are missing or conflicts are resolved but noteworthy. Use `incomplete` when any displayed key number cannot be verified. |
| `confidence` | `high`, `medium`, `low` | `high` requires all four fixed source families. Drop to `medium` when one public source is missing but data is cross-checked. Drop to `low` when key fields rely on a single source or internal-only data. |
| `source_coverage` | four booleans | Must include `financial_analysis`, `eastmoney`, `cls`, and `stcn_databao`. A `false` value requires an explanation in `warnings` or `missing_fields`. |
| `missing_fields` | string array | Use JSON paths such as `capital_flow.inflow_stocks` or `ladder.promotion.1_to_2`. |
| `conflicts` | object array | Every conflict must include `field`, `values`, `chosen`, `reason`, and `resolved`. |
| `warnings` | string array | Record limitations that do not block rendering, such as syndicated pages or unavailable archived URLs. |

Rendering rule:

- `complete`: render normally.
- `review_needed`: render only after the issue is also recorded in `数据来源与口径.md`.
- `incomplete`: do not render images unless the user explicitly accepts the limitation.

## Machine Validation

Before rendering, run a JSON Schema validation step against [daily-data.schema.json](daily-data.schema.json).

Validation failure means the data contract is broken. Fix `daily-data.json` first. Do not bypass validation by deleting required fields or weakening the schema for one-off data gaps; put unavailable values as `null` only where the schema allows it and explain the limitation in `data_quality`.
