import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { THEMES, resolveTheme } from '../scripts/themes.mjs';
import { launchChromium, renderReport, renderReportHtml, runBrowserPreflight } from '../scripts/render-report.mjs';
import { validateSourceNotesText } from '../scripts/validate-report.mjs';
import * as reportUtils from '../scripts/lib/report-utils.mjs';

const { validateDailyData, validateDailyDataAgainstSchema } = reportUtils;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const samplePath = path.join(skillRoot, 'fixtures', 'sample-daily-data.json');

async function loadSample() {
  return JSON.parse(await readFile(samplePath, 'utf8'));
}

function applyRoleStressData(data) {
  data.report_date = '2026-06-22';
  data.weekday = '周一';
  data.leader_roles = {
    空间龙: [
      { name: '旭光电子', theme: '光通信/氯化铝', board: 5, reason: '压力测试' },
      { name: '香江控股', theme: '地产/统一大市场', board: 5, reason: '压力测试' }
    ],
    板块龙头: [
      { name: '江钨装备', theme: '有色钨/稀有金属', board: 4, reason: '压力测试' },
      { name: '艾华集团', theme: '被动元件/铝电容', board: 4, reason: '压力测试' }
    ],
    容量中军: [
      { name: '东方财富', theme: '券商/互联网金融', board: 1, reason: '压力测试' },
      { name: '阳光电源', theme: '光伏逆变器/储能', board: 1, reason: '压力测试' }
    ],
    核心助攻: [
      { name: '中兴通讯', theme: '通信设备/算力基建', board: 1, reason: '压力测试' },
      { name: '江海股份', theme: '电力设备/超级电容', board: 1, reason: '压力测试' }
    ],
    中位接力: [
      { name: '冰轮环境', theme: '液冷服务器/冷链设备', board: 3, reason: '压力测试' },
      { name: '合锻智能', theme: '光模块/CPO/专用设备', board: 4, reason: '压力测试' }
    ],
    补涨前排: [],
    首板前排: [],
    风险负反馈: [
      { name: '天孚通信', theme: '光模块/CPO/高速连接器', board: null, reason: '压力测试' },
      { name: '东山精密', theme: 'PCB/电子电路/消费电子', board: null, reason: '压力测试' }
    ]
  };
  data.next_session_signals = {
    确认信号: ['华电能源或者香江控股继续晋级并带动板块扩散'],
    弱化信号: ['中位接力票继续放量分歧且补涨断层'],
    风险信号: ['科技容量核心继续走弱并压制指数风险偏好']
  };
  return data;
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

test('page 3 renders concept gainers with pct bars and limit-up counts', async () => {
  const data = await loadSample();
  const validation = validateDailyData(data);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.warnings.length, 0);

  const html = renderReportHtml(data);
  assert.doesNotMatch(html, /当日无明显领涨题材/);
  assert.doesNotMatch(html, /当日无明显领跌题材/);
  assert.match(html, /题材概念口径/);
  assert.match(html, /涨停家数/);
  assert.match(html, /<i>涨幅<\/i>/);
  assert.match(html, /电力/);
  assert.match(html, /\+5\.2%/);
  assert.match(html, /<em>8<\/em>/);
});

test('validation rejects concept gainers that have limit-up count but no pct value', async () => {
  const data = await loadSample();
  data.themes.concept_counts = [
    { name: 'PCB概念', pct: null, up: 26, 口径: '题材概念口径' },
    { name: '通信设备/CPO/光模块', pct: null, up: 26, 口径: '题材概念口径' },
    { name: '机械设备', pct: null, up: 19, 口径: '题材概念口径' },
    { name: '有色金属', pct: null, up: 14, 口径: '题材概念口径' },
    { name: '元器件/MLCC/铜箔/电子布', pct: 10.31, up: 13, 口径: '题材概念口径' },
    { name: '煤炭概念', pct: -3.19, 口径: '题材概念口径' },
    { name: '油气设服', pct: -2.45, 口径: '题材概念口径' }
  ];
  data.themes.industry_counts = [
    { name: '电子元件', pct: 6.98, 口径: '行业口径' },
    { name: '电子化学品', pct: 6.68, 口径: '行业口径' }
  ];

  const validation = validateDailyData(data);
  assert.match(validation.errors.join('\n'), /positive up items must include pct/);
  assert.match(validation.errors.join('\n'), /PCB概念/);
});

