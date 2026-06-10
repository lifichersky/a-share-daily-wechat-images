#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  countVisibleChars,
  outputPngName,
  printValidationResult,
  readJsonFile,
  readPngDimensions,
  reportHtmlName,
  wechatCommentaryText,
  validateDailyDataAgainstSchema,
  validateDailyData
} from './lib/report-utils.mjs';
import { launchChromium, runBrowserPreflight } from './render-report.mjs';

function parseArgs(argv) {
  const args = { allowIncomplete: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dir') args.dir = argv[++i];
    else if (arg === '--data') args.data = argv[++i];
    else if (arg === '--allow-incomplete') args.allowIncomplete = true;
    else if (!arg.startsWith('--') && !args.dir) args.dir = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.dir && !args.data) {
    throw new Error('Usage: node validate-report.mjs --dir <outputs/YYYY-MM-DD> [--allow-incomplete]');
  }
  return args;
}

async function fileExists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findFirst(dir, pattern) {
  const files = await readdir(dir);
  return files.find((name) => pattern.test(name));
}

async function validateHtml(htmlPath) {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1600 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href);
    await page.evaluate(() => document.fonts?.ready);
    return await runBrowserPreflight(page);
  } finally {
    await browser.close();
  }
}

export function validateSourceNotesText(text, data) {
  const errors = [];
  const visibleCount = countVisibleChars(text);
  if (visibleCount < 80) {
    errors.push(`source notes file is too short: ${visibleCount} visible characters`);
  }
  if (!/(数据来源|来源)/.test(text)) {
    errors.push('source notes file must include a data source section');
  }
  if (!/口径/.test(text)) {
    errors.push('source notes file must describe display口径');
  }
  if (!/仅供复盘，不构成投资建议/.test(text)) {
    errors.push('source notes file must include the investment disclaimer');
  }

  const sourceFamilyPatterns = [
    ['financial_analysis', /financial-analysis|marketInsight/i],
    ['eastmoney', /东方财富|eastmoney/i],
    ['cls', /财联社|cls/i],
    ['stcn_databao', /证券时报|数据宝|stcn/i]
  ];
  for (const [key, pattern] of sourceFamilyPatterns) {
    if (data?.data_quality?.source_coverage?.[key] === true && !pattern.test(text)) {
      errors.push(`source notes file must mention covered source family: ${key}`);
    }
  }

  return errors;
}

export async function validateReport({ dir, dataPath, allowIncomplete = false }) {
  const errors = [];
  const warnings = [];
  const reportDir = dir ? path.resolve(dir) : path.dirname(path.resolve(dataPath));
  const resolvedDataPath = dataPath
    ? path.resolve(dataPath)
    : path.join(reportDir, await findFirst(reportDir, /-daily-data\.json$/) ?? '');

  if (!resolvedDataPath || !(await fileExists(resolvedDataPath))) {
    errors.push(`daily-data.json not found in ${reportDir}`);
    return { errors, warnings };
  }

  const data = await readJsonFile(resolvedDataPath);
  const schemaValidation = await validateDailyDataAgainstSchema(data);
  errors.push(...schemaValidation.errors);
  warnings.push(...schemaValidation.warnings);
  const dataValidation = validateDailyData(data, { allowIncomplete });
  errors.push(...dataValidation.errors);
  warnings.push(...dataValidation.warnings);

  const htmlPath = path.join(reportDir, reportHtmlName(data.report_date));
  if (!(await fileExists(htmlPath))) {
    errors.push(`report HTML missing: ${htmlPath}`);
  } else {
    try {
      const htmlErrors = await validateHtml(htmlPath);
      errors.push(...htmlErrors);
    } catch (error) {
      errors.push(error.message);
    }
  }

  const commentaryName = await findFirst(reportDir, /微信公众号摘要\.txt$/);
  if (!commentaryName) {
    errors.push('commentary file missing: *微信公众号摘要.txt');
  } else {
    const commentaryText = await readFile(path.join(reportDir, commentaryName), 'utf8');
    const count = countVisibleChars(commentaryText);
    if (count > 300) {
      errors.push(`commentary length ${count} exceeds 300 visible characters`);
    }
    const expectedCommentary = wechatCommentaryText(data);
    if (commentaryText.trim() !== expectedCommentary) {
      errors.push('commentary file does not match daily-data.wechat_commentary_v1.text');
    }
  }

  const sourceNotesName = await findFirst(reportDir, /数据来源与口径\.md$/);
  if (!sourceNotesName) {
    errors.push('source notes file missing: *数据来源与口径.md');
  } else {
    const sourceNotesText = await readFile(path.join(reportDir, sourceNotesName), 'utf8');
    errors.push(...validateSourceNotesText(sourceNotesText, data));
  }

  for (let pageNo = 1; pageNo <= 4; pageNo += 1) {
    const pngPath = path.join(reportDir, outputPngName(data.report_date, pageNo));
    if (!(await fileExists(pngPath))) {
      errors.push(`PNG missing: ${pngPath}`);
      continue;
    }
    try {
      const size = await readPngDimensions(pngPath);
      if (size.width !== 1080 || size.height !== 1440) {
        errors.push(`${path.basename(pngPath)} is ${size.width}x${size.height}, expected 1080x1440`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  return { errors, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await validateReport({
      dir: args.dir,
      dataPath: args.data,
      allowIncomplete: args.allowIncomplete
    });
    printValidationResult(result);
    if (result.errors.length) {
      console.error(`Report validation failed with ${result.errors.length} error(s).`);
      process.exit(1);
    }
    console.log('Report validation passed.');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
