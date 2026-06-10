import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { THEMES, resolveTheme } from '../scripts/themes.mjs';
import { renderReport, renderReportHtml } from '../scripts/render-report.mjs';
import { validateSourceNotesText } from '../scripts/validate-report.mjs';
import * as reportUtils from '../scripts/lib/report-utils.mjs';

const { validateDailyData, validateDailyDataAgainstSchema } = reportUtils;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const samplePath = path.join(skillRoot, 'fixtures', 'sample-daily-data.json');

async function loadSample() {
  return JSON.parse(await readFile(samplePath, 'utf8'));
}

test('themes expose stable tokenized dark and light variants', () => {
  assert.equal(resolveTheme('暗金杂志封面风格').id, 'dark-editorial-magazine');
  assert.equal(resolveTheme('浅色机构午报风格').id, 'light-institutional-report');
  assert.equal(resolveTheme('深色终端杂志风格').id, 'dark-terminal-magazine');
  assert.equal(THEMES['dark-editorial-magazine'].tokens.radiusPanel, '6px');
  assert.equal(THEMES['light-institutional-report'].tokens.radiusChip, '4px');
});

test('sample daily data passes required report validation', async () => {
  const data = await loadSample();
  const result = validateDailyData(data);
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 0);
});

test('sample daily data passes machine JSON Schema validation', async () => {
  const data = await loadSample();
  const result = await validateDailyDataAgainstSchema(data);
  assert.deepEqual(result.errors, []);
});

test('JSON Schema requires exactly ten emotion factors', async () => {
  const data = await loadSample();
  data.emotion_model_v1.factors.push({
    name: '指数强度',
    score: 1,
    max: 15,
    reason: 'extra factor should fail schema'
  });
  const result = await validateDailyDataAgainstSchema(data);
  assert.match(result.errors.join('\n'), /at most 10 items/);
});

test('JSON Schema requires emotion confidence and enforces maxLength', async () => {
  const missingConfidence = await loadSample();
  delete missingConfidence.emotion_model_v1.confidence;
  let result = await validateDailyDataAgainstSchema(missingConfidence);
  assert.match(result.errors.join('\n'), /emotion_model_v1\.confidence is required/);

  const tooLongCommentary = await loadSample();
  tooLongCommentary.wechat_commentary_v1.text = 'x'.repeat(301);
  result = await validateDailyDataAgainstSchema(tooLongCommentary);
  assert.match(result.errors.join('\n'), /wechat_commentary_v1\.text length must be at most 300/);
});

test('source coverage gaps require downgraded quality and an explanation', async () => {
  const data = await loadSample();
  data.data_quality.source_coverage.cls = false;
  let result = validateDailyData(data);
  assert.match(result.errors.join('\n'), /confidence cannot be high/);
  assert.match(result.errors.join('\n'), /status cannot be complete/);
  assert.match(result.errors.join('\n'), /source_coverage\.cls is false/);

  data.data_quality.status = 'review_needed';
  data.data_quality.confidence = 'medium';
  data.data_quality.warnings = ['cls unavailable; limit-up review cross-checked with an extra dated public source'];
  result = validateDailyData(data);
  assert.deepEqual(result.errors, []);
});

test('all source_key fields must resolve to sources entries', async () => {
  const data = await loadSample();
  data.turnover.source_key = 'missing_source_key';
  const result = validateDailyData(data);
  assert.match(result.errors.join('\n'), /turnover\.source_key references missing sources\.missing_source_key/);
});

test('wechat commentary v1 is opinionated, concise, and machine-checkable', async () => {
  const data = await loadSample();
  const text = reportUtils.wechatCommentaryText(data);
  assert.ok(text.length > 0);
  assert.ok(reportUtils.countVisibleChars(text) <= 300);
  assert.match(text, /不是|而是|本质|更像|说明|关键/);
  assert.match(text, /明日|次日|若|如果/);
  assert.ok((text.match(/\d+(?:\.\d+)?/g) ?? []).length <= 3);

  const shallow = structuredClone(data);
  shallow.wechat_commentary_v1.text = '上证指数下跌，成交放量，电力和地产上涨，半导体下跌，涨停减少，跌停增加。';
  const result = validateDailyData(shallow);
  assert.match(result.errors.join('\n'), /wechat_commentary_v1\.text must include an explicit market judgment/);
});