test('page 3 gainer bar-end labels are percentages while limit-up count stays in the right column', async () => {
  const data = await loadSample();
  data.themes.concept_counts = [
    { name: 'PCB概念', pct: 6.98, up: 26, 口径: '题材概念口径' },
    { name: '通信设备/CPO/光模块', pct: 6.32, up: 26, 口径: '题材概念口径' },
    { name: '机械设备', pct: 3.18, up: 19, 口径: '题材概念口径' },
    { name: '有色金属', pct: 2.76, up: 14, 口径: '题材概念口径' },
    { name: '元器件/MLCC/铜箔/电子布', pct: 10.31, up: 13, 口径: '题材概念口径' },
    { name: '煤炭概念', pct: -3.19, 口径: '题材概念口径' },
    { name: '油气设服', pct: -2.45, 口径: '题材概念口径' }
  ];

  const html = renderReportHtml(data);
  assert.match(html, /PCB概念/);
  assert.match(html, /通信设备\/CPO\/光模块/);
  assert.match(html, /机械设备/);
  assert.match(html, /有色金属/);
  assert.match(html, /元器件\/MLCC\/铜箔\/电子布/);
  assert.match(html, /<i>涨幅<\/i>/);
  assert.match(html, />\+10\.3%<\/u>/);
  assert.match(html, />\+7\.0%<\/u>/);
  assert.doesNotMatch(html, />26只<\/u>/);
  assert.match(html, /<em>26<\/em>/);
  assert.match(html, /\+10\.3%/);
});

test('validation rejects page 3 theme bars with no usable gainers or losers metric', async () => {
  const data = await loadSample();
  data.themes.concept_counts = data.themes.concept_counts.map(({ pct, up, ...item }) => item);
  data.themes.industry_counts = data.themes.industry_counts.map(({ pct, ...item }) => item);
  const result = validateDailyData(data);
  assert.match(result.errors.join('\n'), /must include positive numeric pct values/);
  assert.match(result.errors.join('\n'), /must include negative numeric pct values/);
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

test('dark editorial page 1 market judgment fits long headline and detail copy', async () => {
  const data = await loadSample();
  data.market_summary.headline = '放量重返4000点 · 有色/航天/券商三线高低切换 · 高位AI硬件大幅失血';
  data.market_summary.style_shift = '资金从高位半导体材料/AI硬件/通信大票大幅撤出，集体涌向有色金属/小金属/商业航天/大金融/锂电池等低位方向。';

  const html = renderReportHtml(data);

  assert.match(html, /class="de-judgement-body" data-fit/);
  assert.match(html, /class="de-headline" data-fit/);
  assert.match(html, /资金从高位半导体材料\/AI硬件\/通信大票大幅撤出/);
  assert.match(html, /\.de-judgement-body \{[^}]*top: 58px; bottom: 18px;[^}]*justify-content: center;[^}]*align-items: center;[^}]*gap: var\(--de-judgement-gap, 8px\);/);
  assert.match(html, /\.de-headline-chip \{[^}]*font-size: var\(--de-headline-size, 36px\);[^}]*line-height: 1\.08;[^}]*overflow-wrap: anywhere;[^}]*word-break: break-word;/);
  assert.match(html, /\.de-judgement p \{[^}]*font-size: var\(--de-detail-size, 18px\);[^}]*line-height: 1\.32;[^}]*overflow-wrap: anywhere;[^}]*word-break: break-word;/);
  assert.match(html, /fitDarkEditorialJudgement/);
  assert.match(runBrowserPreflight.toString(), /\.de-judgement-body/);
  assert.match(runBrowserPreflight.toString(), /criticalOverflow[\s\S]*\.de-judgement-body/);
});

