# A股日报贴图

基于 AI Agent 自动生成微信公众号 A 股市场情绪日报。包含市场全景观测、短线情绪周期分析、涨停主线复盘、强势板块龙头梯队四张信息图，以及 300 字以内的市场短评。

## 功能

- **4 张 1080×1440 PNG 信息图**：市场全景、情绪周期、涨停复盘、龙头梯队
- **微信公众号短评**：≤300 字中文市场评论
- **结构化数据输出**：`daily-data.json` 作为单数据源
- **数据来源与口径记录**：清晰标注口径差异
- **三种视觉主题**：暗金杂志封面风、浅色机构午报风、深色终端杂志风

## 项目结构

```
a-share-daily-wechat-images/
├── SKILL.md                          # Skill 定义与完整工作流
├── agents/
│   └── openai.yaml                   # Agent 配置
├── fixtures/
│   └── sample-daily-data.json        # 示例数据
├── references/                       # 参考文档
│   ├── daily-data.schema.json        # JSON Schema
│   ├── data-sources.md               # 数据源说明
│   ├── emotion-model-v1.md           # 情绪模型
│   ├── four-image-template.md        # 四图模板
│   ├── rendering-workflow.md         # 渲染流程
│   ├── report-schema.md              # 报告结构
│   └── theme-and-layout.md           # 主题与布局
├── scripts/                          # 脚本
│   ├── lib/
│   │   └── report-utils.mjs
│   ├── render-report.mjs             # 报告渲染
│   ├── themes.mjs                    # 主题定义
│   └── validate-report.mjs           # 报告校验
└── tests/
    └── report-tools.test.mjs
```

## 生成内容

每次运行输出到 `outputs/YYYY-MM-DD/`：

| 文件 | 说明 |
|------|------|
| `01-市场全景与资金流.png` | 全市场结论与资金风格切换 |
| `02-短线情绪周期.png` | 情绪评分、风险/修复状态 |
| `03-涨停与主线复盘.png` | 涨停统计、主线题材深读 |
| `04-强势板块龙头梯队.png` | 龙头、连板、梯队角色 |
| `report.html` | 可复现的渲染源文件 |
| `daily-data.json` | 结构化数据单数据源 |
| `微信公众号摘要.txt` | ≤300 字中文市场短评 |
| `数据来源与口径.md` | 数据来源与口径说明 |

## 视觉主题

| 主题 | 风格 |
|------|------|
| `暗金杂志封面风格` | 深色金融 + 杂志标题 + 机构卡片 |
| `浅色机构午报风格` | 纸质感研究报告风 |
| `深色终端杂志风格` | Bloomberg 终端数据密集风 |

## 使用

由 AI Agent（Codex）通过 Skill 机制调用，自动完成从数据采集、情绪建模、报告生成到图片输出的全流程。

```bash
# 校验报告
node scripts/validate-report.mjs --dir outputs/YYYY-MM-DD
```

## 免责声明

本工具仅供复盘研究使用，不构成任何投资建议。所有数据来源于公开渠道，口径差异已在输出中标注。