test('schema requires wechat commentary v1 fields', async () => {
  const data = await loadSample();
  data.schema_version = '1.6.0';
  let result = await validateDailyDataAgainstSchema(data);
  assert.deepEqual(result.errors, []);

  delete data.wechat_commentary_v1;
  result = await validateDailyDataAgainstSchema(data);
  assert.match(result.errors.join('\n'), /wechat_commentary_v1 is required/);
});

test('source notes must document source families, display口径, and disclaimer', async () => {
  const data = await loadSample();
  const badText = '# 数据来源\n\n仅供复盘，不构成投资建议。';
  let result = validateSourceNotesText(badText, data);
  assert.match(result.join('\n'), /display口径/);
  assert.match(result.join('\n'), /financial_analysis/);

  const goodText = [
    '# 数据来源与口径',
    '',
    '- financial-analysis marketInsight：用于初筛和交叉核验。',
    '- 东方财富：指数、成交额、涨跌家数、资金流向。',
    '- 财联社：涨停分析、封板率、连板梯队。',
    '- 证券时报·数据宝：行业强弱、题材复盘、代表个股。',
    '- 展示口径：图片采用非ST短线口径，必要处另列全口径；冲突记录在本文件。',
    '- 仅供复盘，不构成投资建议。'
  ].join('\n');
  result = validateSourceNotesText(goodText, data);
  assert.deepEqual(result, []);
});