test('dark editorial page 2 signal cards wrap primary long signals without ellipsis', async () => {
  const data = await loadSample();
  data.next_session_signals = {
    确认信号: [
      '洛阳钼业/铜陵有色次日继续放量承接，有色行业主线保持扩散',
      '券商/商业航天低位分支继续出现首板补涨并维持封单',
      '第三条多头信号保留在JSON但不挤入图片'
    ],
    弱化信号: ['中位接力票继续放量分歧且补涨断层'],
    风险信号: [
      '高位AI硬件/通信大票继续大规模失血并带动有色/商业航天同步回落',
      '新易盛/亨通光电/中兴通讯次日继续放量下杀并触发科技容量负反馈',
      '第三条空头信号保留在JSON但不挤入图片'
    ]
  };

  const html = renderReportHtml(data);

  assert.match(html, /洛阳钼业\/铜陵有色次日继续放量承接/);
  assert.match(html, /新易盛\/亨通光电\/中兴通讯次日继续放量下杀/);
  assert.doesNotMatch(html, /第三条多头信号保留在JSON但不挤入图片/);
  assert.doesNotMatch(html, /第三条空头信号保留在JSON但不挤入图片/);
  assert.match(html, /\.de-signal-card li \{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;[^}]*word-break: break-word;/);
  assert.doesNotMatch(html, /\.de-signal-card li \{[^}]*text-overflow: ellipsis;/);
});

