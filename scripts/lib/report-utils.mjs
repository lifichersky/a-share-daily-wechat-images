import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPORT_TITLE = 'A股市场情绪日报';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DAILY_DATA_SCHEMA_PATH = path.resolve(__dirname, '../../references/daily-data.schema.json');

export const OUTPUT_NAMES = [
  '市场全景与资金流',
  '短线情绪周期',
  '涨停与主线复盘',
  '强势板块龙头梯队'
];

export const REQUIRED_SOURCE_COVERAGE = [
  'financial_analysis',
  'eastmoney',
  'cls',
  'stcn_databao'
];

export const REQUIRED_LEADER_ROLES = [
  '空间龙',
  '板块龙头',
  '容量中军',
  '核心助攻',
  '中位接力',
  '补涨前排',
  '首板前排',
  '风险负反馈'
];

export const REQUIRED_EMOTION_FACTORS = new Map([
  ['指数强度', 15],
  ['市场广度', 12],
  ['量能变化', 8],
  ['主力资金', 10],
  ['涨停强度', 15],
  ['炸板风险', 12],
  ['连板高度', 10],
  ['晋级率', 8],
  ['主线集中度', 6],
  ['跌停负反馈', 4]
]);

export function outputPngName(reportDate, pageNumber) {
  const title = OUTPUT_NAMES[pageNumber - 1];
  const page = String(pageNumber).padStart(2, '0');
  return `${reportDate}-${REPORT_TITLE}-${page}-${title}.png`;
}

export function reportHtmlName(reportDate) {
  return `${reportDate}-report.html`;
}

export function wechatCommentaryName(reportDate) {
  return `${reportDate}-微信公众号摘要.txt`;
}

export function wechatCommentaryText(data) {
  return String(data?.wechat_commentary_v1?.text ?? '').trim();
}

export function previousDailyDataPath(currentOutputDir, previousTradingDate) {
  return path.join(
    path.dirname(path.resolve(currentOutputDir)),
    previousTradingDate,
    `${previousTradingDate}-daily-data.json`
  );
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function pctText(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export function marketClass(value) {
  const n = Number(value);
  if (Number.isNaN(n) || n === 0) return 'neutral';
  return n > 0 ? 'bullish' : 'bearish';
}

export function flowClass(textOrValue) {
  const text = String(textOrValue ?? '');
  if (/^-|净流出|流出|下跌|风险|弱|退潮|分歧/.test(text)) return 'bearish';
  if (/^\+|净流入|流入|上涨|强|确认|修复|扩散/.test(text)) return 'bullish';
  return 'neutral';
}

export async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pathText(parts) {
  if (!parts.length) return '$';
  return parts.reduce((result, part) => {
    if (typeof part === 'number') return `${result}[${part}]`;
    return result === '$' ? part : `${result}.${part}`;
  }, '$');
}

function matchesType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isPlainObject(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  return true;
}

function sameJsonValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function resolveSchemaRef(rootSchema, ref) {
  if (!ref.startsWith('#/')) {
    throw new Error(`Unsupported schema ref: ${ref}`);
  }
  return ref.slice(2).split('/').reduce((cursor, rawPart) => {
    const part = rawPart.replaceAll('~1', '/').replaceAll('~0', '~');
    return cursor?.[part];
  }, rootSchema);
}

function validateSchemaNode(value, schema, rootSchema, parts, errors) {
  if (!schema || typeof schema !== 'object') return;

  if (schema.$ref) {
    const resolved = resolveSchemaRef(rootSchema, schema.$ref);
    if (!resolved) {
      errors.push(`schema: unresolved ref ${schema.$ref} at ${pathText(parts)}`);
      return;
    }
    validateSchemaNode(value, resolved, rootSchema, parts, errors);
    return;
  }

  if (schema.allOf) {
    for (const item of schema.allOf) validateSchemaNode(value, item, rootSchema, parts, errors);
  }

  if (schema.if) {
    const probeErrors = [];
    validateSchemaNode(value, schema.if, rootSchema, parts, probeErrors);
    if (probeErrors.length === 0 && schema.then) {
      validateSchemaNode(value, schema.then, rootSchema, parts, errors);
    }
  }

  if (schema.const !== undefined && !sameJsonValue(value, schema.const)) {
    errors.push(`schema: ${pathText(parts)} must equal ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum && !schema.enum.some((item) => sameJsonValue(value, item))) {
    errors.push(`schema: ${pathText(parts)} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      errors.push(`schema: ${pathText(parts)} must be ${types.join(' or ')}`);
      return;
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`schema: ${pathText(parts)} length must be at least ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`schema: ${pathText(parts)} length must be at most ${schema.maxLength}`);
    }
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) {
      errors.push(`schema: ${pathText(parts)} must match ${schema.pattern}`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`schema: ${pathText(parts)} must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`schema: ${pathText(parts)} must be <= ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`schema: ${pathText(parts)} must contain at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`schema: ${pathText(parts)} must contain at most ${schema.maxItems} items`);
    }
    if (schema.items) {
      value.forEach((item, index) => validateSchemaNode(item, schema.items, rootSchema, [...parts, index], errors));
    }
    if (schema.contains) {
      const found = value.some((item, index) => {
        const probeErrors = [];
        validateSchemaNode(item, schema.contains, rootSchema, [...parts, index], probeErrors);
        return probeErrors.length === 0;
      });
      if (!found) errors.push(`schema: ${pathText(parts)} must contain a matching item`);
    }
  }

  if (isPlainObject(value)) {
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
      errors.push(`schema: ${pathText(parts)} must contain at least ${schema.minProperties} properties`);
    }
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(`schema: ${pathText([...parts, key])} is required`);
      }
    }
    const known = new Set(Object.keys(schema.properties ?? {}));
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        validateSchemaNode(value[key], childSchema, rootSchema, [...parts, key], errors);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!known.has(key)) errors.push(`schema: ${pathText([...parts, key])} is not allowed`);
      }
    } else if (isPlainObject(schema.additionalProperties)) {
      for (const key of Object.keys(value)) {
        if (!known.has(key)) {
          validateSchemaNode(value[key], schema.additionalProperties, rootSchema, [...parts, key], errors);
        }
      }
    }
  }
}