test('render report writes commentary txt from daily data', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'a-share-commentary-'));
  try {
    const result = await renderReport({
      dataPath: samplePath,
      outDir: tempDir,
      htmlOnly: true
    });
    const summaryPath = path.join(result.outDir, reportUtils.wechatCommentaryName('2026-05-29'));
    const summaryText = await readFile(summaryPath, 'utf8');
    assert.equal(summaryText.trim(), reportUtils.wechatCommentaryText(await loadSample()));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('previous daily data path resolves from the current report output folder', () => {
  const currentOutputDir = path.join('C:\\Reports\\A股日报', '2026-06-03');
  assert.equal(
    reportUtils.previousDailyDataPath?.(currentOutputDir, '2026-06-02'),
    path.join('C:\\Reports\\A股日报', '2026-06-02', '2026-06-02-daily-data.json')
  );
});

test('renderer emits self-contained HTML with four posters and the approved title', async () => {
  const data = await loadSample();
  const html = renderReportHtml(data);
  assert.match(html, /A股市场情绪日报/);
  assert.equal((html.match(/class="poster\s/g) || []).length, 4);
  assert.match(html, /data-page="1"/);
  assert.match(html, /data-page="4"/);
  assert.doesNotMatch(html, /base-theme\.png|imagegen|repeating-linear-gradient/i);
});

test('renderer applies the approved magazine cover treatment to page 1', async () => {
  const data = await loadSample();
  const html = renderReportHtml(data);
  assert.match(html, /class="de-title-block[^"]*"/);
  assert.match(html, /<span>A股市场<\/span><i>· 情绪日报<\/i>/);
  assert.match(html, /radial-gradient\(circle at 50% 7%/);
  assert.match(html, /width: 1080px/);
});

test('renderer uses A-share color semantics: red bullish and green bearish', async () => {
  const data = await loadSample();
  const html = renderReportHtml(data);
  assert.match(html, /<strong class="bearish">4068\.57<\/strong>/);
  assert.match(html, /background: linear-gradient\(180deg,#ff5252,#cf2d2e\)/);
  assert.match(html, /background: linear-gradient\(180deg,#21bd8c,#0d8a68\)/);
  assert.doesNotMatch(html, /class="metric-value down"/);
});

test('renderer keeps page 4 dense with all role groups, ladder, and next-session judgment', async () => {
  const data = await loadSample();
  const html = renderReportHtml(data);
  for (const heading of ['空间龙', '板块龙头', '容量中军', '核心助攻', '中位接力', '补涨前排', '首板前排', '风险负反馈']) {
    assert.match(html, new RegExp(heading));
  }
  assert.match(html, /连板梯队/);
  assert.match(html, /次日梯队判断/);
});

test('renderer shows previous-day ladder comparisons on page 4 top metrics', async () => {
  const data = await loadSample();
  data.ladder.previous_day = {
    date: '2026-05-28',
    highest_non_st_board: 6,
    consecutive_board_total: 16,
    source_key: 'previous_daily_data'
  };
  data.sources.previous_daily_data = {
    name: '上一交易日daily-data.json',
    url: null
  };
  const html = renderReportHtml(data);
  assert.match(html, /昨日 6板/);
  assert.match(html, /较昨 -1板/);
  assert.match(html, /昨日 16只/);
  assert.match(html, /较昨 -5只/);
  assert.match(html, /class="metric-compare bearish" data-fit>昨日 6板 · 较昨 -1板<\/div>/);
  assert.match(html, /class="metric-compare bearish" data-fit>昨日 16只 · 较昨 -5只<\/div>/);
});

test('schema requires previous-day ladder comparison data', async () => {
  const data = await loadSample();
  data.schema_version = '1.6.0';
  data.ladder.previous_day = {
    date: '2026-05-28',
    highest_non_st_board: 6,
    consecutive_board_total: 16,
    source_key: 'previous_daily_data'
  };
  data.sources.previous_daily_data = {
    name: '上一交易日daily-data.json',
    url: null
  };
  let result = await validateDailyDataAgainstSchema(data);
  assert.deepEqual(result.errors, []);

  delete data.ladder.previous_day;
  result = await validateDailyDataAgainstSchema(data);
  assert.match(result.errors.join('\n'), /ladder\.previous_day is required/);
});

test('renderer shows previous-day limit-up comparisons on page 3 top metrics', async () => {
  const data = await loadSample();
  data.limit_up.previous_day = {
    date: '2026-05-28',
    limit_up: 63,
    limit_down: 21,
    broken_board: 42,
    seal_rate_pct: 60,
    source_key: 'previous_daily_data'
  };
  data.sources.previous_daily_data = {
    name: '上一交易日daily-data.json',
    url: null
  };
  const html = renderReportHtml(data);
  assert.match(html, /昨日 63只 · 较昨 -14只/);
  assert.match(html, /昨日 21只 · 较昨 \+38只/);
  assert.match(html, /昨日 42只 · 较昨 -5只/);
  assert.match(html, /昨日 60% · 较昨 -4pct/);
  assert.match(html, /class="metric-compare bearish" data-fit>昨日 63只 · 较昨 -14只<\/div>/);
  assert.match(html, /class="metric-compare bearish" data-fit>昨日 21只 · 较昨 \+38只<\/div>/);
  assert.match(html, /class="metric-compare bullish" data-fit>昨日 42只 · 较昨 -5只<\/div>/);
  assert.match(html, /class="metric-compare bearish" data-fit>昨日 60% · 较昨 -4pct<\/div>/);
});

test('schema requires previous-day limit-up comparison data', async () => {
  const data = await loadSample();
  data.schema_version = '1.6.0';
  data.limit_up.previous_day = {
    date: '2026-05-28',
    limit_up: 63,
    limit_down: 21,
    broken_board: 42,
    seal_rate_pct: 60,
    source_key: 'previous_daily_data'
  };
  data.sources.previous_daily_data = {
    name: '上一交易日daily-data.json',
    url: null
  };
  let result = await validateDailyDataAgainstSchema(data);
  assert.deepEqual(result.errors, []);

  delete data.limit_up.previous_day;
  result = await validateDailyDataAgainstSchema(data);
  assert.match(result.errors.join('\n'), /limit_up\.previous_day is required/);
});

test('renderer includes chart-like visual components for dense information scanning', async () => {
  const data = await loadSample();
  const html = renderReportHtml(data);
  assert.match(html, /class="sentiment-dial"/);
  assert.match(html, /class="theme-bars"/);
  assert.match(html, /de-ladder-strip/);
});

test('renderer shows all emotion factors with risk-control labels', async () => {
  const data = await loadSample();
  const html = renderReportHtml(data);
  assert.equal((html.match(/class="factor-row /g) || []).length, 10);
  assert.match(html, /封板质量/);
  assert.match(html, /负反馈控制/);
  assert.doesNotMatch(html, /<b>炸板风险<\/b>/);
  assert.doesNotMatch(html, /<b>跌停负反馈<\/b>/);
});

test('renderer explains score bands instead of model confidence on page 2', async () => {
  const data = await loadSample();
  const html = renderReportHtml(data);
  assert.match(html, /情绪分=10项因子加总/);
  assert.match(html, /0-24冰点/);
  assert.doesNotMatch(html, /confidence:/);
});

test('emotion dial color follows state bands', async () => {
  const data = await loadSample();
  data.emotion_model_v1.score = 80;
  let html = renderReportHtml(data);
  assert.match(html, /class="dial-ring bullish"/);

  data.emotion_model_v1.score = 15;
  html = renderReportHtml(data);
  assert.match(html, /class="dial-ring bearish"/);

  data.emotion_model_v1.score = 45;
  html = renderReportHtml(data);
  assert.match(html, /class="dial-ring warning"/);
});

test('page 3 renders theme deep dive as investment memo v2 instead of four-line fill-ins', async () => {
  const data = await loadSample();
  data.theme_interpretation = {
    status: 'both',
    upside: [
      {
        name: '电力',
        stage: '防御承接',
        core_judgment: '电力不是单纯补涨，而是分歧日资金从高波动科技切出的低位承接方向',
        narrative: '指数放量分歧时，能源安全和公用事业的低波动属性被重新定价；题材涨停8只且华电能源、粤电力A维持梯队，说明资金在高位科技兑现后寻找可容纳分歧的防御主线。',
        confirm_signal: '华电能源或粤电力A继续晋级，并带动首板补涨扩散',
        invalidate_signal: '高标断板后后排同步掉队，防御承接退化为一日轮动',
        source_keys: ['stcn_databao', 'cls_limit_review']
      }
    ],
    downside: [
      {
        name: '半导体',
        stage: '高位退潮负反馈',
        core_judgment: '半导体的下跌是前期成长拥挤交易的兑现，不只是行业单日走弱',
        narrative: '行业跌幅居前叠加电子/半导体主力资金大额流出，说明高景气成长线从主动进攻切换到筹码释放；如果容量核心不能止跌，科技线会继续压制指数风险偏好。',
        confirm_signal: '容量核心缩量企稳，跌幅榜不再被半导体扩散占据',
        invalidate_signal: '核心股继续放量下杀并带动光学光电子、设备链补跌',
        source_keys: ['eastmoney_capital']
      }
    ]
  };
  const html = renderReportHtml(data);
  assert.match(html, /题材深读/);
  assert.match(html, /主线炒作解读/);
  assert.match(html, /领跌负反馈解读/);
  assert.match(html, /本质判断/);
  assert.match(html, /来龙去脉/);
  assert.match(html, /确认/);
  assert.match(html, /证伪/);
  assert.match(html, /防御承接/);
  assert.doesNotMatch(html, /题材背景/);
  assert.doesNotMatch(html, /盘面证据/);
  assert.doesNotMatch(html, /资金逻辑/);
  assert.doesNotMatch(html, /持续性观察/);
  assert.doesNotMatch(html, /<h2 data-fit>高度<\/h2>/);
  assert.doesNotMatch(html, /<h2 data-fit>广度<\/h2>/);
  assert.doesNotMatch(html, /<h2 data-fit>风险<\/h2>/);
});

test('schema accepts theme interpretation v2 and caps each side at two themes', async () => {
  const data = await loadSample();
  data.schema_version = '1.6.0';
  data.theme_interpretation = {
    status: 'upside_only',
    upside: [
      {
        name: '电力',
        stage: '防御承接',
        core_judgment: '电力承担分歧日低位承接功能',
        narrative: '题材涨停8只并有高标维持梯队，说明资金从高波动科技切向低位防御，但持续性仍要看容量和梯队能否同步强化。',
        confirm_signal: '高标晋级并带动首板扩散',
        invalidate_signal: '高标断板且补涨首板减少',
        source_keys: ['stcn_databao']
      },
      {
        name: '房地产',
        stage: '低位补涨试错',
        core_judgment: '房地产更偏低位轮动试错而非独立主升',
        narrative: '题材涨停6只且香江控股处于空间高度，说明低位弹性获得资金试错；但中位梯队不足，仍需后排继续补齐才可能升级为主线。',
        confirm_signal: '中位接力补强并形成2到5板完整梯队',
        invalidate_signal: '空间股断板后补涨首板无法延续',
        source_keys: ['cls_limit_review']
      }
    ],
    downside: []
  };
  let result = await validateDailyDataAgainstSchema(data);
  assert.deepEqual(result.errors, []);

  data.theme_interpretation.upside.push({
    name: '银行',
    stage: '权重护盘',
    core_judgment: '银行更像指数稳定器而非短线主线',
    narrative: '行业表现相对抗跌，说明风险偏好下降时权重承接指数，但缺少涨停梯队和弹性辨识度。',
    confirm_signal: '权重放量上攻并带动金融扩散',
    invalidate_signal: '冲高回落且资金重新回到成长线',
    source_keys: ['eastmoney_capital']
  });
  result = await validateDailyDataAgainstSchema(data);
  assert.match(result.errors.join('\n'), /at most 2 items/);
});

test('schema rejects legacy four-line theme interpretation fields', async () => {
  const data = await loadSample();
  data.schema_version = '1.6.0';
  data.theme_interpretation = {
    status: 'upside_only',
    upside: [
      {
        name: '电力',
        background: '旧版题材背景',
        evidence: '旧版盘面证据',
        logic: '旧版资金逻辑',
        watch: '旧版持续性观察',
        source_key: 'stcn_databao'
      }
    ],
    downside: []
  };
  const result = await validateDailyDataAgainstSchema(data);
  const text = result.errors.join('\n');
  assert.match(text, /core_judgment is required/);
  assert.match(text, /source_keys is required/);
  assert.match(text, /background is not allowed/);
});

test('page 3 renders no clear mainline state when no theme qualifies', async () => {
  const data = await loadSample();
  data.theme_interpretation = {
    status: 'no_clear_mainline',
    upside: [],
    downside: [],
    no_clear_mainline: {
      stage: '无明确主线状态',
      core_judgment: '涨停分布分散且行业涨跌缺少持续共振',
      narrative: '强势题材未形成连续梯队，资金只在低位分支试错，轮动速度偏快，短线情绪以防御和等待新共振为主。',
      confirm_signal: '放量共振或核心板块连续两日确认',
      invalidate_signal: '继续缩量轮动且高标无法打开空间',
      source_keys: ['cls_limit_review']
    }
  };
  const html = renderReportHtml(data);
  assert.match(html, /无明确主线状态/);
  assert.match(html, /放量共振/);
});

test('page 1 market status colors volume change and breadth counts with A-share semantics', async () => {
  const data = await loadSample();
  data.turnover.change_text = '较上日缩量约4443亿';
  data.turnover.change_yuan = -444300000000;
  data.breadth.up = 3776;
  data.breadth.down = 1682;
  let html = renderReportHtml(data);
  assert.match(html, /<strong class="bearish">较上日缩量约4443亿<\/strong>/);
  assert.match(html, /<strong class="bullish">3776<\/strong>/);
  assert.match(html, /<strong class="bearish">1682<\/strong>/);

  data.turnover.change_text = '较上日放量约3500亿';
  data.turnover.change_yuan = 350000000000;
  html = renderReportHtml(data);
  assert.match(html, /<strong class="bullish">较上日放量约3500亿<\/strong>/);
});

test('seal rate color follows A-share risk-control semantics', async () => {
  const data = await loadSample();
  data.limit_up.seal_rate_pct = 83;
  let html = renderReportHtml(data);
  assert.match(html, /<strong>83<em>%<\/em><\/strong>/);
  assert.match(html, /<div class="de-limit-card red">[\s\S]*<strong>83/);

  data.limit_up.seal_rate_pct = 42;
  html = renderReportHtml(data);
  assert.match(html, /<strong>42<em>%<\/em><\/strong>/);
});