test('renderer uses A-share color semantics: red bullish and green bearish', async () => {
  const data = await loadSample();
  const html = renderReportHtml(data);
  assert.match(html, /<strong class="bearish">4068\.57<\/strong>/);
  assert.match(html, /background: linear-gradient\(90deg,#ff7068 0%,#f03535 45%,#b51b1b 100%\)/);
  assert.match(html, /background: linear-gradient\(90deg,#0c8a68 0%,#1ab47b 55%,#4cd6a3 100%\)/);
  assert.doesNotMatch(html, /class="metric-value down"/);
});

test('renderer keeps page 4 focused on six market-defining role groups, ladder, and next-session judgment', async () => {
  const data = await loadSample();
  const html = renderReportHtml(data);
  for (const heading of ['空间龙', '板块龙头', '容量中军', '核心助攻', '中位接力', '风险负反馈']) {
    assert.match(html, new RegExp(heading));
  }
  assert.doesNotMatch(html, />补涨前排</);
  assert.doesNotMatch(html, />首板前排</);
  assert.match(html, /连板梯队/);
  assert.match(html, /次日梯队判断/);
});

test('dark editorial page 4 gives next-session ladder judgment enough room and flags clipping', async () => {
  const data = await loadSample();
  data.next_session_signals = {
    确认信号: ['中际旭创/新易盛/生益科技次日继续放量承接，AI硬件行业主力净流入维持百亿以上'],
    弱化信号: ['成交额跌破2.8万亿且千亿科技权重冲高回落，连板中位股补涨断层'],
    风险信号: ['宿迁联盛/和远气体断板后继续大跌，引发高位股份反馈扩散']
  };

  const html = renderReportHtml(data);

  assert.match(html, /中际旭创\/新易盛\/生益科技次日继续放量承接/);
  assert.match(html, /\.de-roles-panel \{ left: 26px; right: 26px; top: 716px; height: 396px;/);
  assert.match(html, /\.de-watch-panel \{ left: 26px; right: 26px; top: 1126px; height: 208px;/);
  assert.match(html, /\.de-watch-card \{[^}]*min-height: 0;[^}]*padding: 12px 16px;[^}]*overflow: hidden;/);
  assert.match(html, /\.de-watch-card p \{[^}]*font-size: 16px;[^}]*line-height: 1\.38;[^}]*overflow-wrap: anywhere;[^}]*word-break: break-word;/);
  assert.match(runBrowserPreflight.toString(), /\.de-watch-card/);
  assert.match(runBrowserPreflight.toString(), /criticalOverflow[\s\S]*\.de-watch-card/);
  assert.match(runBrowserPreflight.toString(), /criticalOverflow[\s\S]*\.role-card/);
  assert.match(runBrowserPreflight.toString(), /parent-panel clipping/);
  assert.match(runBrowserPreflight.toString(), /footer overlap/);
  assert.match(runBrowserPreflight.toString(), /footerOverlapCandidates/);
  assert.match(runBrowserPreflight.toString(), /panel overlap/);
});

test('dark editorial role rows keep names fixed and wrap descriptions without clipping', async () => {
  const data = await loadSample();
  const html = renderReportHtml(data);
  assert.match(html, /\.de-roles-grid \{[^}]*grid-template-rows: repeat\(2, minmax\(0, 1fr\)\);[^}]*min-height: 0;/);
  assert.match(html, /\.role-card \{[^}]*min-height: 0;[^}]*overflow: hidden;/);
  assert.match(html, /\.leader-row \{ display: grid; grid-template-columns: 5\.2em minmax\(0, 1fr\);/);
  assert.match(html, /\.leader-row b \{[^}]*white-space: nowrap;[^}]*overflow: visible;/);
  assert.match(html, /\.leader-row span \{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;[^}]*word-break: break-word;/);
  assert.match(html, /\.leader-row em \{[^}]*font-size: 16px;[^}]*font-weight: 800;/);
  assert.match(html, /<em>5板<\/em> 地产/);
  assert.match(html, /<em>容量<\/em> 通信/);
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
  assert.match(html, /class="metric-compare bearish" data-fit><span class="metric-compare-prev">昨日 6板<\/span><span class="metric-compare-delta">较昨 -1板<\/span><\/div>/);
  assert.match(html, /class="metric-compare bearish" data-fit><span class="metric-compare-prev">昨日 16只<\/span><span class="metric-compare-delta">较昨 -5只<\/span><\/div>/);
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
  assert.match(html, /昨日 63只/);
  assert.match(html, /较昨 -14只/);
  assert.match(html, /昨日 21只/);
  assert.match(html, /较昨 \+38只/);
  assert.match(html, /昨日 42只/);
  assert.match(html, /较昨 -5只/);
  assert.match(html, /昨日 60%/);
  assert.match(html, /较昨 -4pct/);
  assert.match(html, /class="metric-compare bearish" data-fit><span class="metric-compare-prev">昨日 63只<\/span><span class="metric-compare-delta">较昨 -14只<\/span><\/div>/);
  assert.match(html, /class="metric-compare bearish" data-fit><span class="metric-compare-prev">昨日 21只<\/span><span class="metric-compare-delta">较昨 \+38只<\/span><\/div>/);
  assert.match(html, /class="metric-compare bullish" data-fit><span class="metric-compare-prev">昨日 42只<\/span><span class="metric-compare-delta">较昨 -5只<\/span><\/div>/);
  assert.match(html, /class="metric-compare bearish" data-fit><span class="metric-compare-prev">昨日 60%<\/span><span class="metric-compare-delta">较昨 -4pct<\/span><\/div>/);
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
  assert.match(html, /class="theme-bars /);
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
  assert.match(html, /情绪极致 · 追高风险大/);
  assert.match(html, /0-24/);
  assert.match(html, /\.de-dial-bands \.band i \{[^}]*font-size: 21px;[^}]*font-weight: 800;/);
  assert.match(html, /\.de-dial-bands \.band p \{[^}]*font-size: 18px;/);
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

