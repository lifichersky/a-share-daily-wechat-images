#!/usr/bin/env node
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveTheme } from './themes.mjs';
import {
  REPORT_TITLE,
  escapeHtml,
  outputPngName,
  pctText,
  printValidationResult,
  readJsonFile,
  readPngDimensions,
  reportHtmlName,
  wechatCommentaryName,
  wechatCommentaryText,
  marketClass,
  flowClass,
  validateDailyDataAgainstSchema,
  validateDailyData
} from './lib/report-utils.mjs';

const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const args = { htmlOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--data') args.data = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--theme') args.theme = argv[++i];
    else if (arg === '--html-only') args.htmlOnly = true;
    else if (!arg.startsWith('--') && !args.data) args.data = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.data) throw new Error('Usage: node render-report.mjs --data <daily-data.json> [--out <dir>] [--theme <name>] [--html-only]');
  return args;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatChineseDate(dateText, { joiner = '' } = {}) {
  const match = String(dateText ?? '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return String(dateText ?? '');
  return `${match[1]}${joiner}年${joiner}${Number(match[2])}${joiner}月${joiner}${Number(match[3])}${joiner}日`;
}

function lightChineseDate(dateText) {
  return formatChineseDate(dateText, { joiner: ' ' });
}

function darkChineseDate(dateText) {
  return formatChineseDate(dateText, { joiner: '' });
}

function factorDisplayName(name) {
  return new Map([
    ['炸板风险', '封板质量'],
    ['跌停负反馈', '负反馈控制']
  ]).get(name) ?? name;
}

function emotionScoreClass(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'neutral';
  if (n <= 39) return 'bearish';
  if (n <= 54) return 'warning';
  return 'bullish';
}

function emotionBandNote() {
  return '情绪分=10项因子加总；0-24冰点，25-39弱修复，40-54分歧，55-69修复初期，70-84主线扩散，85+高潮。';
}

function scoreClass(score, max = 100) {
  const ratio = Number(score) / Number(max || 100);
  if (!Number.isFinite(ratio)) return 'neutral';
  if (ratio >= 0.62) return 'bullish';
  if (ratio <= 0.38) return 'bearish';
  return 'warning';
}

function roleClass(role) {
  if (role === '风险负反馈') return 'bearish';
  if (role === '中位接力') return 'warning';
  return 'bullish';
}

function roleItems(items, limit = 4) {
  return (items ?? []).slice(0, limit).map((item) => {
    const board = item.board ? `<em>${escapeHtml(item.board)}板</em>` : '<em>容量</em>';
    return `
      <div class="leader-row" data-fit>
        <b>${escapeHtml(item.name)}</b>
        <span>${board}${escapeHtml(item.theme ?? '')}</span>
      </div>
    `;
  }).join('');
}

function rolePanel(role, items, limit = 3) {
  return `
    <div class="panel role-card ${roleClass(role)}">
      <h2 data-fit>${escapeHtml(role)}</h2>
      ${roleItems(items, limit)}
    </div>
  `;
}

function factorItems(factors, limit = 5) {
  return (factors ?? []).slice(0, limit).map((factor) => {
    const width = clamp(Math.round((factor.score / factor.max) * 100), 0, 100);
    const cls = scoreClass(factor.score, factor.max);
    return `
      <div class="factor-row ${cls}" data-fit>
        <div><b>${escapeHtml(factorDisplayName(factor.name))}</b><span>${factor.score}/${factor.max}</span></div>
        <div class="bar"><i style="width:${width}%"></i></div>
      </div>
    `;
  }).join('');
}

function volumeChangeClass(turnover) {
  const n = Number(turnover?.change_yuan);
  if (Number.isFinite(n) && n !== 0) return n > 0 ? 'bullish' : 'bearish';
  const text = String(turnover?.change_text ?? '');
  if (/缩量|减少|萎缩|下降/.test(text)) return 'bearish';
  if (/放量|增量|增加|扩大/.test(text)) return 'bullish';
  return 'neutral';
}

function breadthLine(breadth) {
  return `${escapeHtml(breadth?.notable)}，上涨 <b class="bullish">${escapeHtml(breadth?.up)}</b> 家 / 下跌 <b class="bearish">${escapeHtml(breadth?.down)}</b> 家。`;
}

function flowPills(items, limit = 4) {
  return `
    <div class="flow-list">
      ${(items ?? []).slice(0, limit).map((item) => `
        <div class="flow-pill ${flowClass(item.amount_text)}" data-fit>
          <span>${escapeHtml(item.name)}</span>
          <b>${escapeHtml(item.amount_text)}</b>
        </div>
      `).join('')}
    </div>
  `;
}

function topGainersThemeBars(items, limit = 5) {
  // 领涨题材 - 固定 5 行布局：题材 / 涨幅(条形+数值) / 涨停数，三列均显示列标题
  // 行号对齐：始终渲染 5 行 + 列标题行，不足 5 条时显示占位条 + 列名占位
  const source = (items ?? []).filter((item) => Number(item.pct ?? 0) > 0);
  const list = source
    .slice()
    .sort((a, b) => Number(b.pct) - Number(a.pct))
    .slice(0, limit);
  const maxPct = Math.max(...list.map((item) => Math.abs(Number(item.pct ?? 0))), 1);

  const header = `
    <div class="theme-bar-row theme-bar-header">
      <span>题材</span>
      <i>涨幅</i>
      <em>涨停数</em>
    </div>
  `;

  const dataRows = Array.from({ length: limit }, (_, idx) => {
    const item = list[idx];
    if (!item) {
      // 占位行：保留列名占位，条形空，颜色淡化
      return `
        <div class="theme-bar-row theme-bar-placeholder">
          <span>—</span>
          <i class="bar-track" style="--bar-width:0%"><b></b><u>—</u></i>
          <em>—</em>
        </div>
      `;
    }
    const pct = Number(item.pct ?? 0);
    const up = Number(item.up ?? 0);
    const width = clamp(Math.round((Math.abs(pct) / maxPct) * 100), 14, 100);
    return `
      <div class="theme-bar-row theme-bar bullish" data-fit>
        <span>${escapeHtml(item.name)}</span>
        <i class="bar-track" style="--bar-width:${width}%"><b></b><u>+${pct.toFixed(1)}%</u></i>
        <em>${escapeHtml(String(up))}</em>
      </div>
    `;
  }).join('');

  if (!list.length) {
    return `
      <div class="theme-bars gainers">
        ${header}
        <div class="theme-empty">当日无明显领涨题材</div>
      </div>
    `;
  }

  return `
    <div class="theme-bars gainers">
      ${header}
      ${dataRows}
    </div>
  `;
}

function topLosersThemeBars(items, limit = 5) {
  // 领跌题材 - 固定 5 行布局：题材 / 跌幅(条形+数值)，两列均显示列标题
  // 行号对齐：始终渲染 5 行 + 列标题行，与左侧领涨同步
  const source = (items ?? []).filter((item) => Number(item.pct ?? 0) < 0);
  const list = source
    .slice()
    .sort((a, b) => Number(a.pct) - Number(b.pct))
    .slice(0, limit);
  const minPct = Math.min(...list.map((item) => Number(item.pct)), -1);

  const header = `
    <div class="theme-bar-row theme-bar-header">
      <span>题材</span>
      <i>跌幅</i>
    </div>
  `;

  const dataRows = Array.from({ length: limit }, (_, idx) => {
    const item = list[idx];
    if (!item) {
      return `
        <div class="theme-bar-row theme-bar-placeholder">
          <span>—</span>
          <i class="bar-track" style="--bar-width:0%"><b></b><u>—</u></i>
        </div>
      `;
    }
    const pct = Number(item.pct ?? 0);
    const width = clamp(Math.round((Math.abs(pct) / Math.abs(minPct)) * 100), 14, 100);
    return `
      <div class="theme-bar-row theme-bar bearish" data-fit>
        <span>${escapeHtml(item.name)}</span>
        <i class="bar-track" style="--bar-width:${width}%"><b></b><u>${pct.toFixed(1)}%</u></i>
      </div>
    `;
  }).join('');

  if (!list.length) {
    return `
      <div class="theme-bars losers">
        ${header}
        <div class="theme-empty">当日无明显领跌题材</div>
      </div>
    `;
  }

  return `
    <div class="theme-bars losers">
      ${header}
      ${dataRows}
    </div>
  `;
}

function themeBars(items, options = {}) {
  const readValue = Object.prototype.hasOwnProperty.call(options, 'valueOf')
    ? options.valueOf
    : (item) => item.up ?? Math.abs(Number(item.pct ?? 0));
  const readText = Object.prototype.hasOwnProperty.call(options, 'textOf')
    ? options.textOf
    : (item) => item.up !== undefined ? `${item.up}只` : `${item.pct ?? '--'}%`;
  const readClass = Object.prototype.hasOwnProperty.call(options, 'classOf')
    ? options.classOf
    : (item) => item.pct !== undefined ? marketClass(item.pct) : 'bullish';
  const values = (items ?? []).map((item) => Math.abs(Number(readValue(item) ?? 0))).filter(Number.isFinite);
  const max = Math.max(...values, 1);
  return `
    <div class="theme-bars">
      ${(items ?? []).slice(0, options.limit ?? 6).map((item) => {
        const raw = Number(readValue(item) ?? 0);
        const width = clamp(Math.round((Math.abs(raw) / max) * 100), 8, 100);
        const cls = readClass(item);
        return `
          <div class="theme-bar ${cls}" data-fit>
            <span>${escapeHtml(item.name)}</span>
            <i><b style="width:${width}%"></b></i>
            <em>${escapeHtml(readText(item))}</em>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function sealRateClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'neutral';
  if (n >= 70) return 'bullish';
  if (n >= 50) return 'warning';
  return 'bearish';
}

function consecutiveBoardTotal(ladder) {
  return (ladder?.boards ?? [])
    .filter((row) => Number(row.board) > 1)
    .reduce((sum, row) => sum + (row.stocks?.length ?? 0), 0);
}

function deltaClass(delta, favorableIncrease = true) {
  const n = Number(delta);
  if (!Number.isFinite(n) || n === 0) return 'warning';
  const favorable = favorableIncrease ? n > 0 : n < 0;
  return favorable ? 'bullish' : 'bearish';
}

function deltaText(delta, unit) {
  const n = Number(delta);
  if (!Number.isFinite(n)) return `--${unit}`;
  return `${n > 0 ? '+' : ''}${n}${unit}`;
}

function metricCompare(current, previous, unit = '', options = {}) {
  const now = Number(current);
  const prior = Number(previous);
  if (!Number.isFinite(now) || !Number.isFinite(prior)) return '';
  const delta = now - prior;
  const previousUnit = options.previousUnit ?? unit;
  const deltaUnit = options.deltaUnit ?? unit;
  const favorableIncrease = options.favorableIncrease ?? true;
  return `<div class="metric-compare ${deltaClass(delta, favorableIncrease)}" data-fit><span class="metric-compare-prev">昨日 ${escapeHtml(prior)}${escapeHtml(previousUnit)}</span><span class="metric-compare-delta">较昨 ${escapeHtml(deltaText(delta, deltaUnit))}</span></div>`;
}

function ladderStrip(ladder, limit = 4) {
  return `
    <section class="ladder-strip">
      ${(ladder?.boards ?? []).slice(0, limit).map((row) => `
        <div class="ladder-level" data-fit>
          <strong>${escapeHtml(row.board)}板</strong>
          <span>${(row.stocks ?? []).slice(0, 5).map((stock) => `${escapeHtml(stock.name)}<em>${escapeHtml(stock.theme ?? stock.role ?? '')}</em>`).join(' / ')}</span>
        </div>
      `).join('')}
    </section>
  `;
}

function list(items, getText = (item) => item, limit = 5) {
  return (items ?? []).slice(0, limit).map((item) => `<li data-fit>${escapeHtml(getText(item))}</li>`).join('');
}

function themeDeepDiveSignal(label, text, tone) {
  return `
    <div class="deep-dive-signal ${tone}" data-fit>
      <b>${escapeHtml(label)}</b>
      <span>${escapeHtml(text)}</span>
    </div>
  `;
}

function buildIntegratedAnalysis(item) {
  // 整合 core_judgment + narrative 为一段文字
  const core = String(item?.core_judgment ?? '').trim();
  const narrative = String(item?.narrative ?? '').trim();
  if (core && narrative) {
    return core.endsWith('。') || core.endsWith('；') || core.endsWith('，') ? `${core}${narrative}` : `${core}。${narrative}`;
  }
  return core || narrative || '';
}

function themeDeepDiveItem(item, tone, compact = false) {
  const title = item?.name ?? item?.stage ?? '题材状态';
  const analysis = buildIntegratedAnalysis(item);
  if (compact) {
    return `
      <article class="deep-dive-item compact ${tone}">
        <div class="deep-dive-title">
          <h3 data-fit>${escapeHtml(title)}</h3>
          <span class="deep-dive-stage" data-fit>${escapeHtml(item?.stage ?? '--')}</span>
        </div>
        <p class="deep-dive-analysis" data-fit>${escapeHtml(analysis)}</p>
        <div class="deep-dive-compact-signals" data-fit>
          <span><b>确认</b>${escapeHtml(item?.confirm_signal)}</span>
          <span><b>证伪</b>${escapeHtml(item?.invalidate_signal)}</span>
        </div>
      </article>
    `;
  }
  return `
    <article class="deep-dive-item ${tone}">
      <div class="deep-dive-title">
        <h3 data-fit>${escapeHtml(title)}</h3>
        <span class="deep-dive-stage" data-fit>${escapeHtml(item?.stage ?? '--')}</span>
      </div>
      <p class="deep-dive-analysis" data-fit>${escapeHtml(analysis)}</p>
      <div class="deep-dive-signals">
        ${themeDeepDiveSignal('确认', item?.confirm_signal, 'bullish')}
        ${themeDeepDiveSignal('证伪', item?.invalidate_signal, 'bearish')}
      </div>
    </article>
  `;
}

function themeDeepDiveSections(themeInterpretation) {
  const source = themeInterpretation ?? {};
  if (source.status === 'no_clear_mainline') {
    return [{
      title: '无明确主线状态',
      tone: 'neutral',
      items: source.no_clear_mainline ? [source.no_clear_mainline] : []
    }];
  }
  const sections = [];
  const topUpside = (source.upside ?? [])[0];
  if (topUpside) {
    sections.push({ title: '涨停集中题材逻辑', tone: 'bullish', items: [topUpside] });
  }
  const topDownside = (source.downside ?? [])[0];
  if (topDownside) {
    sections.push({ title: '兑现杀跌题材逻辑', tone: 'bearish', items: [topDownside] });
  }
  if (!sections.length && source.no_clear_mainline) {
    sections.push({ title: '无明确主线状态', tone: 'neutral', items: [source.no_clear_mainline] });
  }
  return sections;
}

function renderThemeDeepDiveMarkup(sections) {
  const safeSections = sections.length ? sections : [{
    title: '题材状态',
    tone: 'neutral',
    items: []
  }];
  return `
    <div class="theme-deep-dive ${safeSections.length > 1 ? 'dual' : 'single'}">
      <div class="deep-dive-grid">
        ${safeSections.map((section) => `
          <div class="deep-dive-card ${section.tone}">
            <h2 data-fit>${escapeHtml(section.title)}</h2>
            <div class="deep-dive-items">
              ${section.items.map((item, index) => themeDeepDiveItem(item, section.tone, index > 0)).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function themeDeepDive(themeInterpretation) {
  const sections = themeDeepDiveSections(themeInterpretation);
  return `<section class="theme-deep-dive ${sections.length > 1 ? 'dual' : 'single'}">${renderThemeDeepDiveMarkup(sections)}</section>`;
}

function formatClose(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '--';
}

function indexDeltaText(item) {
  return item.delta_text ?? item.change_text ?? '';
}

function highestLadderNumber(data) {
  const board = Number(data.ladder?.highest_non_st_board);
  return Number.isInteger(board) && board >= 0 ? board : null;
}

function highestLadderText(data) {
  return highestLadderNumber(data) ?? '--';
}

function highestLadderStockText(data, limit = 2) {
  const list = (data.ladder?.boards ?? []).find((row) => Number(row.board) === highestLadderNumber(data))?.stocks ?? [];
  const names = list.map((stock) => stock?.name).filter(Boolean);
  if (names.length === 0) return data.ladder?.highest_stock ?? '--';
  return names.slice(0, limit).join('/');
}

function ladderBoardsSorted(data) {
  return (data.ladder?.boards ?? []).slice().sort((left, right) => Number(right.board) - Number(left.board));
}

function consecutiveBoardCount(data) {
  return (data.ladder?.boards ?? [])
    .filter((row) => Number(row.board) > 1)
    .reduce((sum, row) => sum + (row.stocks?.length ?? 0), 0);
}

function roleItemsForRole(roles, role, limit = 3) {
  return (roles?.[role] ?? []).slice(0, limit);
}

function isBoardBiggerThanOne(board) {
  return Number.isFinite(Number(board)) && Number(board) > 1;
}

function limitUpCmpClass(current, previous, type) {
  const now = Number(current);
  const prior = Number(previous);
  if (!Number.isFinite(now) || !Number.isFinite(prior)) return 'warning';
  const delta = now - prior;
  if (delta === 0) return 'warning';
  if (type === 'favorable-increase') return delta > 0 ? 'bullish' : 'bearish';
  return delta < 0 ? 'bullish' : 'bearish';
}

function dialColorClass(score) {
  if (!Number.isFinite(Number(score))) return 'neutral';
  if (Number(score) >= 70) return 'bullish';
  if (Number(score) >= 55) return 'bullish-soft';
  if (Number(score) >= 40) return 'warning';
  if (Number(score) >= 25) return 'warning-soft';
  return 'bearish';
}

function dialArc(score) {
  const safe = Math.min(100, Math.max(0, Number(score) || 0));
  const dash = Math.round((safe / 100) * 339.292);
  return dash;
}

function dialBandNameByScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return '--';
  if (n >= 85) return '高潮';
  if (n >= 70) return '扩散';
  if (n >= 55) return '修复';
  if (n >= 40) return '分歧';
  if (n >= 25) return '弱修复';
  return '冰点';
}

function sentimentDial(score, state) {
  const dash = dialArc(score);
  const cls = dialColorClass(score);
  return `
    <div class="sentiment-dial">
      <div class="dial-ring ${cls}" style="--dial-dash:${dash}px">
        <span class="dial-value" data-fit>${escapeHtml(String(score))}</span>
        <span class="dial-state" data-fit>${escapeHtml(state ?? '')}</span>
        <span class="dial-foot" data-fit>/100</span>
      </div>
      <div class="dial-bands">
        <span class="band b1">85+ 高潮</span>
        <span class="band b2">70-84 扩散</span>
        <span class="band b3">55-69 修复</span>
        <span class="band b4">40-54 分歧</span>
        <span class="band b5">25-39 弱修复</span>
        <span class="band b6">0-24 冰点</span>
      </div>
    </div>
  `;
}

function dialRing(score, state) {
  const dash = dialArc(score);
  const cls = dialColorClass(score);
  const band = dialBandNameByScore(score);
  return `
    <div class="dial-ring-wrap">
      <div class="dial-ring ${cls}" style="--dial-dash:${dash}px">
        <span class="dial-value" data-fit>${escapeHtml(String(score))}</span>
        <span class="dial-state" data-fit>${escapeHtml(state ?? '')}</span>
        <span class="dial-foot" data-fit>/100</span>
      </div>
      <div class="dial-band-tag" data-fit>${escapeHtml(band)}</div>
    </div>
  `;
}

const DIAL_BAND_DESCRIPTIONS = [
  { range: '85+',   name: '高潮',   desc: '情绪极致 · 追高风险大' },
  { range: '70-84', name: '扩散',   desc: '主线明确 · 赚钱效应扩散' },
  { range: '55-69', name: '修复',   desc: '亏钱效应缓解 · 结构修复' },
  { range: '40-54', name: '分歧',   desc: '多空拉锯 · 热点快速轮动' },
  { range: '25-39', name: '弱修复', desc: '修复力度不足 · 观望为主' },
  { range: '0-24',  name: '冰点',   desc: '情绪极度低迷 · 孕育反弹' },
];

function dialBandsWithDesc() {
  return `
    <div class="de-dial-bands">
      ${DIAL_BAND_DESCRIPTIONS.map((b) => `
        <div class="band">
          <b>${b.range}</b>
          <i>${b.name}</i>
          <p>${b.desc}</p>
        </div>
      `).join('')}
    </div>
  `;
}

// 2-class signal rendering: 多头 = 确认信号, 空头 = 风险信号
// (弱化信号是中间态，吸收到空头中以避免与多头并列时引起歧义)
function bullishSignals(data) {
  const list = data.next_session_signals?.['确认信号'] ?? data.next_session_signals?.['多头信号'] ?? [];
  return list.slice(0, 3);
}

function bearishSignals(data) {
  const list = data.next_session_signals?.['风险信号'] ?? data.next_session_signals?.['空头信号'] ?? [];
  return list.slice(0, 3);
}

function lightSpark(seed, pct) {
  return `<canvas class="li-spark" width="190" height="48" data-seed="${escapeHtml(seed)}" data-pct="${escapeHtml(String(pct ?? 0))}" data-bearish="${Number(pct) < 0 ? '1' : '0'}"></canvas>`;
}

function darkEditorialSpark(seed, pct) {
  return `<canvas class="de-spark" width="210" height="58" data-seed="${escapeHtml(seed)}" data-pct="${escapeHtml(String(pct ?? 0))}" data-bearish="${Number(pct) < 0 ? '1' : '0'}"></canvas>`;
}
function darkTerminalSpark(seed, pct) {
  return `<canvas class="dt-spark" width="172" height="40" data-seed="${escapeHtml(seed)}" data-pct="${escapeHtml(String(pct ?? 0))}" data-bearish="${Number(pct) < 0 ? '1' : '0'}"></canvas>`;
}

function broadSparklineScript(className) {
  return `
    <script>
      (function () {
        const seedProfiles = {
          upA: [.70,.61,.67,.59,.73,.55,.62,.50,.68,.72,.63,.48,.42,.55,.60,.46,.65,.71,.58,.74,.62,.69,.56,.66,.72,.61,.49,.38,.45,.33,.42,.30,.37,.25,.35,.22,.29,.18,.25,.14,.19],
          upB: [.64,.55,.61,.47,.42,.57,.63,.46,.36,.44,.54,.60,.45,.32,.38,.50,.40,.27,.34,.46,.36,.25,.18,.31,.23,.15,.26,.12,.22,.10,.18,.08,.16,.06,.14,.08,.12,.05,.10,.07,.09],
          downA: [.34,.25,.36,.29,.45,.37,.53,.43,.57,.48,.52,.40,.49,.44,.56,.47,.60,.69,.55,.64,.75,.67,.80,.71,.84,.76,.88,.79,.86,.82,.90,.81,.87,.78,.91,.83,.93,.84,.90,.82,.92],
          downB: [.45,.34,.42,.30,.50,.39,.58,.46,.62,.51,.68,.54,.61,.49,.57,.66,.59,.73,.64,.78,.69,.82,.72,.86,.77,.91,.80,.88,.74,.93,.82,.90,.78,.94,.84,.92,.80,.95,.86,.91,.83]
        };
        for (const canvas of document.querySelectorAll('.${className}')) {
          const ctx = canvas.getContext('2d');
          const seed = String(canvas.dataset.seed || '${className}');
          const bearish = canvas.dataset.bearish === '1';
          const pct = Number(canvas.dataset.pct || 0);
          const rect = canvas.getBoundingClientRect();
          const dpr = Math.max(1, window.devicePixelRatio || 1);
          const width = Math.max(120, rect.width || 190);
          const height = Math.max(40, rect.height || 48);
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, width, height);
          let hash = 2166136261;
          for (let i = 0; i < seed.length; i += 1) {
            hash ^= seed.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
          }
          const rand = () => {
            hash ^= hash << 13;
            hash ^= hash >>> 17;
            hash ^= hash << 5;
            return ((hash >>> 0) % 10000) / 10000;
          };
          const match = seed.match(/^${className}-?(\\d+)/);
          const index = match ? Number(match[1]) : 0;
          const strongMove = Math.abs(pct) >= 1 || index % 2 === 1;
          const profile = seedProfiles[bearish ? (strongMove ? 'downB' : 'downA') : (strongMove ? 'upB' : 'upA')];
          const step = width / (profile.length - 1);
          const pts = profile.map((value, i) => {
            const impulse = i % 5 === 0 ? (rand() - 0.5) * height * 0.14 : 0;
            const micro = (rand() - 0.5) * height * 0.085;
            const baseY = height * (0.08 + value * 0.68);
            const yVal = Math.max(height * 0.06, Math.min(height * 0.84, baseY + impulse + micro));
            return [i * step, Math.round(yVal * 10) / 10];
          });
          const grad = ctx.createLinearGradient(0, 0, 0, height);
          grad.addColorStop(0, bearish ? 'rgba(10,140,104,.20)' : 'rgba(216,33,29,.22)');
          grad.addColorStop(.58, bearish ? 'rgba(10,140,104,.09)' : 'rgba(216,33,29,.10)');
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.lineTo(pts[pts.length - 1][0], height + 2);
          ctx.lineTo(pts[0][0], height + 2);
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.strokeStyle = bearish ? '#0a8c68' : '#d8211d';
          ctx.lineWidth = 1.7;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.shadowColor = bearish ? 'rgba(10,140,104,.30)' : 'rgba(216,33,29,.32)';
          ctx.shadowBlur = 1.8;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      })();
    </script>
  `;
}

// =====================================================================
// 1. 暗金杂志封面风格 - 4 pages
// =====================================================================

function darkEditorialIcon(name) {
  const cls = 'de-svg-icon';
  if (name === 'flame') return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><path d="M27.7 4.8c1.3 8.2 8.3 10.8 8.3 22.1 0 9.2-6.4 16.3-15.8 16.3-8.3 0-14-5.7-14-13.7 0-6.2 3.1-10.4 7.1-14.7-.2 4.6 1.4 7.3 4.5 8.1 1.8-7.9 5-13.4 9.9-18.1Z" fill="currentColor" opacity=".96"/><path d="M22.9 40.2c-4.9 0-8-3.1-8-7.5 0-3.5 2.2-5.9 4.8-8.5.2 3.2 1.5 5.1 3.8 5.9 1.2-3.9 3.2-7.1 6.1-9.8.8 5.3 4.4 7.7 4.4 13.1 0 4-3.3 6.8-11.1 6.8Z" fill="#ffe0a0"/></svg>`;
  if (name === 'trophy') return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><path d="M15 9h18v5h6v5.2c0 6.3-4.2 10.4-10.2 11.2-.9 2.6-2.3 4.5-4.8 5.2v3.7h8.2v4H15.8v-4H24v-3.7c-2.5-.7-3.9-2.6-4.8-5.2C13.2 29.6 9 25.5 9 19.2V14h6V9Zm18 8v8.8c2.5-.8 3.9-3.1 3.9-6.6V17H33Zm-21 0v2.2c0 3.5 1.4 5.8 3.9 6.6V17H12Z" fill="currentColor"/></svg>`;
  if (name === 'spark') return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5.5 29.3 19 42.5 24 29.3 29 24 42.5 18.7 29 5.5 24 18.7 19 24 5.5Z" fill="currentColor"/><path d="M24 16.2 27 22l5.8 2-5.8 2-3 5.8-3-5.8-5.8-2 5.8-2 3-5.8Z" fill="#111711" opacity=".72"/></svg>`;
  if (name === 'eye') return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><path d="M4.8 24c5.1-8.2 11.5-12.3 19.2-12.3S38.1 15.8 43.2 24C38.1 32.2 31.7 36.3 24 36.3S9.9 32.2 4.8 24Z" fill="none" stroke="currentColor" stroke-width="4.2" stroke-linejoin="round"/><circle cx="24" cy="24" r="6.2" fill="currentColor"/></svg>`;
  if (name === 'chart') return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><path d="M9 38h30" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".8"/><path d="M13 32V22m9 10V14m9 18V19" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M12 16 22 10l8 5 8-9" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M38 6v8h-8" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (name === 'coins') return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><ellipse cx="24" cy="13" rx="14" ry="6" fill="currentColor"/><path d="M10 13v18c0 3.3 6.3 6 14 6s14-2.7 14-6V13" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M10 22c0 3.3 6.3 6 14 6s14-2.7 14-6M10 31c0 3.3 6.3 6 14 6s14-2.7 14-6" fill="none" stroke="#ffe1a2" stroke-width="2.4" stroke-linecap="round" opacity=".85"/></svg>`;
  if (name === 'yen') return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><path d="M11 7h7.6L24 18l5.4-11H37L28 23h7v5h-8v4h8v5h-8v6h-6v-6h-8v-5h8v-4h-8v-5h7L11 7Z" fill="currentColor"/></svg>`;
  if (name === 'medal') return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true"><path d="M21 38 15 58l10-6 7 9 7-9 10 6-6-20" fill="#7c2c24" opacity=".9"/><circle cx="32" cy="28" r="22" fill="#4f3517" stroke="#f2bd65" stroke-width="3"/><circle cx="32" cy="28" r="15" fill="#8b5f22" stroke="#ffe0a0" stroke-width="2" opacity=".96"/><path d="m32 16 3.4 7 7.7 1.1-5.6 5.4 1.3 7.6-6.8-3.6-6.8 3.6 1.3-7.6-5.6-5.4 7.7-1.1L32 16Z" fill="none" stroke="#ffe0a0" stroke-width="2.8" stroke-linejoin="round"/></svg>`;
  if (name === 'pulse') return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><path d="M6 24h12l4-12 6 26 4-14h10" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (name === 'warning') return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6 45 42H3L24 6Z" fill="currentColor"/><path d="M24 18v12M24 36h.1" fill="none" stroke="#0d0a08" stroke-width="4" stroke-linecap="round"/></svg>`;
  if (name === 'check') return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><path d="M10 25 21 36 40 14" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return '';
}

// 主题化次日梯队信号图标（金色杂志风：圆形外框 + 几何图形）
function darkEditorialSignalIcon(kind) {
  const cfg = kind === 'bullish'
    ? { stroke: '#ff8275', bg: 'rgba(255,80,68,.18)', arrow: 'M14 7 L21 15 L17.5 15 L17.5 21 L10.5 21 L10.5 15 L7 15 Z' }
    : kind === 'warning'
    ? { stroke: '#f4c15d', bg: 'rgba(244,193,93,.18)', arrow: 'M8 13 L20 13 M8 17 L20 17' }
    : { stroke: '#5cd38b', bg: 'rgba(26,180,123,.18)', arrow: 'M14 21 L21 13 L17.5 13 L17.5 7 L10.5 7 L10.5 13 L7 13 Z' };
  return `<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12.5" fill="${cfg.bg}" stroke="${cfg.stroke}" stroke-width="1"/><path d="${cfg.arrow}" fill="${cfg.stroke}"/></svg>`;
}

// 机构午报风次日梯队信号图标（方形 + 简洁笔画）
function lightSignalIcon(kind) {
  const cfg = kind === 'bullish'
    ? { stroke: '#d8211d', bg: 'rgba(216,33,29,.10)', arrow: 'M14 7 L20.5 14 L17 14 L17 21 L11 21 L11 14 L7.5 14 Z' }
    : kind === 'warning'
    ? { stroke: '#8a5d22', bg: 'rgba(176,116,42,.10)', arrow: 'M7 13 L21 13 M7 16.5 L21 16.5' }
    : { stroke: '#0a6e54', bg: 'rgba(10,140,104,.10)', arrow: 'M14 21 L20.5 14 L17 14 L17 7 L11 7 L11 14 L7.5 14 Z' };
  return `<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><rect x="1.5" y="1.5" width="25" height="25" rx="3" fill="${cfg.bg}" stroke="${cfg.stroke}" stroke-width="1"/><path d="${cfg.arrow}" fill="${cfg.stroke}"/></svg>`;
}

// 终端科技风次日梯队信号图标（八边形 + 角标）
function darkTerminalSignalIcon(kind) {
  const cfg = kind === 'confirm'
    ? { color: '#5cd38b', bg: 'rgba(92,211,139,.10)', arrow: 'M14 7 L21 15 L17.5 15 L17.5 21 L10.5 21 L10.5 15 L7 15 Z' }
    : kind === 'weaken'
    ? { color: '#ffb742', bg: 'rgba(255,183,66,.10)', arrow: 'M7 14 L21 14' }
    : { color: '#ff5b4e', bg: 'rgba(255,91,78,.10)', arrow: 'M14 21 L21 13 L17.5 13 L17.5 7 L10.5 7 L10.5 13 L7 13 Z' };
  return `<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><path d="M14 2 L24 7.5 L24 20.5 L14 26 L4 20.5 L4 7.5 Z" fill="${cfg.bg}" stroke="${cfg.color}" stroke-width="1.2"/><path d="${cfg.arrow}" fill="${cfg.color}"/></svg>`;
}

function darkEditorialIndexCard(item, index) {
  return `
    <div class="de-index-card">
      <span>${escapeHtml(item.name)}</span>
      <strong class="${marketClass(item.pct)}">${escapeHtml(formatClose(item.close))}</strong>
      <em class="${marketClass(item.pct)}">${escapeHtml(pctText(item.pct))}</em>
      ${darkEditorialSpark(`de-${index}:${item.pct}`, item.pct)}
    </div>
  `;
}

function darkEditorialHeader(weekday, suffix) {
  return `<header class="de-title-block">
    <h1><span>A股市场</span><i>· 情绪日报</i></h1>
    <div class="de-date">◎ ${escapeHtml(darkChineseDate(arguments[0]))}　${escapeHtml(arguments[1])}　｜　${escapeHtml(suffix)}</div>
  </header>`;
}

function darkEditorialFooter() {
  return `<footer class="de-footer footer">数据来源：公开市场数据 ｜ 仅供复盘，不构成投资建议</footer>`;
}

function darkEditorialPage1(data) {
  const indices = data.indices ?? [];
  const up = Number(data.breadth?.up ?? 0);
  const down = Number(data.breadth?.down ?? 0);
  const total = Math.max(up + down, 1);
  const upPct = clamp(Math.round((up / total) * 1000) / 10, 0, 100);
  const downPct = Math.round((100 - upPct) * 10) / 10;
  const features = (data.market_summary?.headline ?? '').split(/[·]/).map((s) => s.trim()).filter(Boolean);
  const thesis = data.market_summary?.action ?? '';
  const headline = data.market_summary?.headline ?? '';
  const styleShift = data.market_summary?.style_shift ?? '';
  const northbound = data.capital_flow?.inflow_sectors?.[0]?.amount_text ?? '--';
  const changeText = data.turnover?.change_text ?? '';
  const changeClass = volumeChangeClass(data.turnover ?? {});
  return `
    <section class="poster de-poster de-page1" data-page="1" data-title="市场全景与资金流">
      <div class="de-frame">
        <header class="de-title-block de-title-page1">
          <h1><span>A股市场</span><i>· 情绪日报</i></h1>
          <div class="de-date">◎ ${escapeHtml(darkChineseDate(data.report_date))}　${escapeHtml(data.weekday)}　｜　收盘复盘</div>
        </header>

        <section class="de-judgement de-panel">
          <div class="de-badge">市场判断</div>
          <strong class="de-headline">${features.slice(0, 3).map((f) => `<span class="de-headline-chip">${escapeHtml(f)}</span>`).join('<i class="de-headline-sep">·</i>')}</strong>
          <p>${escapeHtml(styleShift || thesis)}</p>
        </section>

        <section class="de-panel de-index-panel">
          <h2>主要指数</h2>
          <div class="de-index-grid">
            ${indices.slice(0, 4).map((item, index) => darkEditorialIndexCard(item, index)).join('')}
          </div>
        </section>

        <section class="de-panel de-breadth">
          <h2>市场宽度</h2>
          <div class="de-breadth-main">
            <div class="de-breadth-side"><span>上涨</span><div><strong class="bullish">${escapeHtml(up)}</strong><em>家</em></div></div>
            <div class="de-breadth-bar"><i class="bullish-bg" style="width:${upPct}%"><b>${upPct}%</b></i><i class="bearish-bg" style="width:${downPct}%"><b>${downPct}%</b></i></div>
            <div class="de-breadth-side"><span>下跌</span><div><strong class="bearish">${escapeHtml(down)}</strong><em>家</em></div></div>
          </div>
          <p>涨跌比 ${escapeHtml((() => {
            const ratioText = data.breadth?.ratio_text?.replace(/^涨跌比\s*/, '') ?? '';
            if (ratioText) return ratioText;
            const u = Number(data.breadth?.up ?? 0);
            const d = Number(data.breadth?.down ?? 0);
            if (!u && !d) return '--';
            if (!u || !d) return `${u} : ${d}`;
            const r = u / d;
            return `${r.toFixed(2)} : 1`;
          })())} ｜ ${escapeHtml(data.breadth?.notable ?? '')}</p>
        </section>

        <section class="de-panel de-money">
          <h2>资金与成交</h2>
          <div class="de-money-grid">
            <div class="de-icon-bubble red">${darkEditorialIcon('yen')}</div>
            <div><span>两市成交</span><strong>${escapeHtml(data.turnover?.amount_text ?? '--')}</strong></div>
            <div class="de-divider"></div>
            <div class="de-icon-bubble gold">${darkEditorialIcon('coins')}</div>
            <div><span>主力资金</span><strong class="${marketClass(data.capital_flow?.net_yuan)}">${escapeHtml(data.capital_flow?.net_text ?? '--')}</strong></div>
          </div>
        </section>

        <section class="de-panel de-core">
          <h2>核心要点</h2>
          <div class="de-core-grid">
            ${features.slice(0, 3).map((feature, index) => `
              <div>
                <div class="de-round-icon">${darkEditorialIcon(['chart', 'flame', 'coins'][index] ?? 'chart')}</div>
                <h3>${escapeHtml(['指数与权重', '题材与情绪', '量能与博弈'][index] ?? '要点')}</h3>
                <p class="de-core-desc" data-fit>${escapeHtml(feature + '；' + thesis)}</p>
              </div>
            `).join('')}
          </div>
          <div class="de-core-foot">综合观点：${escapeHtml(styleShift || thesis)}</div>
        </section>

        ${darkEditorialFooter()}
      </div>
    </section>
  `;
}

function darkEditorialPage2(data) {
  const emotion = data.emotion_model_v1 ?? {};
  const factors = emotion.factors ?? [];
  const factorTop = factors.slice(0, 5);
  const factorBottom = factors.slice(5);
  return `
    <section class="poster de-poster de-page2" data-page="2" data-title="短线情绪周期">
      <div class="de-frame">
        <header class="de-title-block de-title-page2">
          <h1><span>短线情绪</span><i>· 周期诊断</i></h1>
          <div class="de-date">◎ ${escapeHtml(darkChineseDate(data.report_date))}　${escapeHtml(data.weekday)}　｜　复盘模型 v1</div>
        </header>

        <section class="de-panel de-dial-panel">
          <h2>情绪分 / 状态</h2>
          <div class="de-dial-wrap">
            <div class="sentiment-dial">${dialRing(emotion.score ?? 0, emotion.state ?? '--')}</div>
            ${dialBandsWithDesc()}
          </div>
        </section>

        <section class="de-panel de-factor-panel">
          <h2>10 项情绪因子</h2>
          <div class="de-factor-grid">
            ${factorItems(factors, 10)}
          </div>
        </section>

        <section class="de-panel de-signal-panel">
          <h2><span class="de-title-icon">${darkEditorialIcon('eye')}</span> 次日观察信号</h2>
          <div class="de-signal-grid">
            <div class="de-signal-card bullish">
              <span class="de-title-icon">${darkEditorialIcon('check')}</span>
              <b>多头信号</b>
              <ul>${bullishSignals(data).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
            </div>
            <div class="de-signal-card bearish">
              <span class="de-title-icon">${darkEditorialIcon('warning')}</span>
              <b>空头信号</b>
              <ul>${bearishSignals(data).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
            </div>
          </div>
        </section>

        ${darkEditorialFooter()}
      </div>
    </section>
  `;
}

function darkEditorialPage3(data) {
  const conceptCounts = (data.themes?.concept_counts ?? []).slice(0, 12);
  const interpretation = data.theme_interpretation ?? {};
  return `
    <section class="poster de-poster de-page3" data-page="3" data-title="涨停与主线复盘">
      <div class="de-frame">
        <header class="de-title-block de-title-page2">
          <h1><span>涨停复盘</span><i>· 主线结构</i></h1>
          <div class="de-date">◎ ${escapeHtml(darkChineseDate(data.report_date))}　${escapeHtml(data.weekday)}　｜　全口径 / 非ST短线</div>
        </header>

        <section class="de-panel de-limit-panel">
          <h2>涨跌停与封板结构</h2>
          <div class="de-limit-metrics">
            <div class="de-limit-card red">
              <span>涨停</span>
              <strong>${escapeHtml(data.limit_up?.limit_up ?? '--')}<em>只</em></strong>
              ${metricCompare(data.limit_up?.limit_up, data.limit_up?.previous_day?.limit_up, '只', { favorableIncrease: true })}
            </div>
            <div class="de-limit-card green">
              <span>跌停</span>
              <strong>${escapeHtml(data.limit_up?.limit_down ?? '--')}<em>只</em></strong>
              ${metricCompare(data.limit_up?.limit_down, data.limit_up?.previous_day?.limit_down, '只', { favorableIncrease: false })}
            </div>
            <div class="de-limit-card green">
              <span>炸板</span>
              <strong>${escapeHtml(data.limit_up?.broken_board ?? '--')}<em>只</em></strong>
              ${metricCompare(data.limit_up?.broken_board, data.limit_up?.previous_day?.broken_board, '只', { favorableIncrease: false })}
            </div>
            <div class="de-limit-card red">
              <span>封板率</span>
              <strong>${escapeHtml(String(data.limit_up?.seal_rate_pct ?? '--'))}<em>%</em></strong>
              ${metricCompare(data.limit_up?.seal_rate_pct, data.limit_up?.previous_day?.seal_rate_pct, '%', { deltaUnit: 'pct', previousUnit: '%', favorableIncrease: true })}
            </div>
          </div>
          <div class="de-limit-foot">
            <span>展示口径　${escapeHtml(data.limit_up?.display口径 ?? '非ST短线口径')}</span>
            <span>${escapeHtml(data.limit_up?.full_market?.['口径'] ?? '全口径')}: 涨停 ${escapeHtml(data.limit_up?.full_market?.limit_up ?? '--')} / 跌停 ${escapeHtml(data.limit_up?.full_market?.limit_down ?? '--')}</span>
          </div>
        </section>

        <section class="de-panel de-theme-panel">
          <div class="de-theme-grid">
            <div class="de-theme-col de-theme-col-gainers">
              <h3>领涨TOP <em>涨幅口径</em></h3>
              ${topGainersThemeBars(conceptCounts, 5)}
            </div>
            <div class="de-theme-col de-theme-col-losers">
              <h3>领跌TOP <em>跌幅口径</em></h3>
              ${topLosersThemeBars(conceptCounts, 5)}
            </div>
          </div>
        </section>

        <section class="de-panel de-deep-panel">
          ${renderThemeDeepDiveMarkup(themeDeepDiveSections(interpretation))}
        </section>

        ${darkEditorialFooter()}
      </div>
    </section>
  `;
}

function darkEditorialPage4(data) {
  const boards = ladderBoardsSorted(data);
  const topBoards = boards.slice(0, 4);
  const roles = data.leader_roles ?? {};
  const roleKeys = ['空间龙', '板块龙头', '容量中军', '核心助攻', '中位接力', '补涨前排', '首板前排', '风险负反馈'];
  return `
    <section class="poster de-poster de-page4" data-page="4" data-title="强势板块龙头梯队">
      <div class="de-frame">
        <header class="de-title-block de-title-page2">
          <h1><span>龙头梯队</span><i>· 强势板块</i></h1>
          <div class="de-date">◎ ${escapeHtml(darkChineseDate(data.report_date))}　${escapeHtml(data.weekday)}　｜　连板梯队 / 角色映射</div>
        </header>

        <section class="de-panel de-ladder-head">
          <h2>梯队关键指标</h2>
          <div class="de-ladder-metrics">
            <div class="de-ladder-card">
              <span>非ST空间高度</span>
              <strong>${escapeHtml(highestLadderText(data))}<em>板</em></strong>
              ${metricCompare(highestLadderNumber(data), data.ladder?.previous_day?.highest_non_st_board, '板', { favorableIncrease: true })}
            </div>
            <div class="de-ladder-card">
              <span>连板总数</span>
              <strong>${escapeHtml(consecutiveBoardCount(data))}<em>只</em></strong>
              ${metricCompare(consecutiveBoardCount(data), data.ladder?.previous_day?.consecutive_board_total, '只', { favorableIncrease: true })}
            </div>
            <div class="de-ladder-card de-ladder-card-featured">
              <span>高度核心</span>
              <strong>${escapeHtml(highestLadderStockText(data, 1))}</strong>
              <em>${escapeHtml(highestLadderText(data))}连板</em>
            </div>
          </div>
        </section>

        <section class="de-panel de-ladder-strip">
          <h2>连板梯队</h2>
          <div class="de-ladder-rows">
            ${topBoards.map((row) => `
              <div class="de-ladder-row">
                <b>${escapeHtml(row.board)}板</b>
                <span>${(row.stocks ?? []).slice(0, 4).map((s) => `${escapeHtml(s.name)}<em>${escapeHtml(s.theme ?? '')}</em>`).join(' / ')}</span>
              </div>
            `).join('')}
          </div>
        </section>

        <section class="de-panel de-roles-panel">
          <h2>角色映射</h2>
          <div class="de-roles-grid">
            ${roleKeys.map((role) => rolePanel(role, roleItemsForRole(roles, role, 2), 2)).join('')}
          </div>
        </section>

        <section class="de-panel de-watch-panel">
          <h2><span class="de-title-icon">${darkEditorialIcon('eye')}</span> 次日梯队判断</h2>
          <div class="de-watch-grid">
            <div class="de-watch-card bullish">
              <b>${darkEditorialSignalIcon('bullish')}确认</b>
              <p>${escapeHtml((data.next_session_signals?.['确认信号'] ?? [])[0] ?? '')}</p>
            </div>
            <div class="de-watch-card warning">
              <b>${darkEditorialSignalIcon('warning')}弱化</b>
              <p>${escapeHtml((data.next_session_signals?.['弱化信号'] ?? [])[0] ?? '')}</p>
            </div>
            <div class="de-watch-card bearish">
              <b>${darkEditorialSignalIcon('bearish')}风险</b>
              <p>${escapeHtml((data.next_session_signals?.['风险信号'] ?? [])[0] ?? '')}</p>
            </div>
          </div>
        </section>

        ${darkEditorialFooter()}
      </div>
    </section>
  `;
}

function darkEditorialCss() {
  return `
    * { box-sizing: border-box; }
    body { margin: 0; background: #101010; font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; }
    #report-root { display: flex; align-items: flex-start; gap: 0; background: #101010; }
    .de-poster {
      width: 1080px;
      height: 1440px;
      flex: 0 0 1080px;
      position: relative;
      overflow: hidden;
      color: #eee6d7;
      background:
        radial-gradient(circle at 50% 7%, rgba(229,207,160,.14), transparent 25%),
        radial-gradient(circle at 80% 26%, rgba(134,67,50,.14), transparent 24%),
        linear-gradient(150deg, #101820 0%, #10120f 48%, #071018 100%);
    }
    .de-frame {
      position: absolute; inset: 18px 20px 20px;
      border: 1px solid rgba(218,180,98,.55);
      border-radius: 10px;
      background: linear-gradient(180deg, rgba(255,255,255,.05), transparent 16%), rgba(8,13,14,.62), radial-gradient(circle at 50% 0%, rgba(255,220,150,.04), transparent 30%);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.04), 0 18px 45px rgba(0,0,0,.42);
      overflow: hidden;
    }
    .de-panel {
      position: absolute;
      border: 1px solid rgba(214,168,82,.65);
      border-radius: 8px;
      background: radial-gradient(circle at 50% 0%, rgba(217,165,93,.10), transparent 35%), rgba(12,18,18,.82), inset 0 1px 0 rgba(255,255,255,.04);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.03), 0 10px 22px rgba(0,0,0,.25);
      overflow: hidden;
    }
    .de-svg-icon { display: block; width: 1em; height: 1em; color: currentColor; overflow: visible; }
    .de-title-icon { display: inline-grid; place-items: center; width: 1.08em; height: 1.08em; margin-right: 6px; color: currentColor; vertical-align: -0.16em; }
    .de-title-block { position: absolute; left: 38px; right: 38px; top: 42px; text-align: center; }
    .de-title-block h1 { margin: 0; font-family: SimSun, STSong, "Noto Serif CJK SC", serif; font-size: 86px; line-height: .98; font-weight: 900; text-shadow: 0 4px 12px rgba(0,0,0,.65); }
    .de-title-block h1 span { background: linear-gradient(180deg, #fff5cf 0%, #e7b96d 58%, #b47b39 100%); -webkit-background-clip: text; color: transparent; }
    .de-title-block h1 i { font-style: normal; margin-left: 18px; color: #f0eee8; }
    .de-date { margin-top: 18px; color: #8d9292; font-size: 21px; font-weight: 700; letter-spacing: 0; }
    .de-footer { position: absolute; left: 0; right: 0; bottom: 18px; text-align: center; color: #9aa0a0; font-size: 17px; font-weight: 700; }

    .de-page1 .de-judgement { left: 26px; right: 26px; top: 200px; height: 220px; text-align: center; padding: 50px 18px 14px; }
    .de-badge { position: absolute; top: -1px; left: 50%; transform: translateX(-50%); width: 196px; height: 52px; line-height: 48px; border-radius: 0 0 28px 28px; background: linear-gradient(180deg, #f8d991, #c78d42); color: #10100d; font-size: 26px; font-weight: 900; box-shadow: 0 8px 18px rgba(0,0,0,.28); }
    .de-judgement strong { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 10px 12px; margin-top: 16px; font-family: SimSun, STSong, serif; line-height: 1.1; color: #f5dba6; text-shadow: 0 3px 12px rgba(0,0,0,.6); }
    .de-headline-chip { display: inline-block; max-width: 100%; font-size: 42px; font-weight: 900; letter-spacing: 1px; }
    .de-headline-sep { color: #c78d42; font-size: 32px; font-style: normal; font-weight: 700; opacity: .9; }
    .de-judgement p { margin: 10px 0 0; color: #e8e2d7; font-size: 20px; line-height: 1.4; font-weight: 700; letter-spacing: 1px; }
    .de-index-panel { left: 26px; right: 26px; top: 436px; height: 304px; padding: 20px 20px; overflow: hidden; }
    .de-index-panel h2, .de-breadth h2, .de-money h2, .de-core h2, .de-dial-panel h2, .de-factor-panel h2, .de-signal-panel h2, .de-limit-panel h2, .de-theme-panel h2, .de-deep-panel h2, .de-ladder-head h2, .de-ladder-strip h2, .de-roles-panel h2, .de-watch-panel h2 { margin: 0 0 12px; color: #f5dba6; font-size: 29px; line-height: 1; font-weight: 900; }
    .de-index-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .de-index-card { height: 220px; padding: 20px 14px 10px; border: 1px solid rgba(222,169,92,.42); border-radius: 8px; background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.015)), inset 0 1px 0 rgba(255,255,255,.04); text-align: center; overflow: hidden; }
    .de-index-card span { display: block; color: #d8ddd8; font-size: 23px; font-weight: 800; }
    .de-index-card strong { display: block; margin-top: 12px; font-size: 38px; line-height: 1; font-weight: 900; }
    .de-index-card em { display: block; margin-top: 8px; font-size: 27px; line-height: 1; font-style: normal; font-weight: 900; }
    .de-spark { width: 220px; height: 60px; margin: 6px auto 0; display: block; }
    .de-breadth { left: 26px; right: 26px; top: 756px; height: 160px; padding: 16px 24px; }
    .de-breadth-main { display: grid; grid-template-columns: 132px 1fr 132px; gap: 16px; align-items: center; height: 66px; }
    .de-breadth-side { text-align: center; white-space: nowrap; }
    .de-breadth-main span { display: block; text-align: center; color: #d9dddd; font-size: 21px; line-height: 1; font-weight: 800; }
    .de-breadth-side div { display: inline-flex; align-items: flex-end; justify-content: center; gap: 2px; margin-top: 4px; }
    .de-breadth-main strong { display: block; font-size: 40px; line-height: .95; }
    .de-breadth-main em { display: block; font-style: normal; font-size: 18px; line-height: 1.05; }
    .de-breadth-bar { display: flex; height: 44px; border-radius: 999px; overflow: hidden; background: rgba(255,255,255,.10); box-shadow: inset 0 2px 8px rgba(0,0,0,.42); }
    .de-breadth-bar i { display: block; position: relative; height: 100%; }
    .de-breadth-bar b { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); color: #fff5e2; font-size: 20px; font-weight: 800; white-space: nowrap; text-shadow: 0 1px 2px rgba(0,0,0,.4); }
    .de-breadth p { margin: 6px 0 0; text-align: center; color: #b8b9b6; font-size: 18px; line-height: 1.15; font-weight: 700; }
    .de-money { left: 26px; right: 26px; top: 932px; height: 144px; padding: 18px 24px; }
    .de-money-grid { display: grid; grid-template-columns: 66px 1fr 1px 66px 1fr; gap: 24px; align-items: center; }
    .de-money-grid span { display: block; color: #c9cac5; font-size: 19px; font-weight: 800; }
    .de-money-grid strong { display: block; margin-top: 6px; color: #ff5652; font-size: 34px; line-height: 1; }
    .de-icon-bubble { width: 66px; height: 66px; border-radius: 50%; display: grid; place-items: center; font-size: 38px; box-shadow: inset 0 0 0 4px rgba(255,255,255,.10), 0 8px 18px rgba(0,0,0,.28); }
    .de-icon-bubble.red { color: #ff4f49; background: radial-gradient(circle, rgba(255,78,72,.38), rgba(80,18,16,.85)); border: 2px solid #d84b41; }
    .de-icon-bubble.gold { color: #ffcf76; background: radial-gradient(circle, rgba(255,207,118,.38), rgba(78,51,16,.85)); border: 2px solid #d49b45; }
    .de-icon-bubble .de-svg-icon { width: 40px; height: 40px; }
    .de-divider { width: 1px; height: 82px; background: rgba(220,177,108,.52); }
    .de-core { left: 26px; right: 26px; top: 1092px; height: 240px; padding: 14px 24px; display: flex; flex-direction: column; }
    .de-core-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 30px; flex: 1; min-height: 0; }
    .de-core-grid > div { display: grid; grid-template-columns: 60px 1fr; column-gap: 16px; padding-right: 14px; border-right: 1px solid rgba(218,166,87,.38); align-content: center; }
    .de-core-grid > div:last-child { border-right: 0; padding-right: 0; }
    .de-round-icon { grid-row: 1 / span 2; width: 60px; height: 60px; border-radius: 50%; display: grid; place-items: center; border: 1px solid #d8a052; color: #f0c979; font-size: 32px; }
    .de-round-icon .de-svg-icon { width: 36px; height: 36px; }
    .de-core h3 { grid-column: 2; margin: 0 0 6px; color: #f0d49c; font-size: 22px; line-height: 1.2; font-weight: 900; letter-spacing: 1px; }
    .de-core-desc { grid-column: 2; margin: 0; color: #d6cbb8; font-size: 17px; line-height: 1.45; font-weight: 600; }
    .de-core-foot { margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(218,166,87,.42); color: #e2cda1; font-size: 14px; line-height: 1.35; font-weight: 600; }
    .de-core-foot::before { content: ""; display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #d8a052; margin-right: 8px; vertical-align: 2px; }

    /* page 2 */
    .de-page2 .de-title-block { top: 40px; }
    .de-page2 .de-title-block h1 { font-size: 76px; }
    .de-dial-panel { left: 26px; right: 26px; top: 216px; height: 380px; padding: 24px 28px; }
    .de-dial-wrap { display: grid; grid-template-columns: 180px 1fr; gap: 28px; align-items: center; height: calc(100% - 44px); }
    .de-dial-wrap .sentiment-dial { display: flex; flex-direction: column; align-items: center; }
    .de-dial-wrap .dial-ring-wrap { display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .de-dial-wrap .dial-ring { width: 180px; height: 180px; }
    .de-dial-wrap .dial-ring::after { inset: 12px; }
    .de-dial-wrap .dial-value { font-size: 88px; line-height: 1; }
    .de-dial-wrap .dial-state { display: none; }
    .de-dial-wrap .dial-foot { display: none; }
    .de-dial-wrap .dial-band-tag { padding: 6px 22px; border: 1px solid #d8a052; border-radius: 999px; color: #f5dba6; font-size: 22px; font-weight: 900; letter-spacing: 4px; background: rgba(8,18,18,.55); }
    .de-dial-bands { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; align-content: center; }
    .de-dial-bands .band { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px 12px; border: 1px solid rgba(218,166,87,.32); border-radius: 8px; background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.01)); }
    .de-dial-bands .band b { color: #f5dba6; font-size: 22px; font-weight: 900; letter-spacing: 0.5px; }
    .de-dial-bands .band i { color: #d8a052; font-size: 18px; font-style: normal; font-weight: 700; }
    .de-dial-bands .band p { margin: 0; color: #d8d4c2; font-size: 18px; line-height: 1.35; text-align: center; }
    .de-factor-panel { left: 26px; right: 26px; top: 612px; height: 380px; padding: 22px 28px; }
    .de-factor-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px 36px; }
    .factor-row { display: grid; grid-template-rows: auto auto; gap: 6px; min-height: 44px; }
    .factor-row > div { display: flex; align-items: center; justify-content: space-between; color: #f0e1c1; font-size: 21px; }
    .factor-row b { color: #f0e1c1; font-weight: 700; font-size: 21px; }
    .factor-row span { color: #c9b88c; font-size: 18px; font-weight: 600; }
    .factor-row .bar { display: block; height: 12px; background: rgba(255,255,255,.10); border-radius: 999px; overflow: hidden; }
    .factor-row .bar i { display: block; height: 100%; border-radius: 999px; }
    .factor-row.bullish .bar i { background: linear-gradient(90deg, #ff5451, #d73a3a); }
    .factor-row.warning .bar i { background: linear-gradient(90deg, #f4c15d, #d49b45); }
    .factor-row.bearish .bar i { background: linear-gradient(90deg, #1ab47b, #0e7e58); }
    .de-signal-panel { left: 26px; right: 26px; top: 1008px; height: 332px; padding: 22px 24px; overflow: hidden; }
    .de-signal-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; }
    .de-signal-card { position: relative; height: 248px; padding: 18px 22px; border-radius: 8px; border: 1px solid rgba(202,144,69,.45); background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.01)); overflow: hidden; }
    .de-signal-card .de-title-icon { font-size: 28px; }
    .de-signal-card.bullish { border-color: rgba(255,80,68,.45); }
    .de-signal-card.bearish { border-color: rgba(26,180,123,.45); }
    .de-signal-card b { display: block; margin-top: 6px; color: #f0e1c1; font-size: 26px; }
    .de-signal-card ul { margin: 10px 0 0; padding: 0; list-style: none; }
    .de-signal-card li { position: relative; margin: 6px 0; padding-left: 18px; color: #d6c7a4; font-size: 17px; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .de-signal-card li::before { content: ""; position: absolute; left: 0; top: 8px; width: 8px; height: 8px; border-radius: 50%; background: currentColor; opacity: .9; }
    .de-signal-card.bullish li::before { background: #ff5451; }
    .de-signal-card.bearish li::before { background: #1ab47b; }

    /* page 3 */
    .de-page3 .de-title-block { top: 40px; }
    .de-page3 .de-title-block h1 { font-size: 76px; }
    .de-limit-panel { left: 26px; right: 26px; top: 196px; height: 320px; padding: 18px 22px; overflow: hidden; }
    .de-limit-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
    .de-limit-card { position: relative; height: 200px; border-radius: 8px; padding: 16px 18px; text-align: center; box-shadow: inset 0 -25px 40px rgba(0,0,0,.18); overflow: hidden; }
    .de-limit-card.red { background: linear-gradient(145deg,#f14646,#8d2528); }
    .de-limit-card.green { background: linear-gradient(145deg,#0d7c5c,#0b3e3b); }
    .de-limit-card span { display: block; color: #fff5e2; font-size: 22px; font-weight: 900; }
    .de-limit-card strong { display: block; margin: 8px 0 6px; color: #fff5e2; font-size: 56px; line-height: 1; }
    .de-limit-card em { font-size: 22px; font-style: normal; margin-left: 2px; }
    .de-limit-card .metric-compare { margin-top: 6px; padding: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 15px; font-weight: 700; color: #ffffff; background: transparent; line-height: 1.2; }
    .de-limit-card .metric-compare.bullish, .de-limit-card .metric-compare.bearish, .de-limit-card .metric-compare.warning { color: #ffffff; background: transparent; }
    .de-limit-card .metric-compare .delta-arrow { display: inline-block; font-size: 14px; line-height: 1; }
    .de-limit-foot { display: flex; justify-content: space-between; margin-top: 10px; color: #c9b88c; font-size: 14px; }
    .de-theme-panel { left: 26px; right: 26px; top: 532px; height: 380px; padding: 22px 22px; overflow: hidden; }
    .de-theme-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 26px; height: calc(100% - 38px); align-items: stretch; }
    .de-theme-col { display: flex; flex-direction: column; min-height: 0; }
    .de-theme-col h3 { margin: 0 0 10px; color: #f0d49c; font-size: 21px; font-weight: 800; }
    .de-theme-col h3 em { font-style: normal; color: #c9b88c; font-size: 16px; margin-left: 8px; font-weight: 600; }
    /* 题材领涨/领跌：固定 5 行布局（1 行 header + 5 行数据），行号对齐 */
    .theme-bars { display: grid; grid-template-rows: auto repeat(5, 1fr); gap: 6px; flex: 1; min-height: 0; }
    .theme-empty { color: #8a8475; font-size: 16px; padding: 16px 0; text-align: center; font-style: italic; }
    /* 基础行：3 列(领涨) / 2 列(领跌) */
    .theme-bar-row { display: grid; align-items: center; gap: 10px; font-size: 17px; color: #e9e2cf; min-height: 0; line-height: 1.15; }
    .theme-bars.gainers .theme-bar-row { grid-template-columns: 100px 1fr 56px; }
    .theme-bars.losers .theme-bar-row { grid-template-columns: 100px 1fr; }
    /* 列标题行 */
    .theme-bar-header { font-size: 15px; color: #c9b88c; font-weight: 700; border-bottom: 1px solid rgba(220,177,108,.32); padding: 0 0 6px; min-height: 22px; }
    .theme-bar-header em { font-weight: 700; }
    .theme-bar-header span { font-weight: 700; }
    /* 数据行 */
    .theme-bar-row span { font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .theme-bar-row em { font-style: normal; text-align: right; font-size: 16px; font-weight: 700; }
    /* 占位行 */
    .theme-bar-placeholder { color: rgba(233,226,207,.30); }
    .theme-bar-placeholder span, .theme-bar-placeholder em { font-weight: 500; }
    /* 条形 + 数值组合：b 是绝对定位的彩色条，u 绝对定位紧跟 b 末端外侧 */
    .bar-track { position: relative; display: flex; align-items: center; min-width: 0; height: 16px; column-gap: 6px; }
    .bar-track::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); height: 10px; background: rgba(220,177,108,.18); border-radius: 999px; pointer-events: none; }
    .bar-track b { position: relative; display: block; flex: 0 1 var(--bar-width, 0%); height: 10px; min-width: 14px; border-radius: 999px; z-index: 1; box-shadow: inset 0 1px 0 rgba(255,255,255,.32), inset 0 -1px 1px rgba(0,0,0,.18); }
    .bar-track u { position: relative; flex: 0 0 auto; font-style: normal; font-size: 13px; font-weight: 800; text-decoration: none; white-space: nowrap; letter-spacing: 0; line-height: 1; z-index: 2; }
    .theme-bar-row.bullish .bar-track b { background: linear-gradient(90deg, #ff5750, #ff7844); }
    .theme-bar-row.bearish .bar-track b { background: linear-gradient(90deg, #1ab47b, #0e7e58); }
    .theme-bar-row.bullish .bar-track u { color: #ff8b76; }
    .theme-bar-row.bearish .bar-track u { color: #58d6a4; }
    .theme-bar-placeholder .bar-track::before { background: rgba(220,177,108,.10); }
    .theme-bar-placeholder .bar-track b { background: rgba(220,177,108,.18) !important; box-shadow: none; }
    .theme-bar-placeholder .bar-track u { color: rgba(233,226,207,.30); }
    .de-deep-panel { left: 26px; right: 26px; top: 928px; height: 412px; padding: 0; overflow: hidden; }
    .de-deep-panel .theme-deep-dive { position: absolute; inset: 22px 26px; }
    .theme-deep-dive .deep-dive-header { display: flex; align-items: baseline; gap: 14px; margin-bottom: 14px; }
    .theme-deep-dive .deep-dive-header h2 { margin: 0; color: #f5dba6; font-size: 30px; }
    .theme-deep-dive .deep-dive-header span { color: #a0a5a5; font-size: 17px; }
    .deep-dive-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; height: 100%; }
    .theme-deep-dive.single .deep-dive-grid { grid-template-columns: 1fr; }
    .deep-dive-card { padding: 18px 20px; border: 1px solid rgba(202,144,69,.40); border-radius: 8px; background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.01)); overflow: hidden; min-height: 0; display: flex; flex-direction: column; }
    .deep-dive-card.bullish { border-color: rgba(255,80,68,.42); }
    .deep-dive-card.bearish { border-color: rgba(26,180,123,.42); }
    .deep-dive-card h2 { margin: 0 0 12px; color: #f5dba6; font-size: 23px; }
    .deep-dive-items { display: grid; gap: 10px; min-height: 0; flex: 1; align-content: start; }
    .deep-dive-item { padding: 14px 16px; border: 1px solid rgba(255,255,255,.07); border-radius: 6px; background: rgba(0,0,0,.18); overflow: hidden; display: flex; flex-direction: column; gap: 10px; }
    .deep-dive-title { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .deep-dive-title h3 { margin: 0; color: #f0e1c1; font-size: 22px; font-weight: 800; }
    .deep-dive-card.bullish .deep-dive-title h3 { color: #ff8b76; }
    .deep-dive-card.bearish .deep-dive-title h3 { color: #58d6a4; }
    .deep-dive-stage { padding: 3px 10px; border-radius: 999px; background: rgba(220,177,108,.16); color: #f4c15d; font-size: 14px; flex-shrink: 0; }
    .deep-dive-analysis { margin: 0; color: #d6c7a4; font-size: 16px; line-height: 1.6; text-align: justify; }
    .deep-dive-judgment, .deep-dive-narrative { margin: 5px 0; color: #d6c7a4; font-size: 16px; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-box-orient: vertical; }
    .deep-dive-judgment { -webkit-line-clamp: 2; line-clamp: 2; }
    .deep-dive-narrative { -webkit-line-clamp: 4; line-clamp: 4; }
    .deep-dive-judgment b, .deep-dive-narrative b { color: #f0d49c; margin-right: 6px; }
    .deep-dive-signals { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .deep-dive-signal { display: flex; gap: 6px; padding: 7px 10px; border-radius: 5px; background: rgba(0,0,0,.22); color: #d6c7a4; font-size: 14px; line-height: 1.4; }
    .deep-dive-signal.bullish { border-left: 2px solid #ff5750; }
    .deep-dive-signal.bearish { border-left: 2px solid #1ab47b; }
    .deep-dive-signal b { color: #f0d49c; flex-shrink: 0; }
    .deep-dive-compact-signals { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; color: #d6c7a4; font-size: 14px; }
    .deep-dive-compact-signals b { color: #f0d49c; margin-right: 4px; }
    .deep-dive-item.compact .deep-dive-judgment { -webkit-line-clamp: 1; line-clamp: 1; }
    .deep-dive-item.compact .deep-dive-narrative { -webkit-line-clamp: 1; line-clamp: 1; }

    /* page 4 */
    .de-page4 .de-title-block { top: 30px; }
    .de-page4 .de-title-block h1 { font-size: 70px; }
    .de-page4 .de-date { margin-top: 14px; font-size: 19px; letter-spacing: 1px; }
    .de-ladder-head { left: 26px; right: 26px; top: 156px; height: 220px; padding: 18px 22px; overflow: hidden; }
    .de-ladder-metrics { display: grid; grid-template-columns: 1fr 1fr 1.25fr; gap: 14px; height: calc(100% - 38px); }
    .de-ladder-card { padding: 18px 22px; border: 1px solid rgba(202,144,69,.40); border-radius: 8px; background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.01)); text-align: center; display: flex; flex-direction: column; justify-content: center; gap: 6px; min-height: 142px; }
    .de-ladder-card span { color: #c9b88c; font-size: 18px; }
    .de-ladder-card strong { color: #f0d49c; font-size: 44px; line-height: 1.1; font-weight: 900; letter-spacing: 1px; }
    .de-ladder-card em { font-size: 18px; font-style: normal; color: #d6c7a4; }
    .de-ladder-card-featured { position: relative; border: 1px solid #d8a052; background: radial-gradient(circle at 50% 0%, rgba(245,200,90,.18), rgba(255,255,255,.02) 60%), linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.01)); box-shadow: inset 0 0 0 1px rgba(245,219,166,.20), 0 0 22px rgba(216,160,82,.22); }
    .de-ladder-card-featured::before, .de-ladder-card-featured::after { content: ""; position: absolute; left: 14px; right: 14px; height: 1px; background: linear-gradient(90deg, transparent, #f0d49c 50%, transparent); opacity: .55; }
    .de-ladder-card-featured::before { top: 6px; }
    .de-ladder-card-featured::after { bottom: 6px; }
    .de-ladder-card-featured span { color: #f0d49c; font-size: 16px; letter-spacing: 4px; }
    .de-ladder-card-featured strong { color: #fff1c8; font-size: 40px; text-shadow: 0 0 18px rgba(245,200,90,.40); white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
    .de-ladder-card-featured em { color: #f0d49c; font-size: 16px; letter-spacing: 1px; }
    .de-ladder-strip { left: 26px; right: 26px; top: 396px; height: 300px; padding: 18px 22px; overflow: hidden; }
    .de-ladder-rows { display: grid; gap: 8px; }
    .de-ladder-row { display: grid; grid-template-columns: 70px 1fr; align-items: center; min-height: 52px; padding: 0 14px; border-radius: 6px; background: linear-gradient(90deg, rgba(220,177,108,.10), rgba(255,255,255,.02)); }
    .de-ladder-row b { color: #f0d49c; font-size: 26px; font-weight: 900; }
    .de-ladder-row span { color: #e9e2cf; font-size: 19px; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .de-ladder-row span em { color: #c9b88c; font-style: normal; margin-left: 8px; font-size: 16px; }
    .de-roles-panel { left: 26px; right: 26px; top: 716px; height: 420px; padding: 18px 22px; }
    .de-roles-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; height: calc(100% - 38px); align-items: stretch; }
    .role-card { padding: 14px 14px; border: 1px solid rgba(202,144,69,.45); border-radius: 8px; background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.01)); display: flex; flex-direction: column; justify-content: center; }
    .role-card h2 { margin: 0 0 8px; color: #f0d49c; font-size: 20px; font-weight: 800; }
    .role-card.bullish { border-color: rgba(255,80,68,.40); }
    .role-card.warning { border-color: rgba(244,193,93,.40); }
    .role-card.bearish { border-color: rgba(26,180,123,.40); }
    .leader-row { display: flex; align-items: center; gap: 6px; margin: 6px 0; font-size: 17px; color: #e9e2cf; }
    .leader-row b { color: #f0e1c1; font-weight: 700; }
    .leader-row em { color: #d6c7a4; font-style: normal; font-size: 15px; }
    .de-watch-panel { left: 26px; right: 26px; top: 1160px; height: 196px; padding: 18px 22px; overflow: hidden; }
    .de-watch-panel h2 { display: flex; align-items: center; gap: 8px; }
    .de-watch-panel h2 .de-title-icon { color: #f0d49c; font-size: 28px; }
    .de-watch-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; height: calc(100% - 46px); }
    .de-watch-card { padding: 16px 20px; border-radius: 8px; border: 1px solid rgba(202,144,69,.40); background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.01)); display: flex; flex-direction: column; gap: 8px; }
    .de-watch-card.bullish { border-color: rgba(255,80,68,.40); }
    .de-watch-card.warning { border-color: rgba(244,193,93,.40); }
    .de-watch-card.bearish { border-color: rgba(26,180,123,.40); }
    .de-watch-card b { display: flex; align-items: center; gap: 10px; color: #f0d49c; font-size: 24px; margin-bottom: 2px; font-weight: 900; letter-spacing: 1px; }
    .de-watch-card b svg { width: 28px; height: 28px; flex: 0 0 28px; }
    .de-watch-card p { margin: 0; color: #d6c7a4; font-size: 17px; line-height: 1.55; }

    .bullish { color: #ff5451 !important; }
    .bearish { color: #29b982 !important; }
    .bullish-bg { background: linear-gradient(90deg,#ff7068 0%,#f03535 45%,#b51b1b 100%); }
    .bearish-bg { background: linear-gradient(90deg,#0c8a68 0%,#1ab47b 55%,#4cd6a3 100%); }

    /* dial */
    .sentiment-dial { display: grid; grid-template-columns: 240px 1fr; align-items: center; gap: 16px; }
    .dial-ring {
      position: relative;
      width: 240px;
      height: 240px;
      border-radius: 50%;
      background: conic-gradient(currentColor var(--dial-dash, 0), rgba(255,255,255,.10) 0);
      display: grid;
      place-items: center;
      color: #f0d49c;
    }
    .dial-ring::after { content: ""; position: absolute; inset: 14px; border-radius: 50%; background: rgba(12,18,18,.92); border: 1px solid rgba(220,177,108,.45); }
    .dial-ring.bullish { color: #ff5750; }
    .dial-ring.bullish-soft { color: #f4c15d; }
    .dial-ring.warning { color: #f4c15d; }
    .dial-ring.warning-soft { color: #36d78d; }
    .dial-ring.bearish { color: #1ab47b; }
    .dial-value { position: relative; z-index: 1; color: #f0e1c1; font-size: 76px; font-weight: 900; }
    .dial-state { position: absolute; bottom: 42px; left: 0; right: 0; text-align: center; color: #f0d49c; font-size: 19px; z-index: 1; }
    .dial-foot { position: absolute; bottom: 16px; left: 0; right: 0; text-align: center; color: #c9b88c; font-size: 17px; z-index: 1; }
    .dial-bands { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 12px; }
    .band { padding: 8px 12px; border-radius: 6px; background: rgba(255,255,255,.04); color: #d6c7a4; font-size: 16px; }
  `;
}

function renderDarkEditorialHtml(data) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.report_date)} A股市场情绪日报</title>
<style>${darkEditorialCss()}</style>
</head>
<body>
<main id="report-root" data-report-date="${escapeHtml(data.report_date)}" data-theme="dark-editorial-magazine">
${darkEditorialPage1(data)}
${darkEditorialPage2(data)}
${darkEditorialPage3(data)}
${darkEditorialPage4(data)}
</main>
${darkEditorialSparkScript()}
</body>
</html>`;
}

// Dark editorial sparkline script (uses class 'de-spark')
function darkEditorialSparkScript() {
  return `
    <script>
      (function () {
        const seedProfiles = {
          upA: [.70,.61,.67,.59,.73,.55,.62,.50,.68,.72,.63,.48,.42,.55,.60,.46,.65,.71,.58,.74,.62,.69,.56,.66,.72,.61,.49,.38,.45,.33,.42,.30,.37,.25,.35,.22,.29,.18,.25,.14,.19],
          upB: [.64,.55,.61,.47,.42,.57,.63,.46,.36,.44,.54,.60,.45,.32,.38,.50,.40,.27,.34,.46,.36,.25,.18,.31,.23,.15,.26,.12,.22,.10,.18,.08,.16,.06,.14,.08,.12,.05,.10,.07,.09],
          downA: [.34,.25,.36,.29,.45,.37,.53,.43,.57,.48,.52,.40,.49,.44,.56,.47,.60,.69,.55,.64,.75,.67,.80,.71,.84,.76,.88,.79,.86,.82,.90,.81,.87,.78,.91,.83,.93,.84,.90,.82,.92],
          downB: [.45,.34,.42,.30,.50,.39,.58,.46,.62,.51,.68,.54,.61,.49,.57,.66,.59,.73,.64,.78,.69,.82,.72,.86,.77,.91,.80,.88,.74,.93,.82,.90,.78,.94,.84,.92,.80,.95,.86,.91,.83]
        };
        for (const canvas of document.querySelectorAll('.de-spark')) {
          const ctx = canvas.getContext('2d');
          const seed = String(canvas.dataset.seed || 'editorial');
          const bearish = canvas.dataset.bearish === '1';
          const pct = Number(canvas.dataset.pct || 0);
          const rect = canvas.getBoundingClientRect();
          const dpr = Math.max(1, window.devicePixelRatio || 1);
          const width = Math.max(180, rect.width || 210);
          const height = Math.max(48, rect.height || 58);
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, width, height);
          let hash = 2166136261;
          for (let i = 0; i < seed.length; i += 1) {
            hash ^= seed.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
          }
          const rand = () => {
            hash ^= hash << 13;
            hash ^= hash >>> 17;
            hash ^= hash << 5;
            return ((hash >>> 0) % 10000) / 10000;
          };
          const match = seed.match(/^de-(\\d+)/);
          const index = match ? Number(match[1]) : 0;
          const strongMove = Math.abs(pct) >= 1 || index % 2 === 1;
          const profile = seedProfiles[bearish ? (strongMove ? 'downB' : 'downA') : (strongMove ? 'upB' : 'upA')];
          const step = width / (profile.length - 1);
          const pts = profile.map((value, i) => {
            const impulse = i % 5 === 0 ? (rand() - 0.5) * height * 0.14 : 0;
            const micro = (rand() - 0.5) * height * 0.085;
            const baseY = height * (0.08 + value * 0.68);
            const yVal = Math.max(height * 0.06, Math.min(height * 0.84, baseY + impulse + micro));
            return [i * step, Math.round(yVal * 10) / 10];
          });
          const grad = ctx.createLinearGradient(0, 0, 0, height);
          grad.addColorStop(0, bearish ? 'rgba(26,180,123,.32)' : 'rgba(255,72,70,.32)');
          grad.addColorStop(.58, bearish ? 'rgba(26,180,123,.14)' : 'rgba(255,72,70,.14)');
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.lineTo(pts[pts.length - 1][0], height + 2);
          ctx.lineTo(pts[0][0], height + 2);
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.strokeStyle = bearish ? '#1ab47b' : '#ff4f4b';
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.shadowColor = bearish ? 'rgba(26,180,123,.45)' : 'rgba(255,72,70,.45)';
          ctx.shadowBlur = 2.4;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      })();
    </script>
  `;
}

// =====================================================================
// 2. 浅色机构报告风格 - 4 pages
// =====================================================================

function lightIcon(name) {
  if (name === 'flame') return `<svg viewBox="0 0 48 58" aria-hidden="true"><path d="M29.6 2.8c1 10.7 12.1 15.6 12.1 31.1 0 12.8-8.8 22.2-22.1 22.2C8.2 56.1.8 48 .8 37.4c0-8.1 4.8-14.7 10.6-20.4-.3 6.5 2.2 10.4 7.3 11.2C20.6 17.4 23.8 9 29.6 2.8Z" fill="#df302b"/><path d="M23.1 52.2c-7.1 0-11.6-4.3-11.6-10.9 0-5.2 3.1-8.9 7-12.9.3 4.8 2.3 7.7 5.8 8.7 1.8-5.9 4.8-10.8 9.1-14.8 1.3 7.7 6.7 11.2 6.7 19 0 6.4-6.1 10.9-17 10.9Z" fill="#ff6d55"/></svg>`;
  if (name === 'coins') return `<svg viewBox="0 0 48 48" aria-hidden="true"><ellipse cx="24" cy="12" rx="15" ry="7" fill="none" stroke="currentColor" stroke-width="3"/><path d="M9 12v20c0 4 6.7 7 15 7s15-3 15-7V12M9 22c0 4 6.7 7 15 7s15-3 15-7M9 31c0 4 6.7 7 15 7s15-3 15-7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
  if (name === 'chat') return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 12h28v21H22l-8 7v-7h-4V12Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M17 20h14M17 26h10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
  if (name === 'yuan' || name === 'yen') return `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="18" fill="none" stroke="currentColor" stroke-width="3.2"/><path d="M15.5 14.5 24 25l8.5-10.5M24 25v11.5M16.5 25.5h15M16.5 31h15" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (name === 'eye') return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M4.8 24c5.1-8.2 11.5-12.3 19.2-12.3S38.1 15.8 43.2 24C38.1 32.2 31.7 36.3 24 36.3S9.9 32.2 4.8 24Z" fill="none" stroke="currentColor" stroke-width="4.2" stroke-linejoin="round"/><circle cx="24" cy="24" r="6.2" fill="currentColor"/></svg>`;
  if (name === 'pulse') return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 24h12l4-12 6 26 4-14h10" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (name === 'warning') return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6 45 42H3L24 6Z" fill="currentColor"/><path d="M24 18v12M24 36h.1" fill="none" stroke="#0d0a08" stroke-width="4" stroke-linecap="round"/></svg>`;
  if (name === 'check') return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 25 21 36 40 14" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return '';
}

function lightIndexDelta(item) {
  return item.delta_text ?? item.change_text ?? '';
}

function lightBreadthNotableText(data, up) {
  const notable = String(data.breadth?.notable ?? '').trim();
  if (notable) return notable;
  if (Number.isFinite(up) && up > 0) {
    const bucket = up >= 1000 ? `${Math.floor(up / 1000) * 1000}+股上涨` : `${up}股上涨`;
    return bucket;
  }
  return '';
}

function lightIndexCards(indices) {
  return (indices ?? []).slice(0, 4).map((item, index) => `
    <div class="li-index-card">
      <span>${escapeHtml(item.name)}</span>
      <strong class="${marketClass(item.pct)}">${escapeHtml(Number(item.close ?? 0).toFixed(2))}</strong>
      <em class="${marketClass(item.pct)}">${escapeHtml(lightIndexDelta(item))}　${escapeHtml(pctText(item.pct))}</em>
      ${lightSpark(`li-${index}:${item.pct}`, item.pct)}
    </div>
  `).join('');
}

function lightMetricBox(label, value, sub, cls = 'bullish', compare = '') {
  return `
    <div class="li-metric-box ${cls}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <em>${escapeHtml(sub)}</em>
      ${compare}
    </div>
  `;
}

function lightThemeRowsConcepts(items, limit = 6) {
  return (items ?? []).slice(0, limit).map((item, index) => `
    <div class="li-theme-row">
      <b>${index + 1}</b>
      <span>${escapeHtml(item.name)}</span>
      <em class="bullish">${escapeHtml(`${item.up ?? '--'}只`)}</em>
    </div>
  `).join('');
}

function lightThemeRowsIndustry(items, limit = 6) {
  return (items ?? []).slice(0, limit).map((item, index) => `
    <div class="li-theme-row">
      <b>${index + 1}</b>
      <span>${escapeHtml(item.name)}</span>
      <em class="${marketClass(item.pct)}">${escapeHtml(pctText(item.pct))}</em>
    </div>
  `).join('');
}

function lightInstitutionalPage1(data) {
  const indices = data.indices ?? [];
  const up = Number(data.breadth?.up ?? 0);
  const down = Number(data.breadth?.down ?? 0);
  const total = Math.max(up + down, 1);
  const upPct = clamp(Math.round((up / total) * 1000) / 10, 0, 100);
  const downPct = Math.round((100 - upPct) * 10) / 10;
  const heroSubtitle = data.market_summary?.style_shift || data.market_summary?.headline || '';
  const features = (data.market_summary?.headline ?? '').split(/[·]/).map((s) => s.trim()).filter(Boolean);
  const capitalRows = [
    [data.capital_flow?.metric_name ?? '主力资金', data.capital_flow?.net_text ?? '--'],
    ['北向资金', data.capital_flow?.northbound_text ?? data.capital_flow?.inflow_sectors?.[0]?.amount_text ?? '--']
  ];
  return `
    <section class="poster li-poster li-page1" data-page="1" data-title="市场全景与资金流">
      <div class="li-paper">
        <header class="li-topline"><span>${escapeHtml(lightChineseDate(data.report_date))}　${escapeHtml(data.weekday)}</span><b>客观 · 专业 · 及时</b></header>
        <section class="li-hero">
          <h1>A股市场 · 情绪日报</h1>
          <div><i></i><span>${escapeHtml(heroSubtitle)}</span></div>
        </section>
        <section class="li-panel li-index-panel">
          <div class="li-index-grid">${lightIndexCards(indices)}</div>
        </section>
        <section class="li-panel li-breadth-panel">
          <h2>市场宽度</h2>
          <div class="li-breadth-head">
            <span>上涨 <b class="bullish">${escapeHtml(up)}</b>只</span>
            <span>下跌 <b class="bearish">${escapeHtml(down)}</b>只</span>
          </div>
          <div class="li-breadth-bar"><i class="bullish-bg" style="width:${upPct}%"></i><i class="bearish-bg" style="width:${downPct}%"></i></div>
          <div class="li-breadth-foot">
            <span>涨跌比　${escapeHtml(data.breadth?.ratio_text?.replace('涨跌比 ', '') ?? '--')}</span>
            <span>${escapeHtml(lightBreadthNotableText(data, up))}</span>
            <span>涨停　<b class="bullish">${escapeHtml(data.limit_up?.limit_up ?? '--')}</b></span>
            <span>跌停　<b class="bearish">${escapeHtml(data.limit_up?.limit_down ?? '--')}</b></span>
          </div>
        </section>
        <section class="li-panel li-capital-panel">
          <div class="li-turnover">
            <div class="li-round-icon">${lightIcon('coins')}</div>
            <div><h2>两市成交</h2><strong>${escapeHtml(data.turnover?.amount_text ?? '--')}</strong><p>${escapeHtml(data.turnover?.change_text ?? '')}</p></div>
          </div>
          <div class="li-flow">
            <div class="li-round-icon gold">${lightIcon('yen')}</div>
            <div>
              <h2>资金流向 <em>（全日）</em></h2>
              ${capitalRows.map(([label, value]) => `<p><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></p>`).join('')}
            </div>
          </div>
        </section>
        <section class="li-panel li-summary-panel">
          <h2>核心要点</h2>
          <ul>${features.slice(0, 3).map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
        </section>
        <footer class="li-footer footer">数据来源：公开市场数据｜仅供复盘，不构成投资建议</footer>
      </div>
    </section>
  `;
}

function lightInstitutionalPage2(data) {
  const emotion = data.emotion_model_v1 ?? {};
  const factors = emotion.factors ?? [];
  return `
    <section class="poster li-poster li-page2" data-page="2" data-title="短线情绪周期">
      <div class="li-paper">
        <header class="li-topline"><span>${escapeHtml(lightChineseDate(data.report_date))}　${escapeHtml(data.weekday)}</span><b>A股市场 · 情绪日报</b></header>
        <section class="li-hero li-hero-page2">
          <div class="li-flame">${lightIcon('flame')}</div>
          <h1>短线情绪 · 周期诊断</h1>
        </section>
        <section class="li-panel li-dial-panel">
          <h2>情绪分 / 状态</h2>
          <div class="li-dial-wrap">
            <div class="li-dial-card">
              ${sentimentDial(emotion.score ?? 0, emotion.state ?? '--')}
              <p class="li-dial-note">情绪分由10项因子加总得到；0-24冰点，25-39弱修复，40-54分歧，55-69修复初期，70-84主线扩散，85+高潮。</p>
            </div>
            <div class="li-band-table">
              <h3>情绪分区间含义</h3>
              <div class="li-band-row bullish"><span>70-84</span><b>主线扩散</b><i>主线进入明确扩散阶段</i></div>
              <div class="li-band-row bullish-soft"><span>55-69</span><b>修复初期</b><i>情绪由分歧向修复过渡</i></div>
              <div class="li-band-row warning"><span>40-54</span><b>分歧震荡</b><i>主线不清晰，热点快速轮动</i></div>
              <div class="li-band-row warning-soft"><span>25-39</span><b>弱修复</b><i>局部修复但缺乏共振</i></div>
              <div class="li-band-row bearish"><span>0-24</span><b>冰点</b><i>情绪冰点，等待方向选择</i></div>
            </div>
          </div>
        </section>
        <section class="li-panel li-factor-panel">
          <h2>10 项情绪因子</h2>
          <div class="li-factor-grid">
            ${factorItems(factors, 10)}
          </div>
        </section>
        <section class="li-panel li-signal-panel">
          <h2><span class="li-title-icon">${lightIcon('eye')}</span> 次日观察信号</h2>
          <div class="li-signal-grid">
            <div class="li-signal-card bullish">
              <span class="li-title-icon">${lightIcon('check')}</span>
              <b>多头信号</b>
              <ul>${bullishSignals(data).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
            </div>
            <div class="li-signal-card bearish">
              <span class="li-title-icon">${lightIcon('warning')}</span>
              <b>空头信号</b>
              <ul>${bearishSignals(data).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
            </div>
          </div>
        </section>
        <footer class="li-footer footer">数据来源：公开市场数据｜仅供复盘，不构成投资建议</footer>
      </div>
    </section>
  `;
}

function lightInstitutionalPage3(data) {
  const conceptCounts = (data.themes?.concept_counts ?? []).slice(0, 12);
  const interpretation = data.theme_interpretation ?? {};
  const sections = themeDeepDiveSections(interpretation);
  return `
    <section class="poster li-poster li-page3" data-page="3" data-title="涨停与主线复盘">
      <div class="li-paper">
        <header class="li-topline"><span>${escapeHtml(lightChineseDate(data.report_date))}　${escapeHtml(data.weekday)}</span><b>A股市场 · 涨停复盘</b></header>
        <section class="li-hero li-hero-page3">
          <div class="li-flame">${lightIcon('flame')}</div>
          <h1>涨停复盘 · 主线结构</h1>
          <p>展示口径　${escapeHtml(data.limit_up?.display口径 ?? '非ST短线口径')}</p>
        </section>
        <section class="li-panel li-limit-panel">
          <h2>涨跌停与封板结构</h2>
          <div class="li-metric-grid">
            ${lightMetricBox('涨停', String(data.limit_up?.limit_up ?? '--'), data.limit_up?.display口径 ?? '', 'bullish', metricCompare(data.limit_up?.limit_up, data.limit_up?.previous_day?.limit_up, '只', { favorableIncrease: true }))}
            ${lightMetricBox('跌停', String(data.limit_up?.limit_down ?? '--'), '', 'bearish', metricCompare(data.limit_up?.limit_down, data.limit_up?.previous_day?.limit_down, '只', { favorableIncrease: false }))}
            ${lightMetricBox('炸板', String(data.limit_up?.broken_board ?? '--'), '', 'bearish', metricCompare(data.limit_up?.broken_board, data.limit_up?.previous_day?.broken_board, '只', { favorableIncrease: false }))}
            ${lightMetricBox('封板率', `${data.limit_up?.seal_rate_pct ?? '--'}%`, '', 'bullish', metricCompare(data.limit_up?.seal_rate_pct, data.limit_up?.previous_day?.seal_rate_pct, '%', { deltaUnit: 'pct', previousUnit: '%', favorableIncrease: true }))}
          </div>
          <div class="li-limit-foot">
            <span>展示口径　${escapeHtml(data.limit_up?.display口径 ?? '非ST短线口径')}</span>
            <span>${escapeHtml(data.limit_up?.full_market?.['口径'] ?? '全口径')}: 涨停 ${escapeHtml(data.limit_up?.full_market?.limit_up ?? '--')} / 跌停 ${escapeHtml(data.limit_up?.full_market?.limit_down ?? '--')}</span>
          </div>
        </section>
        <section class="li-panel li-theme-panel">
          <div class="li-theme-grid">
            <div class="li-theme-col li-theme-col-gainers">
              <h3>领涨TOP <em>涨幅口径</em></h3>
              ${topGainersThemeBars(conceptCounts, 5)}
            </div>
            <div class="li-theme-col li-theme-col-losers">
              <h3>领跌TOP <em>跌幅口径</em></h3>
              ${topLosersThemeBars(conceptCounts, 5)}
            </div>
          </div>
        </section>
        <section class="li-panel li-deep-panel">
          ${renderThemeDeepDiveMarkup(sections)}
        </section>
        <footer class="li-footer footer">数据来源：公开市场数据｜仅供复盘，不构成投资建议</footer>
      </div>
    </section>
  `;
}

function lightInstitutionalPage4(data) {
  const boards = ladderBoardsSorted(data);
  const topBoards = boards.slice(0, 4);
  const roles = data.leader_roles ?? {};
  const roleKeys = ['空间龙', '板块龙头', '容量中军', '核心助攻', '中位接力', '补涨前排', '首板前排', '风险负反馈'];
  return `
    <section class="poster li-poster li-page4" data-page="4" data-title="强势板块龙头梯队">
      <div class="li-paper">
        <header class="li-topline"><span>${escapeHtml(lightChineseDate(data.report_date))}　${escapeHtml(data.weekday)}</span><b>A股市场 · 龙头梯队</b></header>
        <section class="li-hero li-hero-page4">
          <div class="li-flame">${lightIcon('flame')}</div>
          <h1>龙头梯队 · 强势板块</h1>
          <div class="li-page4-meta"><i></i><span>连板梯队 / 角色映射</span><i></i></div>
        </section>
        <section class="li-panel li-ladder-head">
          <h2>梯队关键指标</h2>
          <div class="li-ladder-metrics">
            <div class="li-ladder-card">
              <span>非ST空间高度</span>
              <strong>${escapeHtml(highestLadderText(data))}<em>板</em></strong>
              ${metricCompare(highestLadderNumber(data), data.ladder?.previous_day?.highest_non_st_board, '板', { favorableIncrease: true })}
            </div>
            <div class="li-ladder-card">
              <span>连板总数</span>
              <strong>${escapeHtml(consecutiveBoardCount(data))}<em>只</em></strong>
              ${metricCompare(consecutiveBoardCount(data), data.ladder?.previous_day?.consecutive_board_total, '只', { favorableIncrease: true })}
            </div>
            <div class="li-ladder-card li-ladder-card-featured">
              <span>高度核心</span>
              <strong>${escapeHtml(highestLadderStockText(data, 1))}</strong>
            </div>
          </div>
        </section>
        <section class="li-panel li-ladder-strip">
          <h2>连板梯队</h2>
          <div class="li-ladder-rows">
            ${topBoards.map((row) => `
              <div class="li-ladder-row">
                <b>${escapeHtml(row.board)}板</b>
                <span>${(row.stocks ?? []).slice(0, 4).map((s) => `${escapeHtml(s.name)}<em>${escapeHtml(s.theme ?? '')}</em>`).join(' / ')}</span>
              </div>
            `).join('')}
          </div>
        </section>
        <section class="li-panel li-roles-panel">
          <h2>角色映射</h2>
          <div class="li-roles-grid">
            ${roleKeys.map((role) => rolePanel(role, roleItemsForRole(roles, role, 2), 2)).join('')}
          </div>
        </section>
        <section class="li-panel li-watch-panel">
          <h2>次日梯队判断</h2>
          <div class="li-watch-grid">
            <div class="bullish"><b>${lightSignalIcon('bullish')}确认</b><p>${escapeHtml((data.next_session_signals?.['确认信号'] ?? [])[0] ?? '')}</p></div>
            <div class="warning"><b>${lightSignalIcon('warning')}弱化</b><p>${escapeHtml((data.next_session_signals?.['弱化信号'] ?? [])[0] ?? '')}</p></div>
            <div class="bearish"><b>${lightSignalIcon('bearish')}风险</b><p>${escapeHtml((data.next_session_signals?.['风险信号'] ?? [])[0] ?? '')}</p></div>
          </div>
        </section>
        <footer class="li-footer footer">数据来源：公开市场数据｜仅供复盘，不构成投资建议</footer>
      </div>
    </section>
  `;
}

function lightInstitutionalCss() {
  return `
    * { box-sizing: border-box; }
    body { margin: 0; background: #ded8cc; font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; }
    #report-root { display: flex; align-items: flex-start; gap: 0; background: #ded8cc; }
    .li-poster {
      width: 1080px;
      height: 1440px;
      flex: 0 0 1080px;
      position: relative;
      overflow: hidden;
      color: #142641;
      background:
        radial-gradient(circle at 50% 0%, rgba(216,33,29,.06), transparent 35%),
        radial-gradient(circle at 50% 48%, rgba(255,255,255,.94), rgba(255,255,255,.30) 39%, transparent 68%),
        linear-gradient(135deg, #f6f1e8 0%, #f9faf8 48%, #efe7d9 100%);
    }
    .li-paper {
      position: absolute;
      inset: 18px 20px;
      padding: 36px 34px 48px;
      border-radius: 6px;
      background: rgba(255,255,255,.76);
      border: 1px solid rgba(24,43,71,.22);
      box-shadow: 0 12px 38px rgba(38,36,28,.24), inset 0 0 80px rgba(235,224,204,.34);
    }
    .li-topline {
      height: 40px;
      border-bottom: 2px solid #1c3154;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      color: #31343a;
      font-size: 28px;
    }
    .li-topline b { color: #b08340; font-weight: 500; }
    .li-page2 .li-topline b, .li-page3 .li-topline b, .li-page4 .li-topline b { color: #1a3050; }
    .li-hero { position: relative; padding-top: 26px; }
    .li-hero h1 {
      margin: 0;
      color: #1a3050;
      font-family: SimSun, STSong, "Noto Serif CJK SC", serif;
      font-size: 78px;
      line-height: 1;
      font-weight: 900;
    }
    .li-hero div:not(.li-flame) { display: flex; align-items: center; margin-top: 16px; gap: 18px; color: #2d2f34; font-size: 32px; letter-spacing: 10px; }
    .li-hero i { width: 96px; height: 10px; background: #d8211d; display: block; }
    .li-panel {
      position: absolute;
      border: 1.5px solid rgba(30,58,91,.54);
      border-radius: 7px;
      background: rgba(255,255,255,.66);
      box-shadow: inset 0 0 60px rgba(239,232,218,.30);
      overflow: hidden;
    }
    .li-index-panel { left: 34px; right: 34px; top: 222px; height: 252px; padding: 22px 20px; }
    .li-index-grid { display: grid; grid-template-columns: repeat(4, 1fr); height: 100%; }
    .li-index-card { position: relative; text-align: center; padding: 0 18px; border-right: 1px solid rgba(33,54,82,.36); overflow: hidden; }
    .li-index-card:last-child { border-right: 0; }
    .li-index-card span { display: block; color: #171c23; font-size: 26px; font-weight: 700; }
    .li-index-card strong { display: block; margin-top: 12px; font-size: 46px; line-height: 1; font-weight: 500; }
    .li-index-card em { display: block; margin-top: 8px; font-size: 22px; line-height: 1; font-style: normal; }
    .li-spark { width: 210px; height: 56px; margin-top: 14px; }
    .li-breadth-panel { left: 34px; right: 34px; top: 498px; height: 258px; padding: 20px 28px; }
    .li-breadth-panel h2, .li-summary-panel h2, .li-turnover h2, .li-flow h2, .li-dial-panel h2, .li-factor-panel h2, .li-signal-panel h2, .li-limit-panel h2, .li-theme-panel h2, .li-deep-panel h2, .li-ladder-head h2, .li-ladder-strip h2, .li-roles-panel h2, .li-watch-panel h2 {
      margin: 0;
      color: #1a3050;
      font-size: 34px;
      line-height: 1;
      font-weight: 900;
    }
    .li-breadth-head { display: flex; justify-content: space-between; margin-top: 18px; color: #24282c; font-size: 28px; }
    .li-breadth-head b { font-size: 44px; margin: 0 4px; }
    .li-breadth-bar { display: flex; height: 30px; margin-top: 18px; border-radius: 999px; overflow: hidden; background: rgba(35,47,60,.10); box-shadow: inset 0 2px 6px rgba(20,30,40,.18); }
    .li-breadth-bar i { display: block; height: 100%; }
    .li-breadth-foot { display: grid; grid-template-columns: 1fr 1fr .75fr .75fr; gap: 18px; margin-top: 18px; color: #2f3336; font-size: 26px; text-align: center; }
    .li-breadth-foot span { border-right: 1px solid rgba(34,52,76,.24); }
    .li-breadth-foot span:last-child { border-right: 0; }
    .li-breadth-foot b { font-size: 32px; }
    .li-capital-panel { left: 34px; right: 34px; top: 780px; height: 258px; display: grid; grid-template-columns: 1fr 1.08fr; }
    .li-turnover, .li-flow { display: grid; grid-template-columns: 70px 1fr; column-gap: 28px; padding: 24px 22px; }
    .li-flow { border-left: 1px solid rgba(30,58,91,.36); }
    .li-round-icon { width: 66px; height: 66px; border: 1.5px solid #1b3c64; border-radius: 50%; display: grid; place-items: center; color: #244868; }
    .li-round-icon svg { width: 40px; height: 40px; }
    .li-round-icon.gold { color: #ad8958; border-color: #ad8958; }
    .li-round-icon.filled { background: #244868; color: white; border-color: #244868; }
    .li-turnover strong { display: block; margin-top: 14px; color: #d8211d; font-size: 64px; line-height: 1; font-weight: 400; }
    .li-turnover p { margin: 16px 0 0; color: #62666a; font-size: 22px; }
    .li-turnover p b { color: #d8211d; font-weight: 500; }
    .li-flow h2 em { font-size: 22px; font-style: normal; font-weight: 400; color: #323840; }
    .li-flow p { display: flex; justify-content: space-between; align-items: center; height: 42px; margin: 0; border-bottom: 1px solid rgba(30,58,91,.14); color: #42464a; font-size: 22px; }
    .li-flow p:first-of-type { margin-top: 20px; }
    .li-flow b { color: #d8211d; font-size: 24px; font-weight: 500; }
    .li-summary-panel { left: 34px; right: 34px; top: 1062px; height: 286px; padding: 24px 28px; }
    .li-summary-panel ul { margin: 24px 0 0; padding: 0; list-style: none; }
    .li-summary-panel li { position: relative; padding: 10px 0 10px 24px; color: #1d2227; font-size: 22px; line-height: 1.5; border-bottom: 1px solid rgba(30,58,91,.14); }
    .li-summary-panel li:last-child { border-bottom: 0; }
    .li-summary-panel li::before { content: ""; position: absolute; left: 0; top: 19px; width: 9px; height: 9px; background: #d8211d; border-radius: 50%; }
    .li-footer { position: absolute; left: 34px; right: 34px; bottom: 35px; color: #3a3d41; font-size: 22px; text-align: center; letter-spacing: 4px; }

    .li-page2 .li-hero { padding-top: 24px; padding-left: 84px; }
    .li-page2 .li-hero h1 { font-size: 68px; }
    .li-page2 .li-hero p { margin: 15px 0 0; color: #31343a; font-size: 25px; letter-spacing: 4px; }
    .li-flame { position: absolute; left: 0; top: 26px; width: 76px; height: 84px; color: #d8211d; }
    .li-flame svg { width: 76px; height: 84px; }
    .li-title-icon { display: inline-grid; place-items: center; width: 1.08em; height: 1.08em; margin-right: 6px; color: currentColor; vertical-align: -0.16em; }
    .li-title-icon svg { width: 1em; height: 1em; }
    .li-dial-panel { left: 34px; right: 34px; top: 232px; height: 492px; padding: 22px 26px; }
    .li-dial-wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; height: calc(100% - 50px); }
    .li-dial-card { display: flex; flex-direction: column; align-items: center; gap: 14px; }
    .li-dial-card .sentiment-dial { grid-template-columns: 1fr; }
    .li-dial-note { margin: 0; color: #2a2f37; font-size: 19px; line-height: 1.55; text-align: center; padding: 0 16px; }
    .li-band-table { display: flex; flex-direction: column; gap: 10px; }
    .li-band-table h3 { margin: 0 0 8px; color: #1a3050; font-size: 26px; font-weight: 900; }
    .li-band-row { display: grid; grid-template-columns: 84px 1fr 1.6fr; align-items: center; padding: 10px 14px; border-radius: 6px; background: rgba(255,255,255,.46); border: 1px solid rgba(30,58,91,.18); color: #1d2227; font-size: 19px; }
    .li-band-row span { font-weight: 900; font-size: 22px; text-align: center; }
    .li-band-row b { color: #1a3050; font-size: 21px; margin-left: 12px; }
    .li-band-row i { font-style: normal; color: #5b6068; font-size: 18px; }
    .li-band-row.bullish { border-color: rgba(216,33,29,.42); background: rgba(255,232,228,.6); }
    .li-band-row.bullish span { color: #d8211d; }
    .li-band-row.bullish-soft { border-color: rgba(216,138,30,.42); background: rgba(255,245,221,.6); }
    .li-band-row.bullish-soft span { color: #c48014; }
    .li-band-row.warning { border-color: rgba(120,120,30,.40); background: rgba(255,251,222,.6); }
    .li-band-row.warning span { color: #8a7800; }
    .li-band-row.warning-soft { border-color: rgba(10,157,112,.40); background: rgba(220,243,232,.6); }
    .li-band-row.warning-soft span { color: #0a8c68; }
    .li-band-row.bearish { border-color: rgba(10,140,104,.45); background: rgba(220,243,232,.6); }
    .li-band-row.bearish span { color: #0a8c68; }
    .li-factor-panel { left: 34px; right: 34px; top: 742px; height: 426px; padding: 22px 26px; }
    .li-factor-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px 30px; margin-top: 18px; }
    .factor-row { display: grid; grid-template-rows: auto auto; gap: 6px; min-height: 38px; }
    .factor-row > div { display: flex; align-items: center; justify-content: space-between; color: #1d2227; font-size: 18px; }
    .factor-row b { color: #1a3050; font-weight: 600; font-size: 18px; }
    .factor-row span { color: #5b6068; font-size: 16px; }
    .factor-row .bar { display: block; height: 10px; background: rgba(35,47,60,.10); border-radius: 999px; overflow: hidden; }
    .factor-row .bar i { display: block; height: 100%; border-radius: 999px; }
    .factor-row.bullish .bar i { background: linear-gradient(90deg, #e24b40, #d8211d); }
    .factor-row.warning .bar i { background: linear-gradient(90deg, #f1b95c, #d49b45); }
    .factor-row.bearish .bar i { background: linear-gradient(90deg, #1ab47b, #0e7e58); }
    .li-signal-panel { left: 34px; right: 34px; top: 1176px; height: 200px; padding: 22px 26px; overflow: hidden; }
    .li-signal-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; }
    .li-signal-card { position: relative; height: 124px; padding: 12px 16px; border-radius: 7px; border: 1px solid rgba(30,58,91,.34); background: rgba(255,255,255,.55); overflow: hidden; }
    .li-signal-card .li-title-icon { font-size: 24px; }
    .li-signal-card.bullish { border-color: rgba(216,33,29,.45); background: linear-gradient(180deg, rgba(255,236,232,.78), rgba(255,255,255,.55)); }
    .li-signal-card.bearish { border-color: rgba(10,140,104,.45); background: linear-gradient(180deg, rgba(220,243,232,.78), rgba(255,255,255,.55)); }
    .li-signal-card b { display: block; margin-top: 2px; color: #1a3050; font-size: 20px; }
    .li-signal-card ul { margin: 6px 0 0; padding: 0; list-style: none; }
    .li-signal-card li { position: relative; margin: 2px 0; padding-left: 16px; color: #2a2f37; font-size: 15px; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .li-signal-card li::before { content: ""; position: absolute; left: 0; top: 6px; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .li-signal-card.bullish li::before { background: #d8211d; }
    .li-signal-card.bearish li::before { background: #0a8c68; }

    .li-page3 .li-hero { padding-top: 24px; padding-left: 84px; }
    .li-page3 .li-hero h1 { font-size: 68px; }
    .li-page3 .li-hero p { margin: 15px 0 0; color: #31343a; font-size: 25px; letter-spacing: 4px; }
    .li-limit-panel { left: 34px; right: 34px; top: 212px; height: 340px; padding: 18px 22px; overflow: hidden; }
    .li-metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 12px; }
    .li-metric-box { height: 216px; border: 1px solid rgba(216,33,29,.36); border-radius: 8px; text-align: center; padding: 18px 10px; background: rgba(255,255,255,.46); overflow: hidden; }
    .li-metric-box.bearish { border-color: rgba(10,157,112,.32); }
    .li-metric-box span { display: block; color: #32363b; font-size: 22px; }
    .li-metric-box strong { display: block; margin-top: 12px; color: #d8211d; font-size: 58px; line-height: 1; font-weight: 500; }
    .li-metric-box.bearish strong { color: #0c9c75; }
    .li-metric-box em { display: block; margin-top: 10px; color: #3f444a; font-size: 18px; font-style: normal; }
    .li-metric-box .metric-compare, .li-ladder-card .metric-compare { margin-top: 10px; padding: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; max-width: 100%; color: #6a6f76; background: transparent; font-size: 16px; font-weight: 600; line-height: 1.25; }
    .li-metric-box .metric-compare.bullish, .li-ladder-card .metric-compare.bullish { color: #d8211d; background: transparent; }
    .li-metric-box .metric-compare.bearish, .li-ladder-card .metric-compare.bearish { color: #0c9c75; background: transparent; }
    .li-metric-box .metric-compare.warning, .li-ladder-card .metric-compare.warning { color: #a0742d; background: transparent; }
    .li-limit-foot { display: flex; justify-content: space-between; margin-top: 12px; color: #5b6068; font-size: 14px; }
    .li-theme-panel { left: 34px; right: 34px; top: 568px; height: 340px; padding: 22px 22px; overflow: hidden; }
    .li-theme-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 24px; height: calc(100% - 50px); align-items: stretch; }
    .li-theme-col { display: flex; flex-direction: column; min-height: 0; }
    .li-theme-col h3 { margin: 0 0 8px; color: #1a3050; font-size: 22px; font-weight: 900; }
    .li-theme-col h3 em { font-style: normal; color: #5b6068; font-size: 16px; margin-left: 8px; font-weight: 600; }
    /* 题材领涨/领跌：固定 5 行布局（1 行 header + 5 行数据），行号对齐 */
    .li-theme-col .theme-bars { display: grid; grid-template-rows: auto repeat(5, 1fr); gap: 5px; flex: 1; min-height: 0; }
    .li-theme-col .theme-bar-row { display: grid; align-items: center; gap: 8px; font-size: 16px; color: #1d2227; min-height: 0; line-height: 1.15; }
    .li-theme-col .theme-bars.gainers .theme-bar-row { grid-template-columns: 90px 1fr 50px; }
    .li-theme-col .theme-bars.losers .theme-bar-row { grid-template-columns: 90px 1fr; }
    .li-theme-col .theme-bar-header { font-size: 15px; color: #5b6068; font-weight: 700; border-bottom: 1px solid rgba(30,58,91,.18); padding: 0 0 5px; min-height: 22px; }
    .li-theme-col .theme-bar-header em, .li-theme-col .theme-bar-header span { font-weight: 700; }
    .li-theme-col .theme-bar-row span { font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .li-theme-col .theme-bar-row em { font-style: normal; text-align: right; font-size: 16px; font-weight: 700; }
    .li-theme-col .theme-bar-placeholder { color: rgba(29,34,39,.30); }
    .li-theme-col .theme-bar-placeholder span, .li-theme-col .theme-bar-placeholder em { font-weight: 500; }
    .li-theme-col .bar-track { position: relative; display: flex; align-items: center; min-width: 0; height: 16px; column-gap: 6px; }
    .li-theme-col .bar-track::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); height: 10px; background: rgba(30,58,91,.12); border-radius: 999px; pointer-events: none; }
    .li-theme-col .bar-track b { position: relative; display: block; flex: 0 1 var(--bar-width, 0%); height: 10px; min-width: 14px; border-radius: 999px; z-index: 1; box-shadow: inset 0 1px 0 rgba(255,255,255,.32), inset 0 -1px 1px rgba(0,0,0,.10); }
    .li-theme-col .bar-track u { position: relative; flex: 0 0 auto; font-style: normal; font-size: 13px; font-weight: 800; text-decoration: none; white-space: nowrap; line-height: 1; z-index: 2; }
    .li-theme-col .theme-bar-row.bullish .bar-track b { background: linear-gradient(90deg, #ee5b50, #d6211d); }
    .li-theme-col .theme-bar-row.bearish .bar-track b { background: linear-gradient(90deg, #0a8a68, #21bd8c); }
    .li-theme-col .theme-bar-row.bullish .bar-track u { color: #d6211d; }
    .li-theme-col .theme-bar-row.bearish .bar-track u { color: #0a8a68; }
    .li-theme-col .theme-bar-placeholder .bar-track::before { background: rgba(30,58,91,.06); }
    .li-theme-col .theme-bar-placeholder .bar-track b { background: rgba(30,58,91,.10) !important; box-shadow: none; }
    .li-theme-col .theme-bar-placeholder .bar-track u { color: rgba(29,34,39,.30); }
    .li-theme-col .theme-empty { color: #98a0a6; font-size: 14px; padding: 12px 0; text-align: center; font-style: italic; }
    .li-deep-panel { left: 34px; right: 34px; top: 924px; height: 416px; padding: 0; overflow: hidden; }
    .li-deep-panel .theme-deep-dive { position: absolute; inset: 18px 22px; }
    .li-deep-panel .theme-deep-dive .deep-dive-header h2 { color: #1a3050; font-size: 26px; margin: 0; }
    .li-deep-panel .theme-deep-dive .deep-dive-header span { color: #5b6068; font-size: 15px; }
    .li-deep-panel .deep-dive-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; height: 100%; }
    .li-deep-panel .theme-deep-dive.single .deep-dive-grid { grid-template-columns: 1fr; }
    .li-deep-panel .deep-dive-card { padding: 14px 16px; border: 1px solid rgba(30,58,91,.34); background: rgba(255,255,255,.46); border-radius: 6px; overflow: hidden; min-height: 0; display: flex; flex-direction: column; }
    .li-deep-panel .deep-dive-card.bullish { border-color: rgba(216,33,29,.40); }
    .li-deep-panel .deep-dive-card.bearish { border-color: rgba(10,140,104,.40); }
    .li-deep-panel .deep-dive-card h2 { color: #1a3050; font-size: 20px; margin: 0 0 10px; }
    .li-deep-panel .deep-dive-items { display: grid; gap: 8px; min-height: 0; flex: 1; align-content: start; }
    .li-deep-panel .deep-dive-item { padding: 12px 14px; border: 1px solid rgba(30,58,91,.20); background: rgba(255,255,255,.62); border-radius: 5px; overflow: hidden; display: flex; flex-direction: column; gap: 8px; }
    .li-deep-panel .deep-dive-title { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
    .li-deep-panel .deep-dive-title h3 { color: #1a3050; font-size: 20px; font-weight: 800; margin: 0; }
    .li-deep-panel .deep-dive-card.bullish .deep-dive-title h3 { color: #d6211d; }
    .li-deep-panel .deep-dive-card.bearish .deep-dive-title h3 { color: #0a8a68; }
    .li-deep-panel .deep-dive-stage { background: rgba(176,116,42,.18); color: #a0742d; padding: 3px 10px; font-size: 14px; border-radius: 999px; }
    .li-deep-panel .deep-dive-analysis { color: #2a2f37; font-size: 15px; line-height: 1.55; text-align: justify; margin: 0; }
    .li-deep-panel .deep-dive-judgment, .li-deep-panel .deep-dive-narrative { color: #2a2f37; font-size: 15px; line-height: 1.5; margin: 4px 0; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; }
    .li-deep-panel .deep-dive-judgment b, .li-deep-panel .deep-dive-narrative b { color: #1a3050; }
    .li-deep-panel .deep-dive-signals { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 6px; }
    .li-deep-panel .deep-dive-signal { display: flex; gap: 4px; padding: 6px 8px; border-radius: 4px; background: rgba(255,255,255,.62); color: #2a2f37; font-size: 14px; line-height: 1.35; }
    .li-deep-panel .deep-dive-signal b { color: #1a3050; }
    .li-deep-panel .deep-dive-signal.bullish { border-left: 2px solid #d8211d; }
    .li-deep-panel .deep-dive-signal.bearish { border-left: 2px solid #0c9c75; }
    .li-deep-panel .deep-dive-compact-signals { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; color: #2a2f37; font-size: 14px; }
    .li-deep-panel .deep-dive-compact-signals b { color: #1a3050; }
    .li-deep-panel .deep-dive-item.compact .deep-dive-judgment { -webkit-line-clamp: 1; line-clamp: 1; }
    .li-deep-panel .deep-dive-item.compact .deep-dive-narrative { -webkit-line-clamp: 1; line-clamp: 1; }

    .li-page4 .li-hero { padding-top: 22px; padding-left: 84px; }
    .li-page4 .li-hero h1 { font-size: 62px; margin: 0; }
    .li-page4-meta { display: flex; align-items: center; gap: 18px; margin-top: 20px; color: #31343a; font-size: 21px; letter-spacing: 4px; }
    .li-page4-meta i { display: block; width: 60px; height: 6px; background: #d8211d; }
    .li-ladder-head { left: 34px; right: 34px; top: 250px; height: 200px; padding: 18px 22px; }
    .li-ladder-metrics { display: grid; grid-template-columns: 1fr 1fr 1.25fr; gap: 18px; height: calc(100% - 50px); }
    .li-ladder-card { padding: 18px 22px; border: 1px solid rgba(30,58,91,.34); border-radius: 8px; background: rgba(255,255,255,.46); text-align: center; display: flex; flex-direction: column; justify-content: center; gap: 6px; min-height: 142px; }
    .li-ladder-card span { color: #5b6068; font-size: 18px; }
    .li-ladder-card strong { color: #1a3050; font-size: 44px; line-height: 1.1; font-weight: 900; letter-spacing: 1px; }
    .li-ladder-card em { font-size: 18px; font-style: normal; color: #5b6068; }
    .li-ladder-card-featured { position: relative; border: 1.5px solid #b08340; background: linear-gradient(180deg, rgba(255,255,255,.78), rgba(255,255,255,.46)); box-shadow: 0 6px 18px rgba(176,131,64,.18), inset 0 0 0 1px rgba(255,255,255,.5); }
    .li-ladder-card-featured::before, .li-ladder-card-featured::after { content: ""; position: absolute; left: 18px; right: 18px; height: 1px; background: linear-gradient(90deg, transparent, #b08340 50%, transparent); }
    .li-ladder-card-featured::before { top: 8px; }
    .li-ladder-card-featured::after { bottom: 8px; }
    .li-ladder-card-featured span { color: #b08340; font-size: 16px; letter-spacing: 4px; }
    .li-ladder-card-featured strong { color: #1a3050; font-size: 40px; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
    .li-ladder-strip { left: 34px; right: 34px; top: 460px; height: 300px; padding: 18px 22px; overflow: hidden; }
    .li-ladder-rows { display: grid; gap: 8px; }
    .li-ladder-row { display: grid; grid-template-columns: 80px 1fr; align-items: center; min-height: 54px; padding: 0 14px; border-radius: 6px; background: linear-gradient(90deg, rgba(176,116,42,.10), rgba(255,255,255,.42)); border: 1px solid rgba(30,58,91,.16); }
    .li-ladder-row b { color: #a0742d; font-size: 26px; font-weight: 900; }
    .li-ladder-row span { color: #1d2227; font-size: 20px; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .li-ladder-row span em { color: #5b6068; font-style: normal; margin-left: 8px; font-size: 17px; }
    .li-roles-panel { left: 34px; right: 34px; top: 750px; height: 420px; padding: 18px 22px; }
    .li-roles-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; height: calc(100% - 50px); align-items: stretch; }
    .role-card { padding: 14px 14px; border: 1px solid rgba(30,58,91,.34); border-radius: 8px; background: rgba(255,255,255,.46); display: flex; flex-direction: column; justify-content: center; }
    .role-card h2 { margin: 0 0 10px; color: #1a3050; font-size: 20px; font-weight: 800; }
    .role-card.bullish { border-color: rgba(216,33,29,.40); }
    .role-card.warning { border-color: rgba(216,138,30,.40); }
    .role-card.bearish { border-color: rgba(10,140,104,.40); }
    .leader-row { display: flex; align-items: center; gap: 6px; margin: 6px 0; font-size: 17px; color: #1d2227; }
    .leader-row b { color: #1a3050; font-weight: 700; }
    .leader-row em { color: #5b6068; font-style: normal; font-size: 15px; }
    .li-watch-panel { left: 34px; right: 34px; top: 1180px; height: 200px; padding: 18px 22px; }
    .li-watch-panel h2 { display: flex; align-items: center; gap: 8px; }
    .li-watch-panel h2::before { content: ""; display: inline-block; width: 5px; height: 24px; background: #d8211d; border-radius: 2px; }
    .li-watch-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; height: calc(100% - 50px); align-items: stretch; }
    .li-watch-grid > div { padding: 14px 18px; border: 1px solid rgba(30,58,91,.28); border-radius: 6px; background: rgba(255,255,255,.62); overflow: hidden; display: flex; flex-direction: column; gap: 6px; }
    .li-watch-grid > div.bullish { border-color: rgba(216,33,29,.38); }
    .li-watch-grid > div.warning { border-color: rgba(176,116,42,.38); }
    .li-watch-grid > div.bearish { border-color: rgba(10,140,104,.38); }
    .li-watch-grid b { display: flex; align-items: center; gap: 10px; color: #1a3050; font-size: 22px; font-weight: 900; letter-spacing: 1px; }
    .li-watch-grid b i { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 4px; background: rgba(30,58,91,.10); color: #1a3050; font-size: 14px; font-style: normal; font-weight: 900; font-family: "Times New Roman", SimSun, serif; }
    .li-watch-grid > div.bullish b i { background: rgba(216,33,29,.14); color: #b21916; }
    .li-watch-grid > div.warning b i { background: rgba(176,116,42,.16); color: #8a5d22; }
    .li-watch-grid > div.bearish b i { background: rgba(10,140,104,.14); color: #0a6e54; }
    .li-watch-grid p { margin: 0; color: #2a2f37; font-size: 15px; line-height: 1.5; }

    .bullish { color: #d8211d !important; }
    .bearish { color: #0a8c68 !important; }
    .bullish-bg { background: linear-gradient(90deg,#ee5b50 0%,#d6211d 45%,#a31612 100%); }
    .bearish-bg { background: linear-gradient(90deg,#0a8a68 0%,#21bd8c 55%,#52d4a3 100%); }

    /* dial */
    .sentiment-dial { display: grid; grid-template-columns: 200px 1fr; align-items: center; gap: 16px; }
    .dial-ring {
      position: relative;
      width: 200px;
      height: 200px;
      border-radius: 50%;
      background: conic-gradient(currentColor var(--dial-dash, 0), rgba(35,47,60,.10) 0);
      display: grid;
      place-items: center;
      color: #d8211d;
    }
    .dial-ring::after { content: ""; position: absolute; inset: 12px; border-radius: 50%; background: rgba(255,255,255,.94); border: 1px solid rgba(30,58,91,.32); }
    .dial-ring.bullish { color: #d8211d; }
    .dial-ring.bullish-soft { color: #c48014; }
    .dial-ring.warning { color: #c48014; }
    .dial-ring.warning-soft { color: #0a8c68; }
    .dial-ring.bearish { color: #0a8c68; }
    .dial-value { position: relative; z-index: 1; color: #152b49; font-size: 60px; font-weight: 900; }
    .dial-state { position: absolute; bottom: 38px; left: 0; right: 0; text-align: center; color: #d8211d; font-size: 16px; z-index: 1; }
    .dial-foot { position: absolute; bottom: 16px; left: 0; right: 0; text-align: center; color: #5b6068; font-size: 14px; z-index: 1; }
    .dial-bands { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 12px; }
    .band { padding: 6px 10px; border-radius: 6px; background: rgba(30,58,91,.06); color: #2a2f37; font-size: 13px; }
  `;
}

function lightInstitutionalScript() {
  return `
    <script>
      (function () {
        const seedProfiles = {
          upA: [.70,.61,.67,.59,.73,.55,.62,.50,.68,.72,.63,.48,.42,.55,.60,.46,.65,.71,.58,.74,.62,.69,.56,.66,.72,.61,.49,.38,.45,.33,.42,.30,.37,.25,.35,.22,.29,.18,.25,.14,.19],
          upB: [.64,.55,.61,.47,.42,.57,.63,.46,.36,.44,.54,.60,.45,.32,.38,.50,.40,.27,.34,.46,.36,.25,.18,.31,.23,.15,.26,.12,.22,.10,.18,.08,.16,.06,.14,.08,.12,.05,.10,.07,.09],
          downA: [.34,.25,.36,.29,.45,.37,.53,.43,.57,.48,.52,.40,.49,.44,.56,.47,.60,.69,.55,.64,.75,.67,.80,.71,.84,.76,.88,.79,.86,.82,.90,.81,.87,.78,.91,.83,.93,.84,.90,.82,.92],
          downB: [.45,.34,.42,.30,.50,.39,.58,.46,.62,.51,.68,.54,.61,.49,.57,.66,.59,.73,.64,.78,.69,.82,.72,.86,.77,.91,.80,.88,.74,.93,.82,.90,.78,.94,.84,.92,.80,.95,.86,.91,.83]
        };
        for (const canvas of document.querySelectorAll('.li-spark')) {
          const ctx = canvas.getContext('2d');
          const seed = String(canvas.dataset.seed || 'li');
          const bearish = canvas.dataset.bearish === '1';
          const pct = Number(canvas.dataset.pct || 0);
          const rect = canvas.getBoundingClientRect();
          const dpr = Math.max(1, window.devicePixelRatio || 1);
          const width = Math.max(160, rect.width || 190);
          const height = Math.max(42, rect.height || 48);
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, width, height);
          let hash = 2166136261;
          for (let i = 0; i < seed.length; i += 1) {
            hash ^= seed.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
          }
          const rand = () => {
            hash ^= hash << 13;
            hash ^= hash >>> 17;
            hash ^= hash << 5;
            return ((hash >>> 0) % 10000) / 10000;
          };
          const match = seed.match(/^li-(\\d+)/);
          const index = match ? Number(match[1]) : 0;
          const strongMove = Math.abs(pct) >= 1 || index % 2 === 1;
          const profile = seedProfiles[bearish ? (strongMove ? 'downB' : 'downA') : (strongMove ? 'upB' : 'upA')];
          const step = width / (profile.length - 1);
          const pts = profile.map((value, i) => {
            const impulse = i % 5 === 0 ? (rand() - 0.5) * height * 0.14 : 0;
            const micro = (rand() - 0.5) * height * 0.085;
            const baseY = height * (0.08 + value * 0.68);
            const yVal = Math.max(height * 0.06, Math.min(height * 0.84, baseY + impulse + micro));
            return [i * step, Math.round(yVal * 10) / 10];
          });
          const grad = ctx.createLinearGradient(0, 0, 0, height);
          grad.addColorStop(0, bearish ? 'rgba(10,140,104,.20)' : 'rgba(216,33,29,.22)');
          grad.addColorStop(.58, bearish ? 'rgba(10,140,104,.09)' : 'rgba(216,33,29,.10)');
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.lineTo(pts[pts.length - 1][0], height + 2);
          ctx.lineTo(pts[0][0], height + 2);
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.strokeStyle = bearish ? '#0a8c68' : '#d8211d';
          ctx.lineWidth = 1.7;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.shadowColor = bearish ? 'rgba(10,140,104,.30)' : 'rgba(216,33,29,.32)';
          ctx.shadowBlur = 1.8;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      })();
    </script>
  `;
}

function renderLightInstitutionalHtml(data) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.report_date)} A股市场情绪日报</title>
<style>${lightInstitutionalCss()}</style>
</head>
<body>
<main id="report-root" data-report-date="${escapeHtml(data.report_date)}" data-theme="light-institutional-report">
${lightInstitutionalPage1(data)}
${lightInstitutionalPage2(data)}
${lightInstitutionalPage3(data)}
${lightInstitutionalPage4(data)}
</main>
${lightInstitutionalScript()}
</body>
</html>`;
}

// =====================================================================
// 3. 深色终端杂志风格 - 4 pages
// =====================================================================

function darkTerminalIcon(name) {
  if (name === 'market') return `<svg viewBox="0 0 56 56" aria-hidden="true"><path d="M8 45h39" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M10 38h7v7h-7zM19 33h7v12h-7zM28 28h7v17h-7zM37 24h7v21h-7z" fill="currentColor"/><path d="M8.5 29 19 19 28 25 43 10M43 10v10M43 10H33" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (name === 'coin') return `<svg viewBox="0 0 56 56" aria-hidden="true"><ellipse cx="28" cy="15" rx="17" ry="7" fill="none" stroke="currentColor" stroke-width="3"/><path d="M11 15v24c0 4 7.6 7 17 7s17-3 17-7V15M11 27c0 4 7.6 7 17 7s17-3 17-7M11 38c0 4 7.6 7 17 7s17-3 17-7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
  if (name === 'yuan') return `<svg viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="23.4" fill="none" stroke="currentColor" stroke-width="2.8"/><path d="M20.8 18.6 28 29.4l7.2-10.8M28 29.4v10.2M21.1 31.2h13.8M21.1 36.4h13.8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (name === 'chat') return `<svg viewBox="0 0 56 56" aria-hidden="true"><path d="M12 14h32v24H27l-10 8v-8h-5V14Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M20 23h15M20 30h10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
  if (name === 'clock') return `<svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="10" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M14 8v7l5 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (name === 'flame') return `<svg viewBox="0 0 48 58" aria-hidden="true"><path d="M29.6 2.8c1 10.7 12.1 15.6 12.1 31.1 0 12.8-8.8 22.2-22.1 22.2C8.2 56.1.8 48 .8 37.4c0-8.1 4.8-14.7 10.6-20.4-.3 6.5 2.2 10.4 7.3 11.2C20.6 17.4 23.8 9 29.6 2.8Z" fill="currentColor"/><path d="M23.1 52.2c-7.1 0-11.6-4.3-11.6-10.9 0-5.2 3.1-8.9 7-12.9.3 4.8 2.3 7.7 5.8 8.7 1.8-5.9 4.8-10.8 9.1-14.8 1.3 7.7 6.7 11.2 6.7 19 0 6.4-6.1 10.9-17 10.9Z" fill="#ff8a50"/></svg>`;
  if (name === 'eye') return `<svg viewBox="0 0 42 42" aria-hidden="true"><path d="M3 21C9 10 33 10 39 21 33 32 9 32 3 21Z" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linejoin="round"/><circle cx="21" cy="21" r="6" fill="currentColor"/><circle cx="22.5" cy="19.5" r="1.6" fill="#071018"/></svg>`;
  if (name === 'check') return `<svg viewBox="0 0 56 56" aria-hidden="true"><path d="M12 29 23 40 45 16" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (name === 'pulse') return `<svg viewBox="0 0 56 56" aria-hidden="true"><path d="M7 30h11l6-17 9 31 6-14h10" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (name === 'warning') return `<svg viewBox="0 0 56 56" aria-hidden="true"><path d="M28 7 51 48H5L28 7Z" fill="currentColor"/><path d="M28 20v13M28 41h.1" fill="none" stroke="#071018" stroke-width="5" stroke-linecap="round"/></svg>`;
  return '';
}

function darkTerminalFormatClose(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '--';
}

function darkTerminalIndexDelta(item) {
  return item.delta_text ?? item.change_text ?? '';
}

function darkTerminalSignalList(signals, key, fallback) {
  const own = signals?.[key] ?? signals?.[fallback] ?? [];
  return own.slice(0, 3);
}

function darkTerminalIndexCards(indices) {
  return (indices ?? []).slice(0, 4).map((item, index) => `
    <div class="dt-index-card">
      <span>${escapeHtml(item.name)}</span>
      <strong class="${marketClass(item.pct)}">${escapeHtml(darkTerminalFormatClose(item.close))}</strong>
      <em class="${marketClass(item.pct)}">${escapeHtml(darkTerminalIndexDelta(item))}　${escapeHtml(pctText(item.pct))}</em>
      <canvas class="dt-spark" width="172" height="40" data-seed="dt-${index}:${escapeHtml(item.name)}:${escapeHtml(String(item.pct ?? 0))}" data-pct="${escapeHtml(String(item.pct ?? 0))}" data-bearish="${Number(item.pct) < 0 ? '1' : '0'}"></canvas>
    </div>
  `).join('');
}

function darkTerminalMetricBox(label, value, sub, cls = 'bullish', compare = '') {
  return `<div class="dt-metric ${cls}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><em>${escapeHtml(sub)}</em>${compare}</div>`;
}

function darkTerminalThemeRows(items, options = {}) {
  const rows = (items ?? []).slice(0, options.limit ?? 7);
  return rows.map((item, index) => `
    <div class="dt-theme-row">
      <b>${index + 1}</b>
      <span>${escapeHtml(item.name)}</span>
      <em class="${options.negative ? 'bearish' : marketClass(item.pct)}">${escapeHtml(pctText(item.pct))}</em>
    </div>
  `).join('');
}

function darkTerminalSignalCard(kind, title, cls, items) {
  return `
    <div class="dt-signal-card ${cls}">
      <h3>${darkTerminalSignalIcon(kind)}<span>${escapeHtml(title)}</span></h3>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </div>
  `;
}

function darkTerminalPage1(data) {
  const indices = data.indices ?? [];
  const up = Number(data.breadth?.up ?? 0);
  const down = Number(data.breadth?.down ?? 0);
  const total = Math.max(up + down, 1);
  const upPct = clamp(Math.round((up / total) * 1000) / 10, 0, 100);
  const downPct = Math.round((100 - upPct) * 10) / 10;
  const state = data.emotion_model_v1?.state ?? '分歧震荡';
  const heroHeadline = data.market_summary?.headline ?? '';
  const heroSubtitle = data.market_summary?.style_shift ?? data.market_summary?.action ?? '';
  const capitalRows = [
    [data.capital_flow?.metric_name ?? '主力资金', data.capital_flow?.net_text ?? '--'],
    ['北向资金', data.capital_flow?.northbound_text ?? '--']
  ];
  return `
    <section class="poster dt-poster dt-page1" data-page="1" data-title="市场全景与资金流">
      <div class="dt-shell">
        <header class="dt-top">
          <div class="dt-badge">${darkTerminalIcon('market')}<div><b>情绪状态</b><span>${escapeHtml(state)}</span></div></div>
          <div class="dt-title">
            <h1>A股市场 · 情绪日报</h1>
            <p>${darkTerminalIcon('clock')}<span>${escapeHtml(lightChineseDate(data.report_date))}</span><i></i><span>${escapeHtml(data.weekday)}</span><i></i><span>收盘复盘</span></p>
          </div>
        </header>
        <section class="dt-red-banner">
          <strong>${escapeHtml(heroHeadline)}</strong>
          <span>${escapeHtml(heroSubtitle)}</span>
        </section>
        <section class="dt-panel dt-index-panel">
          <h2>主要指数</h2>
          <div class="dt-index-grid">${darkTerminalIndexCards(indices)}</div>
        </section>
        <section class="dt-panel dt-breadth-panel">
          <h2>市场宽度</h2>
          <div class="dt-breadth-count dt-up"><span>上涨家数</span><strong>${escapeHtml(up)}</strong><em>${upPct}%</em></div>
          <div class="dt-breadth-count dt-down"><span>下跌家数</span><strong>${escapeHtml(down)}</strong><em>${downPct}%</em></div>
          <div class="dt-breadth-bar"><i class="bullish-bg" style="width:${upPct}%"></i><i class="bearish-bg" style="width:${downPct}%"></i></div>
          <div class="dt-breadth-foot"><span>涨跌比　${escapeHtml(data.breadth?.ratio_text?.replace('涨跌比 ', '') ?? '--')}</span><span>${escapeHtml(data.breadth?.notable ?? '')}</span><span>涨停　<b class="bullish">${escapeHtml(data.limit_up?.limit_up ?? '--')}</b></span><span>跌停　<b class="bearish">${escapeHtml(data.limit_up?.limit_down ?? '--')}</b></span></div>
        </section>
        <section class="dt-panel dt-turnover-panel">
          <div class="dt-round cyan">${darkTerminalIcon('coin')}</div>
          <div><h2>两市成交</h2><strong>${escapeHtml(data.turnover?.amount_text ?? '--')}</strong><p>${escapeHtml(data.turnover?.change_text ?? '')}</p></div>
        </section>
        <section class="dt-panel dt-money-panel">
          <div class="dt-round gold">${darkTerminalIcon('yuan')}</div>
          <div>
            <h2>资金流向 <em>（全日）</em></h2>
            ${capitalRows.map(([label, value]) => `<p><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></p>`).join('')}
          </div>
        </section>
        <section class="dt-panel dt-view-panel">
          <div class="dt-round filled">${darkTerminalIcon('chat')}</div>
          <div>
            <h2>核心观点</h2>
            <p>${escapeHtml(data.market_summary?.action ?? '')}</p>
          </div>
        </section>
        <footer class="dt-footer">数据来源：公开市场数据　｜　仅供复盘，不构成投资建议</footer>
      </div>
    </section>
  `;
}

function darkTerminalPage2(data) {
  const bullish = darkTerminalSignalList(data.next_session_signals, '确认信号', '多头信号');
  const bearish = darkTerminalSignalList(data.next_session_signals, '风险信号', '空头信号');
  return `
    <section class="poster dt-poster dt-page2" data-page="2" data-title="短线情绪周期">
      <div class="dt-shell">
        <header class="dt-p2-head">
          <h1><span>短线情绪</span> · 周期诊断</h1>
          <p>${darkTerminalIcon('clock')}<span>${escapeHtml(lightChineseDate(data.report_date))}</span><i></i><span>${escapeHtml(data.weekday)}</span><i></i><span>情绪模型 v1</span></p>
        </header>
        <section class="dt-panel dt-dial-panel">
          <h2>情绪分 / 状态</h2>
          <div class="dt-dial-wrap">
            ${sentimentDial(data.emotion_model_v1?.score ?? 0, data.emotion_model_v1?.state ?? '--')}
          </div>
        </section>
        <section class="dt-panel dt-factor-panel">
          <h2>10 项情绪因子</h2>
          <div class="dt-factor-grid">
            ${factorItems(data.emotion_model_v1?.factors ?? [], 10)}
          </div>
        </section>
        <section class="dt-panel dt-signal-panel">
          <h2>${darkTerminalIcon('eye')}<span>次日观察信号</span><em>（重点观察）</em></h2>
          <div class="dt-signal-grid">
            ${darkTerminalSignalCard('check', '多头信号', 'bullish', bullish)}
            ${darkTerminalSignalCard('warning', '空头信号', 'bearish', bearish)}
          </div>
        </section>
        <footer class="dt-footer">数据来源：公开市场数据　｜　仅供复盘，不构成投资建议</footer>
      </div>
    </section>
  `;
}

function darkTerminalPage3(data) {
  const conceptCounts = (data.themes?.concept_counts ?? []).slice(0, 12);
  const interpretation = data.theme_interpretation ?? {};
  const sections = themeDeepDiveSections(interpretation);
  return `
    <section class="poster dt-poster dt-page3" data-page="3" data-title="涨停与主线复盘">
      <div class="dt-shell">
        <header class="dt-p2-head">
          <h1><span>涨停复盘</span> · 主线结构</h1>
          <p>${darkTerminalIcon('clock')}<span>${escapeHtml(lightChineseDate(data.report_date))}</span><i></i><span>${escapeHtml(data.weekday)}</span><i></i><span>涨停梯队</span></p>
        </header>
        <section class="dt-panel dt-limit-panel">
          <h2>涨跌停与封板结构</h2>
          <div class="dt-metrics">
            ${darkTerminalMetricBox('涨停家数', String(data.limit_up?.limit_up ?? '--'), data.limit_up?.display口径 ?? '', 'bullish', metricCompare(data.limit_up?.limit_up, data.limit_up?.previous_day?.limit_up, '只', { favorableIncrease: true }))}
            ${darkTerminalMetricBox('跌停家数', String(data.limit_up?.limit_down ?? '--'), '', 'bearish', metricCompare(data.limit_up?.limit_down, data.limit_up?.previous_day?.limit_down, '只', { favorableIncrease: false }))}
            ${darkTerminalMetricBox('封板率', `${data.limit_up?.seal_rate_pct ?? '--'}%`, `炸板${data.limit_up?.broken_board ?? '--'}只`, 'bullish', metricCompare(data.limit_up?.seal_rate_pct, data.limit_up?.previous_day?.seal_rate_pct, '%', { deltaUnit: 'pct', previousUnit: '%', favorableIncrease: true }))}
            ${darkTerminalMetricBox('连板高度', `${data.ladder?.highest_non_st_board ?? '--'}连板`, data.ladder?.boards?.[0]?.stocks?.[0]?.name ?? '', 'bullish')}
          </div>
          <div class="dt-limit-foot">
            <span>展示口径　${escapeHtml(data.limit_up?.display口径 ?? '非ST短线口径')}</span>
            <span>${escapeHtml(data.limit_up?.full_market?.['口径'] ?? '全口径')}: 涨停 ${escapeHtml(data.limit_up?.full_market?.limit_up ?? '--')} / 跌停 ${escapeHtml(data.limit_up?.full_market?.limit_down ?? '--')}</span>
          </div>
        </section>
        <section class="dt-panel dt-theme-panel">
          <div class="dt-theme-grid">
            <div class="dt-theme-col dt-theme-col-gainers">
              <h3>领涨TOP <em>涨幅口径</em></h3>
              ${topGainersThemeBars(conceptCounts, 5)}
            </div>
            <div class="dt-theme-col dt-theme-col-losers">
              <h3>领跌TOP <em>跌幅口径</em></h3>
              ${topLosersThemeBars(conceptCounts, 5)}
            </div>
          </div>
        </section>
        <section class="dt-panel dt-deep-panel">
          ${renderThemeDeepDiveMarkup(sections)}
        </section>
        <footer class="dt-footer">数据来源：公开市场数据　｜　仅供复盘，不构成投资建议</footer>
      </div>
    </section>
  `;
}

function darkTerminalPage4(data) {
  const boards = ladderBoardsSorted(data);
  const topBoards = boards.slice(0, 4);
  const roles = data.leader_roles ?? {};
  const roleKeys = ['空间龙', '板块龙头', '容量中军', '核心助攻', '中位接力', '补涨前排', '首板前排', '风险负反馈'];
  return `
    <section class="poster dt-poster dt-page4" data-page="4" data-title="强势板块龙头梯队">
      <div class="dt-shell">
        <header class="dt-p2-head">
          <h1><span>龙头梯队</span> · 强势板块</h1>
          <p>${darkTerminalIcon('clock')}<span>${escapeHtml(lightChineseDate(data.report_date))}</span><i></i><span>${escapeHtml(data.weekday)}</span><i></i><span>连板梯队 / 角色映射</span></p>
        </header>
        <section class="dt-panel dt-ladder-head">
          <h2>梯队关键指标</h2>
          <div class="dt-ladder-metrics">
            <div class="dt-ladder-card">
              <span>非ST空间高度</span>
              <strong>${escapeHtml(highestLadderText(data))}<em>板</em></strong>
              ${metricCompare(highestLadderNumber(data), data.ladder?.previous_day?.highest_non_st_board, '板', { favorableIncrease: true })}
            </div>
            <div class="dt-ladder-card">
              <span>连板总数</span>
              <strong>${escapeHtml(consecutiveBoardCount(data))}<em>只</em></strong>
              ${metricCompare(consecutiveBoardCount(data), data.ladder?.previous_day?.consecutive_board_total, '只', { favorableIncrease: true })}
            </div>
            <div class="dt-ladder-card dt-ladder-card-featured">
              <span>高度核心</span>
              <strong>${escapeHtml(highestLadderStockText(data, 1))}</strong>
            </div>
          </div>
        </section>
        <section class="dt-panel dt-ladder-strip">
          <h2>连板梯队</h2>
          <div class="dt-ladder-rows">
            ${topBoards.map((row) => `
              <div class="dt-ladder-row">
                <b>${escapeHtml(row.board)}板</b>
                <span>${(row.stocks ?? []).slice(0, 4).map((s) => `${escapeHtml(s.name)}<em>${escapeHtml(s.theme ?? '')}</em>`).join(' / ')}</span>
              </div>
            `).join('')}
          </div>
        </section>
        <section class="dt-panel dt-roles-panel">
          <h2>角色映射</h2>
          <div class="dt-roles-grid">
            ${roleKeys.map((role) => rolePanel(role, roleItemsForRole(roles, role, 2), 2)).join('')}
          </div>
        </section>
        <section class="dt-panel dt-watch-panel">
          <h2>${darkTerminalIcon('eye')}<span>次日梯队判断</span><em>（验证路径）</em></h2>
          <div class="dt-watch-grid">
            ${darkTerminalSignalCard('check', '确认', 'confirm', (data.next_session_signals?.['确认信号'] ?? []).slice(0, 2))}
            ${darkTerminalSignalCard('pulse', '弱化', 'weaken', (data.next_session_signals?.['弱化信号'] ?? []).slice(0, 2))}
            ${darkTerminalSignalCard('warning', '风险', 'risk', (data.next_session_signals?.['风险信号'] ?? []).slice(0, 2))}
          </div>
        </section>
        <footer class="dt-footer">数据来源：公开市场数据　｜　仅供复盘，不构成投资建议</footer>
      </div>
    </section>
  `;
}

function darkTerminalCss() {
  return `
    * { box-sizing: border-box; }
    body { margin: 0; background: #080b0d; font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; }
    #report-root { display: flex; align-items: flex-start; gap: 0; background: #080b0d; }
    .dt-poster {
      width: 1080px;
      height: 1440px;
      flex: 0 0 1080px;
      position: relative;
      overflow: hidden;
      color: #edf4f2;
      background:
        radial-gradient(circle at 16% 2%, rgba(51,167,229,.18), transparent 30%),
        radial-gradient(circle at 62% 22%, rgba(255,75,69,.13), transparent 28%),
        linear-gradient(135deg, #071018 0%, #0b1821 46%, #05080b 100%);
    }
    .dt-poster::before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at 18% 10%, rgba(86,188,232,.14), transparent 28%),
        linear-gradient(180deg, rgba(255,255,255,.04), transparent 22%);
      opacity: .8;
      pointer-events: none;
    }
    .dt-poster::after {
      content: "";
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse at 50% 45%, transparent 45%, rgba(0,0,0,.38) 100%);
      pointer-events: none;
    }
    .dt-shell {
      position: absolute;
      inset: 14px;
      border: 1.5px solid rgba(132,165,184,.62);
      border-radius: 7px;
      background: linear-gradient(135deg, rgba(6,15,22,.62), rgba(8,20,28,.36));
      box-shadow: inset 0 0 80px rgba(20,126,176,.10), 0 0 26px rgba(0,0,0,.30);
      z-index: 1;
    }
    .dt-panel {
      position: absolute;
      border: 1px solid rgba(112,142,166,.62);
      border-radius: 6px;
      background: linear-gradient(145deg, rgba(13,29,40,.88), rgba(8,18,26,.82));
      box-shadow: inset 0 0 36px rgba(27,124,176,.08);
      overflow: hidden;
    }
    .dt-page1 .dt-panel { border: 1px solid #6c5326; }
    .dt-panel h2 { margin: 0; color: #f5cd6b; font-size: 30px; line-height: 1; font-weight: 900; }
    .dt-top { position: absolute; left: 16px; right: 16px; top: 28px; height: 138px; display: flex; align-items: flex-start; }
    .dt-badge { width: 240px; height: 100px; border: 1px solid rgba(255,74,68,.72); border-radius: 6px; background: linear-gradient(135deg, rgba(147,34,29,.66), rgba(25,20,22,.82)); display: grid; grid-template-columns: 76px 1fr; align-items: center; color: #ff5763; }
    .dt-badge svg { width: 62px; height: 62px; margin-left: 12px; }
    .dt-badge b { display: block; color: #f7e1b8; font-size: 25px; line-height: 1; }
    .dt-badge span { display: block; margin-top: 8px; color: #ff5763; font-size: 26px; font-weight: 900; }
    .dt-title { margin-left: 38px; }
    .dt-title h1, .dt-p2-head h1 { margin: 0; color: #efe1c2; font-size: 72px; line-height: 1.02; font-family: "Microsoft YaHei", "PingFang SC", "Heiti SC", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif; font-weight: 900; }
    .dt-title p, .dt-p2-head p { display: flex; align-items: center; gap: 15px; margin: 12px 0 0; color: #b9bec0; font-size: 22px; }
    .dt-title svg, .dt-p2-head svg { width: 23px; height: 23px; color: #f4bc51; }
    .dt-title i, .dt-p2-head i { display: block; width: 1px; height: 20px; background: rgba(184,190,194,.72); }
    .dt-red-banner { position: absolute; left: 16px; right: 16px; top: 190px; min-height: 150px; border: 1px solid rgba(255,74,68,.66); border-radius: 6px; background: linear-gradient(135deg, rgba(132,27,25,.74), rgba(59,17,17,.74)); text-align: center; overflow: hidden; display: flex; flex-direction: column; justify-content: center; align-items: stretch; padding: 22px 28px; gap: 10px; }
    .dt-red-banner::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 220px; background: linear-gradient(110deg, rgba(255,70,62,.22), rgba(255,70,62,.05) 46%, transparent 78%); opacity: .8; pointer-events: none; }
    .dt-red-banner strong { position: relative; display: block; color: #f2e9da; font-size: 44px; line-height: 1.05; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dt-red-banner span { position: relative; display: block; color: #e9d9ca; font-size: 24px; line-height: 1.32; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
    .dt-index-panel { left: 16px; right: 16px; top: 356px; height: 276px; padding: 22px 16px; }
    .dt-index-panel > h2, .dt-breadth-panel > h2 { color: #efe9dd; }
    .dt-index-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 16px; }
    .dt-index-card { position: relative; height: 196px; border: 1px solid rgba(132,160,178,.50); border-radius: 6px; background: linear-gradient(180deg, rgba(8,18,25,.78), rgba(10,23,30,.92)); padding: 20px 18px; overflow: hidden; }
    .dt-index-card span { display: block; text-align: center; color: #dfe5e0; font-size: 22px; }
    .dt-index-card strong { display: block; margin-top: 12px; text-align: center; font-size: 40px; line-height: 1; }
    .dt-index-card em { display: block; margin-top: 8px; text-align: center; font-size: 20px; line-height: 1; font-style: normal; }
    .dt-spark { position: absolute; left: 16px; right: 16px; bottom: 6px; width: calc(100% - 32px); height: 56px; }
    .dt-breadth-panel { left: 16px; right: 16px; top: 640px; height: 266px; padding: 23px 18px; }
    .dt-breadth-count { position: absolute; top: 78px; color: #f2efe9; }
    .dt-breadth-count span { display: block; font-size: 22px; color: #b58a3e; font-weight: 700; }
    .dt-down span { color: #5dc7f4; }
    .dt-breadth-count strong { display: inline-block; margin-top: 6px; font-size: 52px; line-height: .95; }
    .dt-breadth-count em { display: block; margin-top: 8px; font-size: 22px; font-style: normal; }
    .dt-up { left: 18px; }
    .dt-down { right: 18px; text-align: right; }
    .dt-up strong, .dt-up em { color: #ff5763; }
    .dt-down strong, .dt-down em { color: #3edf9a; }
    .dt-breadth-bar { position: absolute; left: 140px; right: 140px; top: 110px; height: 40px; display: flex; border-radius: 999px; overflow: hidden; background: rgba(255,255,255,.12); box-shadow: inset 0 2px 8px rgba(0,0,0,.42); }
    .dt-breadth-bar i:first-child { border-radius: 999px 0 0 999px; }
    .dt-breadth-bar i:nth-child(2) { border-radius: 0 999px 999px 0; }
    .dt-breadth-foot { position: absolute; left: 130px; right: 130px; bottom: 30px; display: grid; grid-template-columns: 1fr 1fr .7fr .7fr; color: #d3d8da; font-size: 22px; text-align: center; }
    .dt-breadth-foot span { border-right: 1px solid rgba(185,191,193,.34); }
    .dt-breadth-foot span:last-child { border-right: 0; }
    .dt-breadth-foot b { font-size: 24px; }
    .dt-turnover-panel { left: 16px; top: 914px; width: 472px; height: 218px; display: grid; grid-template-columns: 68px 1fr; gap: 20px; padding: 30px 22px; }
    .dt-money-panel { left: 493px; right: 16px; top: 914px; height: 218px; display: grid; grid-template-columns: 68px 1fr; gap: 20px; padding: 24px 22px; }
    .dt-round { width: 68px; height: 68px; border-radius: 50%; border: 1.5px solid currentColor; display: grid; place-items: center; }
    .dt-round svg { width: 46px; height: 46px; }
    .dt-round.cyan { color: #5dc7f4; }
    .dt-round.gold { color: #ffd075; border-color: transparent; }
    .dt-round.gold svg { width: 68px; height: 68px; }
    .dt-round.filled { color: #83d2ff; background: rgba(44,122,176,.28); border-color: #66c3f3; }
    .dt-turnover-panel h2, .dt-money-panel h2, .dt-view-panel h2 { color: #ffd075; font-size: 28px; }
    .dt-view-panel h2 { color: #4bbaff; }
    .dt-turnover-panel strong { display: block; margin-top: 14px; color: #ff5763; font-size: 64px; line-height: 1; }
    .dt-turnover-panel p { margin: 10px 0 0; color: #d3d8da; font-size: 22px; }
    .dt-turnover-panel p b, .dt-money-panel b { color: #ff5763; font-weight: 500; }
    .dt-money-panel h2 em { color: #d3d0c8; font-size: 22px; font-style: normal; font-weight: 400; }
    .dt-money-panel p { display: flex; justify-content: space-between; margin: 8px 0 0; padding-bottom: 4px; border-bottom: 1px solid rgba(185,191,193,.16); color: #d3d8da; font-size: 21px; }
    .dt-view-panel { left: 16px; right: 16px; top: 1142px; height: 230px; display: grid; grid-template-columns: 72px 1fr; gap: 16px; padding: 24px 22px; }
    .dt-view-panel p { margin: 6px 0 0; color: #dfe5e0; font-size: 22px; line-height: 1.4; }
    .dt-footer { position: absolute; left: 16px; right: 16px; bottom: 8px; color: #d3d8da; font-size: 18px; text-align: center; letter-spacing: 1px; }

    .dt-p2-head { position: absolute; left: 20px; right: 20px; top: 30px; height: 100px; text-align: center; }
    .dt-p2-head h1 { color: #f0e2ce; font-size: 68px; }
    .dt-p2-head h1 span { color: #bff3ff; }
    .dt-p2-head p { justify-content: center; margin-top: 10px; }
    .dt-dial-panel { left: 16px; right: 16px; top: 165px; height: 492px; padding: 22px 26px; }
    .dt-dial-wrap { display: grid; grid-template-columns: 320px 1fr; gap: 24px; align-items: center; height: calc(100% - 50px); }
    .dt-dial-note p { margin: 0; color: #d3d8da; font-size: 19px; line-height: 1.55; }
    .dt-factor-panel { left: 16px; right: 16px; top: 672px; height: 496px; padding: 22px 26px; }
    .dt-factor-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px 30px; margin-top: 16px; }
    .factor-row { display: grid; grid-template-rows: auto auto; gap: 6px; min-height: 38px; }
    .factor-row > div { display: flex; align-items: center; justify-content: space-between; color: #dfe5e0; font-size: 18px; }
    .factor-row b { color: #efe1c1; font-weight: 600; font-size: 18px; }
    .factor-row span { color: #9da3a3; font-size: 16px; }
    .factor-row .bar { display: block; height: 10px; background: rgba(255,255,255,.10); border-radius: 999px; overflow: hidden; }
    .factor-row .bar i { display: block; height: 100%; border-radius: 999px; }
    .factor-row.bullish .bar i { background: linear-gradient(90deg, #ff5763, #d73a3a); }
    .factor-row.warning .bar i { background: linear-gradient(90deg, #ffd075, #d49b45); }
    .factor-row.bearish .bar i { background: linear-gradient(90deg, #3edf9a, #0e7e58); }
    .dt-signal-panel { left: 16px; right: 16px; top: 1170px; height: 212px; padding: 20px 14px; overflow: hidden; }
    .dt-signal-panel h2 { display: flex; align-items: center; gap: 9px; font-size: 28px; }
    .dt-signal-panel h2 svg { width: 32px; height: 32px; color: #4bbaff; }
    .dt-signal-panel h2 em { color: #dfe5e0; font-style: normal; font-size: 22px; font-weight: 500; }
    .dt-signal-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 12px; }
    .dt-signal-card { height: 142px; border: 1px solid rgba(132,160,178,.48); border-radius: 6px; background: rgba(8,18,25,.58); padding: 12px 16px; overflow: hidden; }
    .dt-signal-card h3 { display: none; }
    .dt-signal-card ul { display: flex; flex-direction: column; flex-wrap: wrap; justify-content: center; gap: 3px 0; margin: 0; padding: 0; list-style: none; height: 100%; overflow: hidden; }
    .dt-signal-card li { position: relative; margin: 0; padding-left: 16px; color: #dfe5e0; font-size: 16px; line-height: 1.3; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dt-signal-card li::before { content: ""; position: absolute; left: 0; top: 4px; width: 9px; height: 9px; border-radius: 50%; background: currentColor; }
    .dt-signal-card.bullish h3, .dt-signal-card.bullish li::before { color: #5cd38b; }
    .dt-signal-card.bearish h3, .dt-signal-card.bearish li::before { color: #ff5b4e; }

    .dt-limit-panel { left: 16px; right: 16px; top: 165px; height: 380px; padding: 16px 22px; border: 1px solid #6c5326; overflow: hidden; }
    .dt-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 10px; }
    .dt-metric { height: 240px; border: 1px solid rgba(255,75,69,.56); border-radius: 6px; text-align: center; padding: 14px 12px 12px; background: linear-gradient(180deg, rgba(116,30,27,.78), rgba(62,18,17,.72)); overflow: hidden; }
    .dt-metric.bearish { border-color: rgba(54,215,141,.56); background: linear-gradient(180deg, rgba(13,86,64,.86), rgba(10,50,43,.78)); }
    .dt-metric.gold { border-color: rgba(244,193,93,.56); background: linear-gradient(180deg, rgba(82,57,18,.86), rgba(50,38,12,.78)); }
    .dt-metric span { display: block; color: #efe5d7; font-size: 22px; }
    .dt-metric strong { display: block; margin-top: 10px; color: #ff5763; font-size: 54px; line-height: 1; font-weight: 900; text-shadow: 0 2px 0 rgba(0,0,0,.38); }
    .dt-metric.bearish strong { color: #3edf9a; }
    .dt-metric.gold strong { color: #ffd075; }
    .dt-metric em { display: block; margin-top: 6px; color: #e1d8c8; font-size: 16px; font-style: normal; }
    .dt-metric .metric-compare, .dt-ladder-card .metric-compare { margin-top: 6px; padding: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; max-width: 100%; color: #dfe5e0; background: transparent; font-size: 15px; font-weight: 600; line-height: 1.25; }
    .dt-metric .metric-compare.bullish, .dt-ladder-card .metric-compare.bullish { color: #ff8a8e; background: transparent; }
    .dt-metric .metric-compare.bearish, .dt-ladder-card .metric-compare.bearish { color: #6ee0a8; background: transparent; }
    .dt-metric .metric-compare.warning, .dt-ladder-card .metric-compare.warning { color: #f5cd6b; background: transparent; }
    .dt-limit-foot { display: flex; justify-content: space-between; margin-top: 12px; color: #9da3a3; font-size: 16px; }
    .dt-theme-panel { left: 16px; right: 16px; top: 561px; height: 360px; padding: 20px 22px; border: 1px solid #6c5326; overflow: hidden; }
    .dt-theme-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 24px; height: calc(100% - 50px); align-items: stretch; }
    .dt-theme-col { display: flex; flex-direction: column; min-height: 0; }
    .dt-theme-col h3 { margin: 0 0 8px; color: #f5cd6b; font-size: 22px; font-weight: 900; }
    .dt-theme-col h3 em { font-style: normal; color: #9da3a3; font-size: 17px; margin-left: 8px; font-weight: 600; }
    /* 题材领涨/领跌：固定 5 行布局（1 行 header + 5 行数据），行号对齐 */
    .dt-theme-col .theme-bars { display: grid; grid-template-rows: auto repeat(5, 1fr); gap: 6px; flex: 1; min-height: 0; }
    .dt-theme-col .theme-bar-row { display: grid; align-items: center; gap: 8px; font-size: 17px; color: #e9e2cf; min-height: 0; line-height: 1.15; }
    .dt-theme-col .theme-bars.gainers .theme-bar-row { grid-template-columns: 100px 1fr 56px; }
    .dt-theme-col .theme-bars.losers .theme-bar-row { grid-template-columns: 100px 1fr; }
    .dt-theme-col .theme-bar-header { font-size: 15px; color: #c9b88c; font-weight: 700; border-bottom: 1px solid rgba(108,83,38,.5); padding: 0 0 5px; min-height: 22px; }
    .dt-theme-col .theme-bar-header em, .dt-theme-col .theme-bar-header span { font-weight: 700; }
    .dt-theme-col .theme-bar-row span { font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dt-theme-col .theme-bar-row em { font-style: normal; text-align: right; font-size: 17px; font-weight: 700; }
    .dt-theme-col .theme-bar-placeholder { color: rgba(233,226,207,.30); }
    .dt-theme-col .theme-bar-placeholder span, .dt-theme-col .theme-bar-placeholder em { font-weight: 500; }
    .dt-theme-col .bar-track { position: relative; display: flex; align-items: center; min-width: 0; height: 16px; column-gap: 6px; }
    .dt-theme-col .bar-track::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); height: 10px; background: rgba(108,83,38,.40); border-radius: 999px; pointer-events: none; }
    .dt-theme-col .bar-track b { position: relative; display: block; flex: 0 1 var(--bar-width, 0%); height: 10px; min-width: 14px; border-radius: 999px; z-index: 1; box-shadow: inset 0 1px 0 rgba(255,255,255,.32), inset 0 -1px 1px rgba(0,0,0,.18); }
    .dt-theme-col .bar-track u { position: relative; flex: 0 0 auto; font-style: normal; font-size: 13px; font-weight: 800; text-decoration: none; white-space: nowrap; line-height: 1; z-index: 2; }
    .dt-theme-col .theme-bar-row.bullish .bar-track b { background: linear-gradient(90deg, #ff5750, #ff7844); }
    .dt-theme-col .theme-bar-row.bearish .bar-track b { background: linear-gradient(90deg, #1ab47b, #0e7e58); }
    .dt-theme-col .theme-bar-row.bullish .bar-track u { color: #ff8b76; }
    .dt-theme-col .theme-bar-row.bearish .bar-track u { color: #58d6a4; }
    .dt-theme-col .theme-bar-placeholder .bar-track::before { background: rgba(108,83,38,.22); }
    .dt-theme-col .theme-bar-placeholder .bar-track b { background: rgba(108,83,38,.34) !important; box-shadow: none; }
    .dt-theme-col .theme-bar-placeholder .bar-track u { color: rgba(233,226,207,.30); }
    .dt-theme-col .theme-empty { color: #8a8475; font-size: 14px; padding: 12px 0; text-align: center; font-style: italic; }
    .dt-deep-panel { left: 16px; right: 16px; top: 937px; height: 432px; padding: 0; border: 1px solid #6c5326; overflow: hidden; }
    .dt-deep-panel .theme-deep-dive { position: absolute; inset: 18px 22px; }
    .dt-deep-panel .theme-deep-dive .deep-dive-header h2 { color: #f5cd6b; font-size: 26px; margin: 0; }
    .dt-deep-panel .theme-deep-dive .deep-dive-header span { color: #9da3a3; font-size: 15px; }
    .dt-deep-panel .deep-dive-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; height: 100%; }
    .dt-deep-panel .theme-deep-dive.single .deep-dive-grid { grid-template-columns: 1fr; }
    .dt-deep-panel .deep-dive-card { padding: 14px 18px; border: 1px solid rgba(132,160,178,.46); background: rgba(8,18,25,.56); border-radius: 6px; overflow: hidden; min-height: 0; display: flex; flex-direction: column; }
    .dt-deep-panel .deep-dive-card.bullish { border-color: rgba(255,75,69,.46); }
    .dt-deep-panel .deep-dive-card.bearish { border-color: rgba(54,215,141,.46); }
    .dt-deep-panel .deep-dive-card h2 { color: #f5cd6b; font-size: 20px; margin: 0 0 8px; }
    .dt-deep-panel .deep-dive-items { display: grid; gap: 8px; min-height: 0; flex: 1; align-content: start; }
    .dt-deep-panel .deep-dive-item { padding: 12px 14px; border: 1px solid rgba(132,160,178,.24); background: rgba(0,0,0,.20); border-radius: 5px; overflow: hidden; display: flex; flex-direction: column; gap: 8px; }
    .dt-deep-panel .deep-dive-title { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
    .dt-deep-panel .deep-dive-title h3 { color: #f0e1c1; font-size: 20px; font-weight: 800; margin: 0; }
    .dt-deep-panel .deep-dive-card.bullish .deep-dive-title h3 { color: #ff8b76; }
    .dt-deep-panel .deep-dive-card.bearish .deep-dive-title h3 { color: #58d6a4; }
    .dt-deep-panel .deep-dive-stage { background: rgba(244,193,93,.18); color: #ffd075; padding: 3px 10px; font-size: 14px; border-radius: 999px; }
    .dt-deep-panel .deep-dive-analysis { color: #d3d8da; font-size: 15px; line-height: 1.55; text-align: justify; margin: 0; }
    .dt-deep-panel .deep-dive-judgment, .dt-deep-panel .deep-dive-narrative { color: #d3d8da; font-size: 15px; line-height: 1.5; margin: 4px 0; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; }
    .dt-deep-panel .deep-dive-judgment b, .dt-deep-panel .deep-dive-narrative b { color: #f0d49c; }
    .dt-deep-panel .deep-dive-signals { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 6px; }
    .dt-deep-panel .deep-dive-signal { display: flex; gap: 4px; padding: 6px 8px; border-radius: 4px; background: rgba(0,0,0,.20); color: #d3d8da; font-size: 14px; line-height: 1.35; }
    .dt-deep-panel .deep-dive-signal b { color: #f0d49c; }
    .dt-deep-panel .deep-dive-signal.bullish { border-left: 2px solid #ff5763; }
    .dt-deep-panel .deep-dive-signal.bearish { border-left: 2px solid #3edf9a; }
    .dt-deep-panel .deep-dive-compact-signals { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; color: #d3d8da; font-size: 14px; }
    .dt-deep-panel .deep-dive-compact-signals b { color: #f0d49c; }
    .dt-deep-panel .deep-dive-item.compact .deep-dive-judgment { -webkit-line-clamp: 1; line-clamp: 1; }
    .dt-deep-panel .deep-dive-item.compact .deep-dive-narrative { -webkit-line-clamp: 1; line-clamp: 1; }

    .dt-ladder-head { left: 16px; right: 16px; top: 150px; height: 220px; padding: 18px 22px; border: 1px solid #6c5326; }
    .dt-ladder-metrics { display: grid; grid-template-columns: 1fr 1fr 1.25fr; gap: 14px; height: calc(100% - 50px); }
    .dt-ladder-card { padding: 18px 22px; border: 1px solid rgba(202,144,69,.40); border-radius: 6px; background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.01)); text-align: center; display: flex; flex-direction: column; justify-content: center; gap: 6px; min-height: 142px; }
    .dt-ladder-card span { color: #c9b88c; font-size: 18px; }
    .dt-ladder-card strong { color: #f5cd6b; font-size: 44px; line-height: 1.1; font-weight: 900; letter-spacing: 1px; }
    .dt-ladder-card em { font-size: 18px; font-style: normal; color: #d6c7a4; }
    .dt-ladder-card-featured { position: relative; border: 1px solid #4bbaff; background: radial-gradient(circle at 50% 0%, rgba(75,186,255,.18), rgba(255,255,255,.02) 60%), linear-gradient(180deg, rgba(75,186,255,.08), rgba(8,18,25,.85)); box-shadow: inset 0 0 0 1px rgba(75,186,255,.18), 0 0 20px rgba(75,186,255,.18); }
    .dt-ladder-card-featured::before, .dt-ladder-card-featured::after { content: ""; position: absolute; left: 14px; right: 14px; height: 1px; background: linear-gradient(90deg, transparent, #4bbaff 50%, transparent); opacity: .65; }
    .dt-ladder-card-featured::before { top: 6px; }
    .dt-ladder-card-featured::after { bottom: 6px; }
    .dt-ladder-card-featured span { color: #bff3ff; font-size: 16px; letter-spacing: 4px; }
    .dt-ladder-card-featured strong { color: #e6f8ff; font-size: 40px; text-shadow: 0 0 16px rgba(75,186,255,.40); white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
    .dt-ladder-strip { left: 16px; right: 16px; top: 390px; height: 300px; padding: 18px 22px; border: 1px solid #6c5326; overflow: hidden; }
    .dt-ladder-rows { display: grid; gap: 8px; }
    .dt-ladder-row { display: grid; grid-template-columns: 80px 1fr; align-items: center; min-height: 54px; padding: 0 14px; border-radius: 6px; background: linear-gradient(90deg, rgba(220,177,108,.10), rgba(255,255,255,.02)); }
    .dt-ladder-row b { color: #f5cd6b; font-size: 26px; font-weight: 900; }
    .dt-ladder-row span { color: #e9e2cf; font-size: 19px; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dt-ladder-row span em { color: #c9b88c; font-style: normal; margin-left: 8px; font-size: 16px; }
    .dt-roles-panel { left: 16px; right: 16px; top: 720px; height: 360px; padding: 18px 22px; border: 1px solid #6c5326; }
    .dt-roles-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; height: calc(100% - 50px); align-items: stretch; }
    .role-card { padding: 14px 14px; border: 1px solid rgba(202,144,69,.45); border-radius: 8px; background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.01)); display: flex; flex-direction: column; justify-content: center; }
    .role-card h2 { margin: 0 0 10px; color: #f5cd6b; font-size: 20px; font-weight: 800; }
    .role-card.bullish { border-color: rgba(255,80,68,.40); }
    .role-card.warning { border-color: rgba(244,193,93,.40); }
    .role-card.bearish { border-color: rgba(54,215,141,.40); }
    .leader-row { display: flex; align-items: center; gap: 6px; margin: 6px 0; font-size: 17px; color: #e9e2cf; }
    .leader-row b { color: #f0e1c1; font-weight: 700; }
    .leader-row em { color: #d6c7a4; font-style: normal; font-size: 15px; }
    .dt-watch-panel { left: 16px; right: 16px; top: 1164px; height: 198px; padding: 18px 14px; border: 1px solid #6c5326; overflow: hidden; }
    .dt-watch-panel h2 { display: flex; align-items: center; gap: 9px; color: #dfe5e0; font-size: 28px; }
    .dt-watch-panel h2 svg { width: 30px; height: 30px; color: #4bbaff; }
    .dt-watch-panel h2 span { color: #dfe5e0; }
    .dt-watch-panel h2 em { color: #d3d8da; font-style: normal; font-size: 20px; font-weight: 500; }
    .dt-watch-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; height: calc(100% - 50px); }
    .dt-watch-panel .dt-signal-card { height: 100%; padding: 14px 18px; display: flex; flex-direction: column; }
    .dt-watch-panel .dt-signal-card h3 { display: flex; align-items: center; gap: 10px; margin: 0 0 8px; color: #dfe5e0; font-size: 24px; font-weight: 900; }
    .dt-watch-panel .dt-signal-card h3 svg { width: 28px; height: 28px; flex: 0 0 28px; }
    .dt-watch-panel .dt-signal-card ul { margin: 0; padding-left: 16px; flex: 1; }
    .dt-watch-panel .dt-signal-card li { font-size: 15px; line-height: 1.5; white-space: normal; overflow: visible; text-overflow: clip; margin-bottom: 4px; }
    .dt-watch-panel .dt-signal-card.confirm h3, .dt-watch-panel .dt-signal-card.confirm li::before { color: #5cd38b; }
    .dt-watch-panel .dt-signal-card.weaken h3, .dt-watch-panel .dt-signal-card.weaken li::before { color: #ffb742; }
    .dt-watch-panel .dt-signal-card.risk h3, .dt-watch-panel .dt-signal-card.risk li::before { color: #ff5b4e; }

    .bullish { color: #ff4b55 !important; }
    .bearish { color: #36d78d !important; }
    .bullish-bg { background: linear-gradient(90deg,#ff7068 0%,#f13436 45%,#b51b1b 100%); }
    .bearish-bg { background: linear-gradient(90deg,#0a6e4d 0%,#1ab47b 55%,#52d4a3 100%); }

    /* dial */
    .sentiment-dial { display: grid; grid-template-columns: 240px 1fr; align-items: center; gap: 16px; }
    .dial-ring {
      position: relative;
      width: 240px;
      height: 240px;
      border-radius: 50%;
      background: conic-gradient(currentColor var(--dial-dash, 0), rgba(255,255,255,.10) 0);
      display: grid;
      place-items: center;
      color: #f5cd6b;
    }
    .dial-ring::after { content: ""; position: absolute; inset: 14px; border-radius: 50%; background: rgba(12,18,18,.92); border: 1px solid rgba(220,177,108,.45); }
    .dial-ring.bullish { color: #ff5763; }
    .dial-ring.bullish-soft { color: #ffd075; }
    .dial-ring.warning { color: #ffd075; }
    .dial-ring.warning-soft { color: #3edf9a; }
    .dial-ring.bearish { color: #3edf9a; }
    .dial-value { position: relative; z-index: 1; color: #f0e1c1; font-size: 72px; font-weight: 900; }
    .dial-state { position: absolute; bottom: 42px; left: 0; right: 0; text-align: center; color: #f5cd6b; font-size: 19px; z-index: 1; }
    .dial-foot { position: absolute; bottom: 16px; left: 0; right: 0; text-align: center; color: #9da3a3; font-size: 17px; z-index: 1; }
    .dial-bands { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 12px; }
    .band { padding: 8px 12px; border-radius: 6px; background: rgba(255,255,255,.04); color: #d3d8da; font-size: 16px; }
  `;
}

function darkTerminalScript() {
  return `
    <script>
      (function () {
        const seedProfiles = {
          upA: [.70,.61,.67,.59,.73,.55,.62,.50,.68,.72,.63,.48,.42,.55,.60,.46,.65,.71,.58,.74,.62,.69,.56,.66,.72,.61,.49,.38,.45,.33,.42,.30,.37,.25,.35,.22,.29,.18,.25,.14,.19],
          upB: [.64,.55,.61,.47,.42,.57,.63,.46,.36,.44,.54,.60,.45,.32,.38,.50,.40,.27,.34,.46,.36,.25,.18,.31,.23,.15,.26,.12,.22,.10,.18,.08,.16,.06,.14,.08,.12,.05,.10,.07,.09],
          downA: [.34,.25,.36,.29,.45,.37,.53,.43,.57,.48,.52,.40,.49,.44,.56,.47,.60,.69,.55,.64,.75,.67,.80,.71,.84,.76,.88,.79,.86,.82,.90,.81,.87,.78,.91,.83,.93,.84,.90,.82,.92],
          downB: [.45,.34,.42,.30,.50,.39,.58,.46,.62,.51,.68,.54,.61,.49,.57,.66,.59,.73,.64,.78,.69,.82,.72,.86,.77,.91,.80,.88,.74,.93,.82,.90,.78,.94,.84,.92,.80,.95,.86,.91,.83]
        };
        for (const canvas of document.querySelectorAll('.dt-spark')) {
          const ctx = canvas.getContext('2d');
          const seed = String(canvas.dataset.seed || 'dt');
          const bearish = canvas.dataset.bearish === '1';
          const pct = Number(canvas.dataset.pct || 0);
          const rect = canvas.getBoundingClientRect();
          const dpr = Math.max(1, window.devicePixelRatio || 1);
          const width = Math.max(150, rect.width || 172);
          const height = Math.max(36, rect.height || 40);
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, width, height);
          let hash = 2166136261;
          for (let i = 0; i < seed.length; i += 1) {
            hash ^= seed.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
          }
          const rand = () => {
            hash ^= hash << 13;
            hash ^= hash >>> 17;
            hash ^= hash << 5;
            return ((hash >>> 0) % 10000) / 10000;
          };
          const match = seed.match(/^dt-(\\d+)/);
          const index = match ? Number(match[1]) : 0;
          const strongMove = Math.abs(pct) >= 1 || index % 2 === 1;
          const profile = seedProfiles[bearish ? (strongMove ? 'downB' : 'downA') : (strongMove ? 'upB' : 'upA')];
          const step = width / (profile.length - 1);
          const pts = profile.map((value, i) => {
            const impulse = i % 5 === 0 ? (rand() - 0.5) * height * 0.14 : 0;
            const micro = (rand() - 0.5) * height * 0.085;
            const baseY = height * (0.08 + value * 0.68);
            const yVal = Math.max(height * 0.06, Math.min(height * 0.84, baseY + impulse + micro));
            return [i * step, Math.round(yVal * 10) / 10];
          });
          const grad = ctx.createLinearGradient(0, 0, 0, height);
          grad.addColorStop(0, bearish ? 'rgba(54,215,141,.22)' : 'rgba(255,75,85,.24)');
          grad.addColorStop(.58, bearish ? 'rgba(54,215,141,.10)' : 'rgba(255,75,85,.12)');
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.lineTo(pts[pts.length - 1][0], height + 2);
          ctx.lineTo(pts[0][0], height + 2);
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.strokeStyle = bearish ? '#36d78d' : '#ff4b55';
          ctx.lineWidth = 1.7;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.shadowColor = bearish ? 'rgba(54,215,141,.45)' : 'rgba(255,75,85,.45)';
          ctx.shadowBlur = 2.4;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      })();
    </script>
  `;
}

function renderDarkTerminalHtml(data) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.report_date)} A股市场情绪日报</title>
<style>${darkTerminalCss()}</style>
</head>
<body>
<main id="report-root" data-report-date="${escapeHtml(data.report_date)}" data-theme="dark-terminal-magazine">
${darkTerminalPage1(data)}
${darkTerminalPage2(data)}
${darkTerminalPage3(data)}
${darkTerminalPage4(data)}
</main>
${darkTerminalScript()}
</body>
</html>`;
}

// =====================================================================
// 4. 统一入口、preflight、exportPngs
// =====================================================================

export function renderReportHtml(data, options = {}) {
  const theme = resolveTheme(options.theme ?? data.theme);
  if (theme.id === 'dark-editorial-magazine') return renderDarkEditorialHtml(data);
  if (theme.id === 'light-institutional-report') return renderLightInstitutionalHtml(data);
  if (theme.id === 'dark-terminal-magazine') return renderDarkTerminalHtml(data);
  throw new Error(`Unsupported theme id: ${theme.id}`);
}

export async function runBrowserPreflight(page) {
  return await page.evaluate(() => {
    const errors = [];
    const posters = Array.from(document.querySelectorAll('.poster'));
    if (posters.length !== 4) errors.push(`expected 4 posters, found ${posters.length}`);
    for (const poster of posters) {
      const pageNo = poster.getAttribute('data-page');
      const rect = poster.getBoundingClientRect();
      if (Math.round(rect.width) !== 1080 || Math.round(rect.height) !== 1440) {
        errors.push(`page ${pageNo}: poster size ${Math.round(rect.width)}x${Math.round(rect.height)} is not 1080x1440`);
      }
      const safe = { left: rect.left + 32, right: rect.right - 32, top: rect.top + 32, bottom: rect.bottom - 32 };
      const nodes = Array.from(poster.querySelectorAll('.panel, .li-panel, .de-panel, .dt-panel, .metric-card, .quality-card, .signal-card, .li-signal-card, .de-signal-card, .dt-signal-card, .li-index-card, .de-index-card, .dt-index-card, .role-card, .leader-row, .li-ladder-row, .de-ladder-row, .dt-ladder-row, .theme-row, .li-theme-row, .dt-theme-row, .deep-dive-card, .footer, .li-footer, .de-footer, .dt-footer'));
      for (const el of nodes) {
        const cs = window.getComputedStyle(el);
        const overflowHidden = cs.overflow === 'hidden' || cs.overflowY === 'hidden' || cs.overflowX === 'hidden';
        const overflowX = el.scrollWidth > el.clientWidth + 8;
        const overflowY = el.scrollHeight > el.clientHeight + 8;
        if ((overflowX || overflowY) && !overflowHidden) {
          const snippet = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);
          errors.push(`page ${pageNo}: overflow ${overflowX ? 'x' : ''}${overflowY ? 'y' : ''} at ${el.className || el.tagName}: ${snippet}`);
        }
        const r = el.getBoundingClientRect();
        const isFooter = el.tagName === 'FOOTER' || Array.from(el.classList).some((name) => name.includes('footer'));
        if (!isFooter && (r.left < safe.left - 1 || r.right > safe.right + 1 || r.top < safe.top - 1 || r.bottom > safe.bottom + 1)) {
          const snippet = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);
          errors.push(`page ${pageNo}: safe-area violation at ${el.className || el.tagName}: ${snippet}`);
        }
      }
    }
    return errors;
  });
}

export async function loadPlaywright() {
  try {
    return require('playwright');
  } catch (firstError) {
    for (const root of (process.env.NODE_PATH ?? '').split(path.delimiter).filter(Boolean)) {
      const pnpmDir = path.join(root, '.pnpm');
      if (!existsSync(pnpmDir)) continue;
      for (const entry of readdirSync(pnpmDir)) {
        if (!entry.startsWith('playwright@')) continue;
        const candidate = path.join(pnpmDir, entry, 'node_modules', 'playwright');
        if (!existsSync(candidate)) continue;
        try {
          return require(candidate);
        } catch {
          // Try the next pnpm candidate.
        }
      }
    }
    throw new Error(`Playwright is required for PNG export. Set NODE_PATH to bundled node_modules or install playwright. Original error: ${firstError.message}`);
  }
}

function findSystemBrowser() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

export async function launchChromium() {
  const { chromium } = await loadPlaywright();
  try {
    return await chromium.launch({ headless: true });
  } catch (firstError) {
    const executablePath = findSystemBrowser();
    if (!executablePath) throw firstError;
    try {
      return await chromium.launch({ headless: true, executablePath });
    } catch (fallbackError) {
      throw new Error(`Unable to launch Playwright browser. Default error: ${firstError.message}. System browser fallback error: ${fallbackError.message}`);
    }
  }
}

async function exportPngs(htmlPath, outDir, reportDate) {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1600 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href);
    await page.evaluate(() => document.fonts?.ready);
    const preflightErrors = await runBrowserPreflight(page);
    if (preflightErrors.length) throw new Error(`Browser preflight failed:\n${preflightErrors.map((x) => `- ${x}`).join('\n')}`);
    for (let pageNo = 1; pageNo <= 4; pageNo += 1) {
      const element = await page.locator(`.poster[data-page="${pageNo}"]`).elementHandle();
      const pngPath = path.join(outDir, outputPngName(reportDate, pageNo));
      await element.screenshot({ path: pngPath });
      const size = await readPngDimensions(pngPath);
      if (size.width !== 1080 || size.height !== 1440) {
        throw new Error(`${pngPath} exported at ${size.width}x${size.height}, expected 1080x1440`);
      }
    }
  } finally {
    await browser.close();
  }
}

export async function renderReport({ dataPath, outDir, themeName, htmlOnly = false }) {
  const data = await readJsonFile(dataPath);
  if (themeName) data.theme = themeName;
  const schemaValidation = await validateDailyDataAgainstSchema(data);
  if (schemaValidation.errors.length) {
    printValidationResult(schemaValidation);
    throw new Error('daily-data JSON Schema validation failed');
  }
  const validation = validateDailyData(data);
  if (validation.errors.length) {
    printValidationResult(validation);
    throw new Error('daily-data validation failed');
  }
  const targetDir = outDir ?? path.dirname(dataPath);
  await mkdir(targetDir, { recursive: true });
  const dataOutPath = path.join(targetDir, `${data.report_date}-daily-data.json`);
  await writeFile(dataOutPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  const html = renderReportHtml(data, { theme: data.theme });
  const htmlPath = path.join(targetDir, reportHtmlName(data.report_date));
  const commentaryPath = path.join(targetDir, wechatCommentaryName(data.report_date));
  await writeFile(htmlPath, html, 'utf8');
  await writeFile(commentaryPath, `${wechatCommentaryText(data)}\n`, 'utf8');
  if (!htmlOnly) await exportPngs(htmlPath, targetDir, data.report_date);
  return { htmlPath, commentaryPath, outDir: targetDir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await renderReport({
      dataPath: path.resolve(args.data),
      outDir: args.out ? path.resolve(args.out) : undefined,
      themeName: args.theme,
      htmlOnly: args.htmlOnly
    });
    console.log(`HTML: ${result.htmlPath}`);
    console.log(`Commentary: ${result.commentaryPath}`);
    if (!args.htmlOnly) console.log(`PNGs: ${result.outDir}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