export async function validateDailyDataAgainstSchema(data, schemaPath = DAILY_DATA_SCHEMA_PATH) {
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  const errors = [];
  validateSchemaNode(data, schema, schema, [], errors);
  return { errors, warnings: [] };
}

export function countVisibleChars(text) {
  return Array.from(String(text ?? '').replace(/\s/g, '')).length;
}

function collectSourceKeys(value, pathParts = [], result = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSourceKeys(item, [...pathParts, index], result));
    return result;
  }
  if (!isPlainObject(value)) return result;
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathParts, key];
    if (key === 'source_key') {
      result.push({ path: pathText(childPath), value: child });
    } else if (key === 'source_keys' && Array.isArray(child)) {
      child.forEach((sourceKey, index) => {
        result.push({ path: pathText([...childPath, index]), value: sourceKey });
      });
    } else {
      collectSourceKeys(child, childPath, result);
    }
  }
  return result;
}

export function validateDailyData(data, options = {}) {
  const errors = [];
  const warnings = [];
  const allowIncomplete = Boolean(options.allowIncomplete);

  function has(path, label = path) {
    const parts = path.split('.');
    let cursor = data;
    for (const part of parts) {
      if (cursor && Object.prototype.hasOwnProperty.call(cursor, part)) {
        cursor = cursor[part];
      } else {
        errors.push(`missing required field: ${label}`);
        return undefined;
      }
    }
    return cursor;
  }

  if (data?.schema_version !== '1.6.0') {
    errors.push(`schema_version must be 1.6.0, got ${data?.schema_version ?? 'missing'}`);
  }
  if (data?.emotion_model_version !== 'emotion_model_v1') {
    errors.push('emotion_model_version must be emotion_model_v1');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data?.report_date ?? '')) {
    errors.push('report_date must match YYYY-MM-DD');
  }
  if (!['暗金杂志封面风格', '浅色机构午报风格', '深色终端杂志风格'].includes(data?.theme)) {
    errors.push('theme must be 暗金杂志封面风格 / 浅色机构午报风格 / 深色终端杂志风格');
  }

  const quality = has('data_quality');
  if (quality) {
    if (!['complete', 'review_needed', 'incomplete'].includes(quality.status)) {
      errors.push('data_quality.status must be complete, review_needed, or incomplete');
    }
    if (quality.status === 'incomplete' && !allowIncomplete) {
      errors.push('data_quality.status is incomplete');
    }
    if (!['high', 'medium', 'low'].includes(quality.confidence)) {
      errors.push('data_quality.confidence must be high, medium, or low');
    }
    const coverageNotes = [
      ...(quality.warnings ?? []),
      ...(quality.missing_fields ?? []),
      ...(quality.conflicts ?? []).map((conflict) => conflict.reason ?? '')
    ].join('\n');
    for (const key of REQUIRED_SOURCE_COVERAGE) {
      if (typeof quality.source_coverage?.[key] !== 'boolean') {
        errors.push(`data_quality.source_coverage.${key} must be a boolean`);
      }
      if (quality.source_coverage?.[key] === false) {
        if (quality.confidence === 'high') {
          errors.push(`data_quality.confidence cannot be high when source_coverage.${key} is false`);
        }
        if (quality.status === 'complete') {
          errors.push(`data_quality.status cannot be complete when source_coverage.${key} is false`);
        }
        if (!coverageNotes.includes(key)) {
          errors.push(`data_quality.source_coverage.${key} is false but no warning, missing_field, or conflict reason mentions it`);
        }
      }
    }
    for (const conflict of quality.conflicts ?? []) {
      if (!conflict.resolved) {
        errors.push(`unresolved data conflict: ${conflict.field ?? 'unknown field'}`);
      }
    }
  }

  for (const path of [
    'market_summary.headline',
    'market_summary.action',
    'market_summary.style_shift',
    'turnover.amount_text',
    'turnover.source_key',
    'breadth.source_key',
    'capital_flow.metric_name',
    'capital_flow.source_key',
    'limit_up.display口径',
    'limit_up.source_key',
    'limit_up.previous_day',
    'themes.strong',
    'themes.weak',
    'theme_interpretation',
    'ladder.highest_non_st_board',
    'ladder.boards',
    'ladder.previous_day',
    'leader_roles',
    'emotion_model_v1',
    'next_session_signals',
    'wechat_commentary_v1',
    'sources',
    'assumptions'
  ]) {
    has(path);
  }

  const indexNames = new Set((data.indices ?? []).map((item) => item.name));
  for (const name of ['上证指数', '深证成指', '创业板指', '科创50']) {
    if (!indexNames.has(name)) errors.push(`indices missing ${name}`);
  }

  for (const role of REQUIRED_LEADER_ROLES) {
    if (!Array.isArray(data.leader_roles?.[role])) {
      errors.push(`leader_roles.${role} must exist as an array`);
    }
  }

  const previousLimitUp = data.limit_up?.previous_day;
  if (previousLimitUp) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(previousLimitUp.date ?? '')) {
      errors.push('limit_up.previous_day.date must match YYYY-MM-DD');
    }
    for (const field of ['limit_up', 'limit_down', 'broken_board']) {
      if (!Number.isInteger(previousLimitUp[field]) || previousLimitUp[field] < 0) {
        errors.push(`limit_up.previous_day.${field} must be a non-negative integer`);
      }
    }
    if (typeof previousLimitUp.seal_rate_pct !== 'number' || previousLimitUp.seal_rate_pct < 0 || previousLimitUp.seal_rate_pct > 100) {
      errors.push('limit_up.previous_day.seal_rate_pct must be a number from 0 to 100');
    }
    if (!previousLimitUp.source_key) {
      errors.push('limit_up.previous_day.source_key is required');
    }
  }

  const previousLadder = data.ladder?.previous_day;
  if (previousLadder) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(previousLadder.date ?? '')) {
      errors.push('ladder.previous_day.date must match YYYY-MM-DD');
    }
    for (const field of ['highest_non_st_board', 'consecutive_board_total']) {
      if (!Number.isInteger(previousLadder[field]) || previousLadder[field] < 0) {
        errors.push(`ladder.previous_day.${field} must be a non-negative integer`);
      }
    }
    if (!previousLadder.source_key) {
      errors.push('ladder.previous_day.source_key is required');
    }
  }

  const themeInterpretation = data.theme_interpretation;
  if (themeInterpretation) {
    const validStatuses = new Set(['both', 'upside_only', 'downside_only', 'no_clear_mainline']);
    if (!validStatuses.has(themeInterpretation.status)) {
      errors.push('theme_interpretation.status must be both, upside_only, downside_only, or no_clear_mainline');
    }
    if (!Array.isArray(themeInterpretation.upside)) {
      errors.push('theme_interpretation.upside must be an array');
    }
    if (!Array.isArray(themeInterpretation.downside)) {
      errors.push('theme_interpretation.downside must be an array');
    }
    if ((themeInterpretation.upside?.length ?? 0) > 2) {
      errors.push('theme_interpretation.upside must contain at most 2 items');
    }
    if ((themeInterpretation.downside?.length ?? 0) > 2) {
      errors.push('theme_interpretation.downside must contain at most 2 items');
    }

    function validateInterpretationItem(item, itemPath, requireName = true) {
      if (!isPlainObject(item)) {
        errors.push(`${itemPath} must be an object`);
        return;
      }
      const fields = requireName
        ? ['name', 'stage', 'core_judgment', 'narrative', 'confirm_signal', 'invalidate_signal', 'source_keys']
        : ['stage', 'core_judgment', 'narrative', 'confirm_signal', 'invalidate_signal', 'source_keys'];
      for (const field of fields) {
        if (!item[field]) errors.push(`${itemPath}.${field} is required`);
      }
      if (item.source_keys && (!Array.isArray(item.source_keys) || item.source_keys.length === 0)) {
        errors.push(`${itemPath}.source_keys must contain at least one item`);
      }
    }

    (themeInterpretation.upside ?? []).forEach((item, index) => validateInterpretationItem(item, `theme_interpretation.upside[${index}]`));
    (themeInterpretation.downside ?? []).forEach((item, index) => validateInterpretationItem(item, `theme_interpretation.downside[${index}]`));

    if (themeInterpretation.status === 'both') {
      if ((themeInterpretation.upside?.length ?? 0) === 0) errors.push('theme_interpretation.upside must contain at least 1 item when status is both');
      if ((themeInterpretation.downside?.length ?? 0) === 0) errors.push('theme_interpretation.downside must contain at least 1 item when status is both');
    }
    if (themeInterpretation.status === 'upside_only') {
      if ((themeInterpretation.upside?.length ?? 0) === 0) errors.push('theme_interpretation.upside must contain at least 1 item when status is upside_only');
      if ((themeInterpretation.downside?.length ?? 0) !== 0) errors.push('theme_interpretation.downside must be empty when status is upside_only');
    }
    if (themeInterpretation.status === 'downside_only') {
      if ((themeInterpretation.upside?.length ?? 0) !== 0) errors.push('theme_interpretation.upside must be empty when status is downside_only');
      if ((themeInterpretation.downside?.length ?? 0) === 0) errors.push('theme_interpretation.downside must contain at least 1 item when status is downside_only');
    }
    if (themeInterpretation.status === 'no_clear_mainline') {
      if ((themeInterpretation.upside?.length ?? 0) !== 0) errors.push('theme_interpretation.upside must be empty when status is no_clear_mainline');
      if ((themeInterpretation.downside?.length ?? 0) !== 0) errors.push('theme_interpretation.downside must be empty when status is no_clear_mainline');
      validateInterpretationItem(themeInterpretation.no_clear_mainline, 'theme_interpretation.no_clear_mainline', false);
    }
  }

  for (const key of ['确认信号', '弱化信号', '风险信号']) {
    if (!Array.isArray(data.next_session_signals?.[key]) || data.next_session_signals[key].length === 0) {
      errors.push(`next_session_signals.${key} must contain at least one item`);
    }
  }

  const commentary = data.wechat_commentary_v1;
  if (commentary) {
    for (const field of ['text', 'core_judgment', 'capital_logic', 'validation_signal', 'source_keys']) {
      if (!commentary[field]) errors.push(`wechat_commentary_v1.${field} is required`);
    }
    const text = wechatCommentaryText(data);
    const count = countVisibleChars(text);
    if (count > 300) {
      errors.push(`wechat_commentary_v1.text length ${count} exceeds 300 visible characters`);
    }
    if (count < 80) {
      errors.push(`wechat_commentary_v1.text length ${count} is too short for a market commentary`);
    }
    if (!/(不是|而是|本质|更像|说明|关键|核心|实质)/.test(text)) {
      errors.push('wechat_commentary_v1.text must include an explicit market judgment');
    }
    if (!/(明日|次日|若|如果|一旦|除非)/.test(text)) {
      errors.push('wechat_commentary_v1.text must include a next-session validation condition');
    }
    const numericCount = text.match(/\d+(?:\.\d+)?/g)?.length ?? 0;
    if (numericCount > 3) {
      errors.push('wechat_commentary_v1.text must contain at most 3 numeric values');
    }
    if (!Array.isArray(commentary.source_keys) || commentary.source_keys.length === 0) {
      errors.push('wechat_commentary_v1.source_keys must contain at least one item');
    }
  }

  const factors = data.emotion_model_v1?.factors ?? [];
  if (data.emotion_model_v1 && !['high', 'medium', 'low'].includes(data.emotion_model_v1.confidence)) {
    errors.push('emotion_model_v1.confidence must be high, medium, or low');
  }
  const factorByName = new Map(factors.map((factor) => [factor.name, factor]));
  let scoreSum = 0;
  for (const [name, max] of REQUIRED_EMOTION_FACTORS.entries()) {
    const factor = factorByName.get(name);
    if (!factor) {
      errors.push(`emotion_model_v1.factors missing ${name}`);
      continue;
    }
    if (factor.max !== max) errors.push(`emotion factor ${name} max must be ${max}`);
    if (!Number.isInteger(factor.score) || factor.score < 0 || factor.score > max) {
      errors.push(`emotion factor ${name} score must be an integer from 0 to ${max}`);
    }
    if (!factor.reason) errors.push(`emotion factor ${name} reason is required`);
    scoreSum += Number(factor.score ?? 0);
  }
  if (factors.length !== REQUIRED_EMOTION_FACTORS.size) {
    errors.push(`emotion_model_v1.factors must contain exactly ${REQUIRED_EMOTION_FACTORS.size} factors`);
  }
  if (data.emotion_model_v1 && scoreSum !== data.emotion_model_v1.score) {
    errors.push(`emotion_model_v1.score ${data.emotion_model_v1.score} does not equal factor sum ${scoreSum}`);
  }

  if (!data.sources?.financial_analysis) {
    errors.push('sources.financial_analysis is required');
  }
  if (Object.keys(data.sources ?? {}).length < 4) {
    errors.push('sources must contain at least four source entries');
  }
  const sourceKeys = new Set(Object.keys(data.sources ?? {}));
  for (const item of collectSourceKeys(data)) {
    if (typeof item.value !== 'string' || !sourceKeys.has(item.value)) {
      errors.push(`${item.path} references missing sources.${item.value}`);
    }
  }

  if ((quality?.warnings ?? []).length > 0) {
    warnings.push(...quality.warnings.map((warning) => `data_quality warning: ${warning}`));
  }

  return { errors, warnings };
}

export async function readPngDimensions(filePath) {
  const handle = await readFile(filePath);
  const pngSignature = '89504e470d0a1a0a';
  if (handle.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error(`${filePath} is not a PNG file`);
  }
  return {
    width: handle.readUInt32BE(16),
    height: handle.readUInt32BE(20)
  };
}

export function printValidationResult(result) {
  for (const warning of result.warnings) {
    console.warn(`WARN ${warning}`);
  }
  for (const error of result.errors) {
    console.error(`ERROR ${error}`);
  }
}