test('page 3 renders only the strongest hot theme as investment memo v2', async () => {
  const data = await loadSample();
  data.theme_interpretation = {
    status: 'both',
    upside: [
      {
        name: '超强主线A',
        stage: '防御承接',
        core_judgment: '超强主线A不是单纯补涨，而是分歧日资金从高波动科技切出的低位承接方向',
        narrative: '指数放量分歧时，低波动属性被重新定价；题材涨停8只且核心股维持梯队，说明资金在高位兑现后寻找可容纳分歧的防御主线。',
        confirm_signal: '华电能源或粤电力A继续晋级，并带动首板补涨扩散',
        invalidate_signal: '高标断板后后排同步掉队，防御承接退化为一日轮动',
        source_keys: ['stcn_databao', 'cls_limit_review']
      },
      {
        name: '备选主线B',
        stage: '低位补涨试错',
        core_judgment: '备选主线B仍是次强分支',
        narrative: '它具备一定涨停数量，但容量锚和梯队完整度弱于第一主线。',
        confirm_signal: '容量核心放量确认',
        invalidate_signal: '后排补涨减少',
        source_keys: ['cls_limit_review']
      }
    ],
    downside: [
      {
        name: '风险线C',
        stage: '高位退潮负反馈',
        core_judgment: '风险线C的下跌是前期拥挤交易的兑现，不只是行业单日走弱',
        narrative: '行业跌幅居前叠加电子/半导体主力资金大额流出，说明高景气成长线从主动进攻切换到筹码释放；如果容量核心不能止跌，科技线会继续压制指数风险偏好。',
        confirm_signal: '容量核心缩量企稳，跌幅榜不再被半导体扩散占据',
        invalidate_signal: '核心股继续放量下杀并带动光学光电子、设备链补跌',
        source_keys: ['eastmoney_capital']
      }
    ]
  };
  const html = renderReportHtml(data);
  assert.match(html, /题材深读/);
  assert.match(html, /最强炒作题材深读/);
  assert.match(html, /超强主线A/);
  assert.doesNotMatch(html, /备选主线B/);
  assert.doesNotMatch(html, /风险线C/);
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

test('page 3 deep dive compacts long analysis for image-safe rendering', async () => {
  const data = await loadSample();
  data.theme_interpretation.upside[0].core_judgment = '长文本主线不是普通反抽，而是弱势盘面里资金集中抱团的方向';
  data.theme_interpretation.upside[0].narrative = [
    '第一句说明主线的资金选择逻辑和盘面位置。',
    '第二句继续解释连板梯队、容量中军和首板扩散之间的关系。',
    '第三句补充资金流和昨日对比，但图片不应该为了塞满所有原文而裁断确认信号。',
    '第四句继续补充很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多很多细节。',
    '第五句继续补充更多更多更多更多更多更多更多更多更多更多更多更多更多更多更多更多更多更多更多更多更多更多更多更多更多更多更多更多细节。',
    '尾部不应显示'
  ].join('');
  const html = renderReportHtml(data);
  assert.match(html, /长文本主线/);
  assert.match(html, /…/);
  assert.match(html, /确认/);
  assert.match(html, /证伪/);
  assert.doesNotMatch(html, /尾部不应显示/);
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
  assert.match(html, /<em class="de-money-change bearish" data-fit>较昨日 缩量约4443亿<\/em>/);
  assert.match(html, /<strong class="bullish">3776<\/strong>/);
  assert.match(html, /<strong class="bearish">1682<\/strong>/);

  data.turnover.change_text = '较上日放量约3500亿';
  data.turnover.change_yuan = 350000000000;
  html = renderReportHtml(data);
  assert.match(html, /<em class="de-money-change bullish" data-fit>较昨日 放量约3500亿<\/em>/);
});

test('light page 1 breadth footer keeps only ratio and limit counts', async () => {
  const data = await loadSample();
  data.theme = '浅色机构午报风格';
  data.breadth.up = 3923;
  data.breadth.down = 1515;
  data.breadth.ratio_text = '';
  data.breadth.notable = '超3900只个股上涨，涨跌比约72:28';
  const html = renderReportHtml(data, { theme: '浅色机构午报风格' });
  const match = html.match(/<div class="li-breadth-foot">([\s\S]*?)<\/div>/);
  assert.ok(match);
  assert.match(match[1], /涨跌比\s*3923:1515/);
  assert.match(match[1], /涨停/);
  assert.match(match[1], /跌停/);
  assert.doesNotMatch(match[1], /超3900/);
  assert.equal((match[1].match(/<span>/g) ?? []).length, 3);
});

test('dark terminal page 1 breadth description stays below bar without crowding', async () => {
  const data = await loadSample();
  data.theme = '深色终端杂志风格';
  data.breadth.up = 1720;
  data.breadth.down = 3732;
  data.breadth.ratio_text = '涨跌比 --';
  data.breadth.notable = '上涨占比仅31.5%，超3700只个股下跌，指数涨个股跌背离创近期新高';
  data.limit_up.limit_up = 86;
  data.limit_up.limit_down = 1;

  const html = renderReportHtml(data, { theme: '深色终端杂志风格' });

  assert.match(html, /<div class="dt-breadth-foot" data-fit>/);
  assert.match(html, /class="dt-breadth-note" data-fit/);
  assert.match(html, /上涨占比仅31\.5/);
  assert.match(html, /\.dt-breadth-bar \{[^}]*top: 118px; height: 34px;/);
  assert.match(html, /\.dt-breadth-foot \{[^}]*top: 164px; height: 80px;[^}]*font-size: 17px;[^}]*overflow: hidden;/);
  assert.match(html, /\.dt-breadth-foot \.dt-breadth-note \{[^}]*-webkit-line-clamp: 3;[^}]*overflow-wrap: anywhere;[^}]*word-break: break-word;/);
});

test('light page 2 score ring contains only score and shows cycle below', async () => {
  const data = await loadSample();
  data.theme = '浅色机构午报风格';
  data.emotion_model_v1.score = 68;
  data.emotion_model_v1.state = '分歧修复初期';
  const html = renderReportHtml(data, { theme: '浅色机构午报风格' });
  const page2 = html.match(/<section class="poster li-poster li-page2"[\s\S]*?<section class="li-panel li-factor-panel">/);
  assert.ok(page2);
  assert.match(page2[0], /<div class="li-score-ring bullish-soft"[^>]*>\s*<span>68<\/span>\s*<\/div>/);
  assert.match(page2[0], /<strong class="bullish-soft" data-fit>分歧修复初期<\/strong>/);
  assert.match(page2[0], /当前情绪周期/);
  const ringMarkup = page2[0].match(/<div class="li-score-ring[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.doesNotMatch(ringMarkup, /分歧修复初期|\/100|85\+ 高潮|70-84 扩散/);
});

test('light page 3 keeps display口径 out of hero and at metric bottom', async () => {
  const data = await loadSample();
  data.theme = '浅色机构午报风格';
  data.limit_up.display口径 = '非ST短线口径';
  const html = renderReportHtml(data, { theme: '浅色机构午报风格' });
  const page3 = html.match(/<section class="poster li-poster li-page3"[\s\S]*?<section class="li-panel li-theme-panel">/);
  assert.ok(page3);
  const hero = page3[0].match(/<section class="li-hero li-hero-page3">([\s\S]*?)<\/section>/)?.[1] ?? '';
  assert.doesNotMatch(hero, /展示口径|非ST短线口径/);
  const limitUpCard = page3[0].match(/<div class="li-metric-box bullish">([\s\S]*?)<\/div>\s*<div class="li-metric-box bearish">/)?.[1] ?? '';
  assert.match(limitUpCard, /<strong>127<\/strong>|<strong>89<\/strong>|<strong>\d+<\/strong>/);
  assert.ok(limitUpCard.indexOf('metric-compare') < limitUpCard.indexOf('非ST短线口径'));
});

test('light page 4 reserves vertical gaps between lower panels and footer', async () => {
  const data = await loadSample();
  data.theme = '浅色机构午报风格';
  const html = renderReportHtml(data, { theme: '浅色机构午报风格' });
  assert.match(html, /\.li-ladder-head \{ left: 34px; right: 34px; top: 250px; height: 242px;/);
  assert.match(html, /\.li-ladder-card \{[^}]*padding: 12px 24px;[^}]*min-height: 0;/);
  assert.match(html, /\.li-ladder-strip \{ left: 34px; right: 34px; top: 510px; height: 242px;/);
  assert.match(html, /\.li-ladder-rows \{[^}]*grid-template-rows: repeat\(4, minmax\(0, 1fr\)\);[^}]*gap: 6px;[^}]*min-height: 0;/);
  assert.match(html, /\.li-ladder-row \{[^}]*grid-template-columns: 74px minmax\(0, 1fr\);[^}]*min-height: 0;/);
  assert.match(runBrowserPreflight.toString(), /\.li-ladder-rows/);
  assert.match(runBrowserPreflight.toString(), /criticalOverflow[\s\S]*\.li-ladder-rows/);
  assert.match(html, /\.li-roles-panel \{ left: 34px; right: 34px; top: 768px; height: 364px;/);
  assert.match(html, /\.li-watch-panel \{ left: 34px; right: 34px; top: 1150px; height: 190px;/);
  assert.match(html, /<span class="li-section-icon metrics">/);
  assert.match(html, /<span class="li-section-icon ladder">/);
  assert.match(html, /<span class="li-section-icon roles">/);
  assert.match(html, /<span class="li-section-icon watch">/);
  assert.match(html, /\.li-watch-grid p \{[^}]*font-size: 14px;[^}]*-webkit-line-clamp: 4;/);
  assert.match(html, /\.li-roles-grid \{[^}]*grid-template-rows: repeat\(2, minmax\(0, 1fr\)\);[^}]*min-height: 0;/);
  assert.match(html, /\.leader-row \{ display: grid; grid-template-columns: 5\.2em minmax\(0, 1fr\);/);
  assert.match(html, /\.leader-row b \{[^}]*white-space: nowrap;[^}]*overflow: visible;/);
  assert.match(html, /\.leader-row span \{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;[^}]*word-break: break-word;/);
});

test('browser preflight keeps page 4 role mapping unclipped across all themes', async (t) => {
  const browser = await launchChromium();
  t.after(async () => {
    await browser.close();
  });

  for (const theme of ['暗金杂志封面风格', '浅色机构午报风格', '深色终端杂志风格']) {
    const data = applyRoleStressData(await loadSample());
    data.theme = theme;
    const page = await browser.newPage({ viewport: { width: 1200, height: 1600 }, deviceScaleFactor: 1 });
    try {
      await page.setContent(renderReportHtml(data, { theme }), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts?.ready);
      const errors = await runBrowserPreflight(page);
      assert.deepEqual(errors, [], `${theme}\n${errors.join('\n')}`);

      const roleLayout = await page.evaluate(() => {
        const panel = document.querySelector('[data-page="4"] .de-roles-panel, [data-page="4"] .li-roles-panel, [data-page="4"] .dt-roles-panel');
        const panelRect = panel.getBoundingClientRect();
        const clippedCards = Array.from(document.querySelectorAll('[data-page="4"] .role-card'))
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.top < panelRect.top - 2 || rect.bottom > panelRect.bottom + 2;
          })
          .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 32));
        const nonWrappingRows = Array.from(document.querySelectorAll('[data-page="4"] .leader-row span'))
          .filter((el) => window.getComputedStyle(el).whiteSpace === 'nowrap')
          .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim());
        return {
          panelOverflow: panel.scrollHeight - panel.clientHeight,
          clippedCards,
          nonWrappingRows
        };
      });

      assert.ok(roleLayout.panelOverflow <= 4, `${theme} role panel overflowed by ${roleLayout.panelOverflow}px`);
      assert.deepEqual(roleLayout.clippedCards, [], `${theme} role cards escaped the role panel`);
      assert.deepEqual(roleLayout.nonWrappingRows, [], `${theme} role descriptions should wrap instead of ellipsizing`);
    } finally {
      await page.close();
    }
  }
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
