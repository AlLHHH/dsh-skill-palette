/**
 * dsh-skill-palette — browser half.
 *
 * 输入框下方那颗「技能」按钮：点开是全部技能的清单（按「我要做什么」分类、
 * 最近使用、收藏），点一行就把 `/技能名 ` 写进输入框并变蓝；没有中文说明的
 * 技能可以一键让宿主侧的模型翻译，翻译结果缓存在 <dsh home>/skill-zh.json。
 *
 * 从 dsh-status-meter 里拆出来的独立插件：状态/余额/记忆是另一件事，这里只管技能。
 * 浏览器 ModuleLoader 不支持相对路径 require，所以这个文件是自包含的单块，
 * 唯一外部依赖是平台种子的 `react`。
 */
window.__ModuleLoader__.load({
  id: 'dsh-skill-palette',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useRef, useState } = require('react')

    /** 输入框右侧那颗按钮所在的座位。 */
    const RIGHT_SLOT = 'conversation.input.right'

    /** 非数组对象才当成记录看，其余一律 null（宿主传进来的东西不可信）。 */
    function asRecord(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
    }

    /* ---------- 设置（客户端 localStorage，跟着这台机器走） ---------- */

    const SET_KEY = 'dsh-skill-palette:settings'
    const SET_DEFAULTS = { pill: true, turnChips: true, zhNotice: true, autoZh: false }
    let setState = null
    const setListeners = new Set()

    function readSettings() {
      if (setState !== null) return setState
      let parsed = null
      try {
        parsed = JSON.parse(window.localStorage.getItem(SET_KEY) || 'null')
      } catch {
        parsed = null
      }
      const record = asRecord(parsed) ?? {}
      const pick = (key) => (typeof record[key] === 'boolean' ? record[key] : SET_DEFAULTS[key])
      setState = { pill: pick('pill'), turnChips: pick('turnChips'), zhNotice: pick('zhNotice'), autoZh: pick('autoZh') }
      return setState
    }

    function writeSettings(patch) {
      setState = { ...readSettings(), ...patch }
      try {
        window.localStorage.setItem(SET_KEY, JSON.stringify(setState))
      } catch {
        /* 写不进去只影响下次启动，本次照旧 */
      }
      for (const fn of setListeners) {
        try {
          fn(setState)
        } catch {
          /* 一个订阅者出错不该拖垮其他 */
        }
      }
      return setState
    }

    function useSettings() {
      const [value, setValue] = useState(readSettings)
      useEffect(() => {
        setListeners.add(setValue)
        return () => {
          setListeners.delete(setValue)
        }
      }, [])
      return [value, writeSettings]
    }

    /* ---------- 每一轮回答用了哪些技能（回答下方胶囊的数据源） ---------- */

    const usedBySeq = new Map()
    const usedListeners = new Set()

    function publishUsedByTurn(map) {
      usedBySeq.clear()
      for (const [seq, names] of map) usedBySeq.set(seq, names)
      for (const fn of usedListeners) {
        try {
          fn()
        } catch {
          /* 同上 */
        }
      }
    }

    function useUsedByTurn(seq) {
      const [names, setNames] = useState(() => usedBySeq.get(seq) ?? [])
      useEffect(() => {
        const sync = () => setNames(usedBySeq.get(seq) ?? [])
        sync()
        usedListeners.add(sync)
        return () => {
          usedListeners.delete(sync)
        }
      }, [seq])
      return names
    }

    /** 浮层里那颗按钮与「本次回复用到的技能」胶囊的皮肤：伪类反馈只能写在样式表里。 */
    const METER_CSS_ID = 'dsh-skill-palette-css'
    const METER_CSS = [
      '.dsh-skill-palette-button,.dsh-skill-palette-capsule{border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.14));background:transparent;color:var(--dsw-alias-label-secondary, rgba(255,255,255,.72));transition:background-color .12s ease,border-color .12s ease,color .12s ease,transform .06s ease}',
      '.dsh-skill-palette-button:hover,.dsh-skill-palette-capsule:hover{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.36);color:rgba(255,255,255,.97)}',
      '.dsh-skill-palette-button:active,.dsh-skill-palette-capsule:active{background:rgba(255,255,255,.26);border-color:rgba(255,255,255,.5);transform:translateY(1px)}',
      '.dsh-skill-palette-button:focus-visible,.dsh-skill-palette-capsule:focus-visible{outline:2px solid rgba(255,255,255,.6);outline-offset:1px}',
      '.dsh-skill-palette-button[aria-expanded="true"]{background:rgba(255,255,255,.1);border-color:var(--dsw-alias-border-l3,rgba(255,255,255,.3))}',
      '.dsh-used-box{height:auto;border-radius:10px;padding:4px 8px;letter-spacing:0}',
      '.dsh-used-box:active{background:transparent;border-color:var(--dsw-alias-border-l2, rgba(255,255,255,.14));color:var(--dsw-alias-label-secondary, rgba(255,255,255,.72));transform:none}',
      '.dsh-skill-turn{display:flex;flex-wrap:wrap;gap:5px;margin:2px 0 0 2px}',
      '.dsh-skill-turn-chip{display:inline-block;padding:1px 8px;border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16));border-radius:999px;background:color-mix(in oklab, currentColor 7%, transparent);color:var(--dsw-alias-label-secondary, rgba(255,255,255,.72));font-size:11px;line-height:16px;white-space:nowrap;cursor:default}',
      '.dsh-sp-wrap{display:flex;flex-direction:column;gap:2px}',
      '.dsh-sp-title{margin:0 0 2px;font-size:14px;font-weight:600}',
      '.dsh-sp-note{margin:0 0 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary, rgba(255,255,255,.55))}',
      '.dsh-sp-row{display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid color-mix(in oklab, currentColor 8%, transparent)}',
      '.dsh-sp-text{flex:1 1 auto;min-width:0}',
      '.dsh-sp-label{font-size:13px;line-height:19px}',
      '.dsh-sp-hint{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary, rgba(255,255,255,.55))}',
      '.dsh-sp-sw{position:relative;flex:0 0 auto;width:34px;height:20px;padding:0;border-radius:999px;border:1px solid color-mix(in oklab, currentColor 32%, transparent);background:color-mix(in oklab, currentColor 12%, transparent);cursor:pointer;transition:background-color .14s ease,border-color .14s ease}',
      '.dsh-sp-sw.is-on{background:var(--color-blue-500,#3b82f6);border-color:var(--color-blue-500,#3b82f6)}',
      '.dsh-sp-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .14s ease}',
      '.dsh-sp-sw.is-on .dsh-sp-knob{transform:translateX(14px)}',
      '.dsh-sp-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;padding-top:10px;border-top:1px solid color-mix(in oklab, currentColor 8%, transparent)}',
      '.dsh-sp-btn{height:24px;padding:0 10px;border:1px solid color-mix(in oklab, currentColor 22%, transparent);border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}',
      '.dsh-sp-btn:hover{background:color-mix(in oklab, currentColor 8%, transparent)}',
      '.dsh-sp-btn:disabled{opacity:.5;cursor:default}',
    ].join('')

    /** 把上面的样式表挂进 document.head 一次；重渲染不会把它弄丢。 */
    function ensureMeterCss() {
      try {
        const node = document.getElementById(METER_CSS_ID)
        if (node !== null) {
          if (node.textContent !== METER_CSS) node.textContent = METER_CSS
          return
        }
        const style = document.createElement('style')
        style.id = METER_CSS_ID
        style.textContent = METER_CSS
        document.head.appendChild(style)
      } catch {
        /* 锁死的文档就靠内联样式撑着 */
      }
    }

    const SKILL_ID = 'dsh-skill-palette'
    /** Left of the meters (order 40) and right of the codex controls (10..30). */
    const SKILL_ORDER = 35
    const USED_ID = 'dsh-skill-used'
    const USED_ORDER = 45
    const USED_LABEL = '本次技能'
    const USED_PILL = 18
    const USED_SIDE_ROOM = 110
    const USED_FLOAT_STYLE = { position: 'fixed', zIndex: '30', display: 'flex', flexDirection: 'column', flexWrap: 'wrap', alignContent: 'flex-start', rowGap: '2px', columnGap: '8px', pointerEvents: 'auto', boxSizing: 'border-box', maxWidth: '42vw' }
    const USED_NAME_STYLE = { fontSize: '11px', lineHeight: '16px', whiteSpace: 'nowrap', cursor: 'default' }
    const USED_TIP_WIDTH = 420
    const USED_TIP_STYLE = { position: 'fixed', zIndex: '46', maxHeight: '46vh', overflow: 'auto', padding: '6px 10px', border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.18))', borderRadius: '10px', background: 'var(--dsw-alias-bg-base, #1f1f1f)', boxShadow: '0 6px 20px rgba(0,0,0,.45)', fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-primary, rgba(255,255,255,.94))', whiteSpace: 'nowrap' }
    const USED_TIP_HEAD_STYLE = { color: 'var(--dsw-alias-label-secondary, rgba(255,255,255,.6))', marginBottom: '2px' }
    const SKILL_LABEL = '技能'
    const SKILL_TIP = '技能：点一下把 /名称 写进输入框'
    const SKILL_CACHE_MS = 60000
    /** Favourites and the recency log live in localStorage: no host round-trip. */
    /** Lines the host route translated at runtime; wins over the built-in table. */
    let SKILL_ZH_EXT = {}
    /** POST {items} to translate, POST {} to read what is already cached. */
    const SKILL_ZH_ROUTE = '/api/dsh-skill-palette/skill-zh'
    /** One batch the host accepts per call. */
    const SKILL_ZH_BATCH = 20

    /** The Chinese line for a skill, from either table ('' = none yet). */
    function zhLineOf(name) {
      if (Object.prototype.hasOwnProperty.call(SKILL_ZH_EXT, name)) {
        const fresh = SKILL_ZH_EXT[name]
        if (typeof fresh === 'string' && fresh !== '') return fresh
      }
      return Object.prototype.hasOwnProperty.call(SKILL_ZH, name) ? SKILL_ZH[name] : ''
    }

    /** Whether a skill already has a Chinese line. */
    function hasZh(name) {
      return zhLineOf(name) !== ''
    }

    /** Read the host's cache; a missing route is not an error worth showing. */
    async function fetchZhCache() {
      const response = await fetch(SKILL_ZH_ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const payload = await response.json()
      return payload === null || typeof payload !== 'object' || payload.value === null || typeof payload.value !== 'object'
        ? {}
        : payload.value
    }

    /** Ask the host to translate one batch; returns the merged cache. */
    async function translateZh(items) {
      const response = await fetch(SKILL_ZH_ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload === null || payload.ok !== true) {
        const reason = payload !== null && typeof payload.error === 'string' ? payload.error : 'HTTP ' + response.status
        throw new Error(reason)
      }
      return payload.value !== null && typeof payload.value === 'object' ? payload.value : {}
    }

    const SKILL_FAV_KEY = 'dsh-status-meter:skill-fav'
    const SKILL_RECENT_KEY = 'dsh-status-meter:skill-recent'
    const SKILL_RECENT_MAX = 24
    const SKILL_PIN_KEY = 'dsh-status-meter:skill-pin'

    /** The pin survives a reload: it is a working style, not a one-off. */
    function readSkillPin() {
      try {
        return window.localStorage.getItem(SKILL_PIN_KEY) === '1'
      } catch {
        return false
      }
    }

    function writeSkillPin(on) {
      try {
        window.localStorage.setItem(SKILL_PIN_KEY, on ? '1' : '0')
      } catch {
        /* private mode: the pin just does not persist */
      }
    }

    /** Last catalog per Session: `{ sessionId, at, skills }`. */
    let skillCache = null

    /** The tool whose calls carry a model-side skill load (`@deepseek-ai/dsh-tool-skill`). */
    const SKILL_TOOL = 'skill'
    /** Same gesture the host extracts from a human message (that package's SKILL_GESTURE). */
    const SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g
    /**
     * Chinese purpose lines for the skills installed here. The catalog only carries
     * each author's English `description`, and a picker is only useful when the row
     * says what the skill is for in the reader's language; anything not listed (a
     * built-in or newly installed skill) falls back to the catalog text.
     */
    const SKILL_ZH = {
      'ask-matt': '帮你判断该用哪个 skill／流程：技能路由器',
      brainstorming: '创作前先厘清意图与需求（头脑风暴）',
      'brand-design-md': '报品牌名自动抓设计规范并生成同风格 UI（62 个品牌）',
      'brand-guidelines': 'Anthropic 官方品牌色与字体规范',
      broadsheet: '报纸头版式排版：六栏网格、衬线大标题、报头',
      'canvas-design': '生成 png／pdf 静态视觉作品（海报、插画、艺术设计）',
      caveman: '极简压缩回复，省约 75% token，技术精度不变',
      'codebase-design': '深模块设计词汇：接口、接缝、可测性、可 AI 导航',
      'color-field-and-light': '背景色场：渐变／发光／颗粒／暗角／半调／scrim',
      'design-review-rubric': '出图前必过的自审：缩略图、灰阶、对比度、400% 边缘',
      'design-taste-frontend': '资深 UI／UX 前端规范：破默认 AI 审美、硬性度量规则',
      'dispatching-parallel-agents': '2 个以上互不依赖的任务并行分派',
      'domain-modeling': '梳理领域模型与术语，写 CONTEXT.md 与 ADR',
      'executing-plans': '按既定计划分阶段实施，带评审检查点',
      'finishing-a-development-branch': '实现完成后决定如何合入／收尾分支',
      'frontend-design': '有辨识度的前端视觉方向：排版、审美、非模板感',
      'git-guardrails-claude-code': '用 Claude Code hook 拦下危险 git 命令',
      'grill-me': '反复追问需求直到共识——需求模糊时必须先用',
      humanizer: '把 AI 腔改回人话：破对仗句式、金句收尾、硬凑三段、破折号、夸大用词',
      impeccable: '前端界面设计／审查／打磨全套：UX、层级、可访问性、动效、文案',
      implement: '按 spec 或工单实现一块工作',
      'improve-codebase-architecture': '扫描架构改进点，生成可视化 HTML 报告',
      'migrate-to-shoehorn': '把测试里的 as 类型断言迁到 shoehorn',
      ponytail: '最懒资深开发：最小完整改动，不写多余代码',
      'ponytail-audit': '全仓体检：bug、安全、真实负载、可删可并可拆',
      'ponytail-debt': '汇总代码里所有取巧注释，列出技术欠债',
      'ponytail-gain': '展示 ponytail 的实测节省数据',
      'ponytail-help': 'ponytail 用法速查',
      'ponytail-review': '单次改动审查：逻辑对不对、够不够快、每行是否必要',
      'poster-art-direction': '出图前必读的美术指导：海报、封面、图标、版式构图',
      prototype: '做一次性原型，验证状态模型或 UI 方向',
      'receiving-code-review': '收到评审意见后如何严谨处理而非盲从',
      'requesting-code-review': '完成任务或合并前请求代码评审',
      research: '用高可信一手资料调研，结论落成 Markdown 文件',
      'resolving-merge-conflicts': '处理进行中的合并／变基冲突',
      retro: '对本次编码会话做复盘',
      'ruic-motion-reel': '用代码生成 15 秒动态图形成片（可合成配乐）',
      'scaffold-exercises': '生成练习题目录结构，含解答与讲解',
      'setup-pre-commit': '配 Husky 与 lint-staged：格式化、类型检查、测试',
      'setup-ts-deep-modules': '用 dependency-cruiser 把 TS 仓约束成深模块',
      'subagent-driven-development': '在当前会话里用子代理执行独立任务',
      'swiss-international': '瑞士国际主义风格：网格、怪诞体、黑白加一红',
      'systematic-debugging': '遇 bug 或测试失败先系统性定位，再提修复方案',
      taste: '反套路前端：落地页、作品集、改版设计与上线前自检',
      teach: '在这个工作区里教你一个新技能或概念',
      'test-driven-development': '先写测试，再写实现',
      'theme-factory': '给幻灯片／文档／报告／落地页套主题（10 套预设或现生成）',
      'to-spec': '把当前对话直接整理成 spec 并发布到 issue',
      'to-tickets': '把计划／spec／对话拆成带依赖关系的工单',
      triage: '把 issue 与外部 PR 走状态机分流并写简报',
      'type-craft-cjk': '中英混排微排版：字体、字距、行高、标点，防豆腐块',
      'using-git-worktrees': '用 worktree 隔离工作区，再执行实施计划',
      'using-superpowers': '开场先建立「如何使用 skill」的规矩',
      'verification-before-completion': '声称完成前必须跑验证、拿证据',
      'wait-what': '刚才那段没听懂，重讲一遍',
      wizard: '生成交互式 bash 向导，带人走只有人类能做的步骤',
      'writing-beats': '写作·展开：把素材铺成一段段推进',
      'writing-for-agents': '写给 agent 看的文档：skill、AGENTS.md、CLAUDE.md',
      'writing-fragments': '写作·探索：先挖原始碎片，不搭结构',
      'writing-plans': '多步需求动代码前，先写实施计划',
      'writing-shape': '写作·成型：逐段把素材塑成文章',
      'writing-skills': '创建、修改、验证 skill',
      // Packaged skills: bundled with the harness, not in ~/.dsh/skills.
      'agent-experience': '写给模型的工具／技能定义规范：让信息可被发现、省上下文',
      'cordis-composition-reference': 'Cordis 组合参考：bundle patch 的 YAML 方言与可装插件包清单',
      'cordis-plugin-development': '在本 profile 里做插件／bundle／面板／工具／MCP 连接：设计、安装、启停、排错',
      'editing-cordis-compositions': '创建／修改／校验 agent preset 与其他 Cordis 组合',
      'diagnose-windows-sandbox-acl': 'Windows 沙箱拒绝访问时：诊断并修复路径 ACL',
      'office-docx': 'Word 文档（.docx）：创建、读取、编辑、检查，含报告与表格',
      'office-pptx': 'PowerPoint 演示（.pptx）：文字、表格、图片、图表',
      'office-xlsx': 'Excel 工作簿（.xlsx）：数据、公式、格式、pandas 分析',
      'dsh-badge': '给产出物加「powered by dsh」徽标（PR/MR、文档、可复用素材）',
      'hindsight-coding-agent': '本机 Hindsight 记忆系统：存记忆、知识页、按仓库配置',
      'apk-reverse': 'Android APK 逆向：解包、Java 反编译、smali 改、重打包、Frida 动态 Hook',
      'binary-diff': '两个二进制做差异对比（补丁分析／版本比对）',
      'browser-extension-reverse': '浏览器扩展逆向：manifest、后台脚本、content script、打包还原',
      'code-audit': '源码安全审计：Semgrep／CodeQL 规则、危险写法排查',
      'dotnet-reverse': '.NET／C# 二进制逆向：CLR 头、托管程序、NativeAOT、Sharp* 工具',
      'huashu-art-motion': '艺术动画：拆解复刻、风格配方、解说动画语法、按口播参数渲片段',
      'js-reverse': '前端 JS 逆向：签名链路定位、运行时采样、本地补环境复现',
      'protocol-reverse': '私有协议逆向：Protobuf／gRPC、WebSocket 帧、PCAP 取证',
      'reverse-engineering': '逆向总论：读懂混淆／加密／无符号的二进制',
      'reverse-skill-router': '逆向／渗透／恶意样本／移动端／固件／浏览器自动化：按场景分派技能',
      'scene-distillation-zine-v1-3': '把照片做成极简 zine 海报（只用原图元素，去氛围化）',
      'scenes-gathered-zine-v1-3': '把照片做成 3:5 竖版「拾景」zine 海报（保留真实摄影）',
      'thick-client': '桌面客户端安全测试：本地存储、更新通道、IPC、进程间信任',
      'browser-skill': '浏览器自动化：打开页面、点击、取页面内容（本机 bsk 工具）',
      office: '办公文件总入口：按需分派到 docx／pptx／xlsx 等子技能',
      'office-export-pdf': '把 Office 文档导出成 PDF',
      'office-recalculate': '重算 Excel 公式并回写结果',
      'office-render': '把 Office 文档渲染成图片／预览，用于核对版式',
    }

    /**
     * 「我现在要做什么」→ 该点哪些技能。每条只列最常用的一撮，桶内按常用度手排；
     * 一个技能只归一个桶（它最常被想起的那个场景）。没有归桶的会落到「其他」。
     */
    const SKILL_CATS = [
      {
        id: 'design',
        title: '做设计 / 出图',
        when: '做界面、海报、封面、品牌视觉：先定方向，再出图，最后自审',
        names: [
          'frontend-design',
          'taste',
          'impeccable',
          'design-taste-frontend',
          'poster-art-direction',
          'canvas-design',
          'design-review-rubric',
          'brand-design-md',
          'brand-guidelines',
          'type-craft-cjk',
          'color-field-and-light',
          'broadsheet',
          'swiss-international',
          'theme-factory',
          'scene-distillation-zine-v1-3',
          'scenes-gathered-zine-v1-3',
        ],
      },
      {
        id: 'code',
        title: '写代码',
        when: '要动代码：先规划再写，边写边验；重构／架构类也在这一桶',
        names: [
          'ponytail',
          'writing-plans',
          'implement',
          'prototype',
          'executing-plans',
          'test-driven-development',
          'systematic-debugging',
          'verification-before-completion',
          'codebase-design',
          'domain-modeling',
          'improve-codebase-architecture',
          'setup-ts-deep-modules',
          'setup-pre-commit',
          'migrate-to-shoehorn',
          'subagent-driven-development',
          'dispatching-parallel-agents',
          'wizard',
        ],
      },
      {
        id: 'review',
        title: '审查 / 收尾',
        when: '改完要体检、要合入、要拆分支：审查与分支收尾都在这一桶',
        names: [
          'ponytail-review',
          'ponytail-audit',
          'ponytail-debt',
          'code-audit',
          'requesting-code-review',
          'receiving-code-review',
          'finishing-a-development-branch',
          'resolving-merge-conflicts',
          'using-git-worktrees',
          'git-guardrails-claude-code',
          'retro',
          'triage',
        ],
      },
      {
        id: 'writing',
        title: '写东西 / 文案',
        when: '文案、文章、文档、需求单：先挖素材再成型，最后去 AI 腔',
        names: [
          'writing-fragments',
          'writing-beats',
          'writing-shape',
          'humanizer',
          'writing-for-agents',
          'writing-skills',
          'research',
          'to-spec',
          'to-tickets',
        ],
      },
      {
        id: 'video',
        title: '视频 / 动画',
        when: '要做成片、动效、动画解说：这两条负责镜头与节奏',
        names: ['huashu-art-motion', 'ruic-motion-reel'],
      },
      {
        id: 'office',
        title: '办公文件',
        when: 'Word／Excel／PPT：入口是 office，再按文件类型点子技能',
        names: [
          'office',
          'office-docx',
          'office-xlsx',
          'office-pptx',
          'office-export-pdf',
          'office-recalculate',
          'office-render',
        ],
      },
      {
        id: 'reverse',
        title: '逆向 / 安全',
        when: '拆包、逆向、漏洞分析：不确定从哪下手就先 reverse-skill-router',
        names: [
          'reverse-skill-router',
          'reverse-engineering',
          'apk-reverse',
          'js-reverse',
          'dotnet-reverse',
          'protocol-reverse',
          'browser-extension-reverse',
          'binary-diff',
          'thick-client',
          'diagnose-windows-sandbox-acl',
        ],
      },
      {
        id: 'utility',
        title: '通用 / 不确定用啥',
        when: '不知道选哪个、需求还含糊、想省 token：先点这几个',
        names: [
          'ask-matt',
          'grill-me',
          'brainstorming',
          'using-superpowers',
          'caveman',
          'wait-what',
          'teach',
          'scaffold-exercises',
          'browser-skill',
          'ponytail-help',
          'ponytail-gain',
        ],
      },
    ]

    /**
     * Keyword rules for skills the hand-written buckets do not know yet — a skill
     * installed tomorrow is guessed from its name/description instead of piling up
     * under 其他. Order matters: the specific trades claim their words before the
     * broad ones do (`code` appears in half of all descriptions).
     */
    const SKILL_CAT_RULES = [
      [/office|docx|xlsx|pptx|excel|powerpoint|\bword\b|\bpdf\b|表格|幻灯片/, '办公文件'],
      [/reverse|decompil|binary|\bapk\b|protocol|exploit|pentest|security|逆向|反编译|漏洞|抓包/, '逆向 / 安全'],
      [/video|motion|animat|reel|\bfilm\b|视频|动画|剪辑/, '视频 / 动画'],
      [/design|\bui\b|\bux\b|visual|poster|brand|typograph|palette|figma|layout|设计|排版|配色|海报|视觉|品牌/, '做设计 / 出图'],
      [/review|audit|lint|merge|\bgit\b|triage|retro|审查|审计|复盘|合并/, '审查 / 收尾'],
      [/writ|\bcopy\b|article|blog|humaniz|\bspec\b|ticket|文案|写作|文档|需求/, '写东西 / 文案'],
      [/code|implement|refactor|debug|\btest|plan|architect|typescript|python|代码|重构|调试|测试|架构|实现/, '写代码'],
    ]

    /** Guess from the words themselves; '' means "still 其他". */
    function skillCatGuess(name, description) {
      const hay = (String(name) + ' ' + String(description === null || description === undefined ? '' : description)).toLowerCase()
      for (const rule of SKILL_CAT_RULES) {
        if (rule[0].test(hay)) return rule[1]
      }
      return ''
    }

    /** The bucket of a catalogue row: hand-written first, keywords second. */
    function skillCatOf(row) {
      const known = skillCatTitleOf(row.name)
      return known !== '' ? known : skillCatGuess(row.name, row.description)
    }

    /** The bucket a skill belongs to (for filtering), or ''. */
    function skillCatTitleOf(name) {
      for (const cat of SKILL_CATS) {
        if (cat.names.indexOf(name) !== -1) return cat.title
      }
      return ''
    }

    /**
     * Group `rows` into SKILL_CATS order. Rows the list does not know (a skill
     * installed after this build) fall into a trailing 其他 bucket instead of
     * disappearing — the same courtesy the untranslated hint gives.
     */
    function skillCatSections(rows) {
      const byName = new Map(rows.map((row) => [row.name, row]))
      const seen = new Set()
      const sections = []
      for (const cat of SKILL_CATS) {
        const picked = []
        for (const name of cat.names) {
          const row = byName.get(name)
          if (row === undefined || seen.has(name)) continue
          seen.add(name)
          picked.push(row)
        }
        if (picked.length > 0) sections.push({ key: cat.id, title: cat.title, when: cat.when, rows: picked })
      }
      // Second pass: anything the paper list does not name, bucketed by keyword.
      const guessed = new Map(SKILL_CATS.map((cat) => [cat.title, []]))
      const rest = []
      for (const row of rows) {
        if (seen.has(row.name)) continue
        const title = skillCatGuess(row.name, row.description)
        const bucket = guessed.get(title)
        if (bucket === undefined) rest.push(row)
        else bucket.push(row)
      }
      const sectionsByTitle = new Map(sections.map((section) => [section.title, section]))
      for (const cat of SKILL_CATS) {
        const extra = guessed.get(cat.title)
        if (extra === undefined || extra.length === 0) continue
        const existing = sectionsByTitle.get(cat.title)
        if (existing === undefined) {
          sections.push({ key: cat.id, title: cat.title, when: cat.when, rows: extra })
        } else {
          existing.rows = existing.rows.concat(extra)
        }
      }
      if (rest.length > 0) sections.push({ key: 'other', title: '其他', when: '还没归类的新技能', rows: rest })
      return sections
    }

    const SKILL_BUTTON_STYLE = {
      display: 'inline-flex',
      alignItems: 'center',
      height: '22px',
      padding: '0 8px',
      marginRight: '6px',
      borderRadius: '999px',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '11px',
      lineHeight: '1',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
      userSelect: 'none',
    }
    const SKILL_BACKDROP_STYLE = {
      position: 'fixed',
      inset: '0',
      zIndex: 2147482999,
      background: 'transparent',
    }
    const SKILL_PANEL_STYLE = {
      position: 'fixed',
      width: '470px',
      maxWidth: 'calc(100vw - 24px)',
      // border-box so the computed cap (see the panel's inline maxHeight) is the
      // real on-screen height: content-box would add padding + border on top of it.
      boxSizing: 'border-box',
      maxHeight: '64vh',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      padding: '10px',
      border: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14))',
      borderRadius: '12px',
      background: 'var(--dsw-alias-bg-popover, #232427)',
      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
      zIndex: 2147483000,
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '12px',
      color: 'var(--dsw-alias-label-primary, rgba(255, 255, 255, 0.92))',
    }
    const SKILL_HEAD_STYLE = {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: '8px',
    }
    const SKILL_NOTE_STYLE = {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      margin: '2px 0 6px',
      color: 'var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.5))',
      fontSize: '11px',
      lineHeight: '18px',
    }
    const SKILL_FILTER_STYLE = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '6px 8px',
      border: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14))',
      borderRadius: '8px',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      outline: 'none',
    }
    const SKILL_LIST_STYLE = {
      display: 'flex',
      flexDirection: 'column',
      gap: '1px',
      overflowY: 'auto',
      minHeight: '0',
    }
    const SKILL_NAME_STYLE = {
      display: 'block',
      whiteSpace: 'nowrap',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '12px',
      color: 'var(--dsw-alias-brand-primary, #7aa2ff)',
    }
    const SKILL_DESC_STYLE = {
      flex: '1 1 auto',
      minWidth: '0',
      color: 'var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.55))',
      fontSize: '11px',
      lineHeight: '16px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }
    /** `/name` and its usage badge share one line; the purpose line sits under it. */
    const SKILL_GROUP_STYLE = {
      display: 'flex',
      flexDirection: 'column',
      gap: '1px',
      marginBottom: '10px',
    }
    const SKILL_GROUP_HEAD_STYLE = {
      // Sticky so the bucket title stays readable while scrolling a long bucket.
      position: 'sticky',
      top: '0',
      zIndex: '1',
      padding: '7px 8px 5px',
      background: 'var(--dsw-alias-bg-popover, #232427)',
      // A brand rule down the left edge: the head has to read as a section break,
      // not as one more line of text inside the list.
      boxShadow: 'inset 2px 0 0 0 var(--dsw-alias-brand-primary, #7aa2ff)',
    }
    const SKILL_GROUP_TITLE_STYLE = {
      display: 'flex',
      alignItems: 'baseline',
      gap: '6px',
      fontWeight: 700,
      fontSize: '12px',
      letterSpacing: '0.02em',
      color: 'var(--dsw-alias-brand-primary, #7aa2ff)',
    }
    const SKILL_GROUP_COUNT_STYLE = {
      fontWeight: 500,
      fontSize: '10px',
      padding: '0 6px',
      borderRadius: '999px',
      border: '1px solid var(--dsw-alias-border-l3, rgba(255,255,255,0.28))',
      color: 'var(--dsw-alias-label-tertiary, rgba(255,255,255,0.6))',
    }
    const SKILL_GROUP_WHEN_STYLE = {
      marginTop: '2px',
      paddingLeft: '2px',
      color: 'var(--dsw-alias-label-tertiary, rgba(255,255,255,0.55))',
      fontSize: '10.5px',
      lineHeight: '15px',
    }
    const SKILL_CATS_STYLE = {
      display: 'flex',
      flexWrap: 'nowrap',
      alignItems: 'center',
      gap: '0',
      margin: '0 0 4px',
      padding: '0',
      background: 'transparent',
    }
    const SKILL_TABS_STYLE = {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
    }
    const SKILL_ROW_MAIN_STYLE = {
      display: 'flex',
      alignItems: 'baseline',
      gap: '10px',
      flex: '1 1 auto',
      minWidth: '0',
      overflow: 'hidden',
    }
    /** 名字与徽标不许折行：折在长名字上会把整行排版撕开。 */
    const SKILL_ROW_TOP_STYLE = {
      display: 'flex',
      alignItems: 'baseline',
      gap: '6px',
      flex: '0 0 auto',
      whiteSpace: 'nowrap',
    }
    const SKILL_BADGE_NOW_STYLE = {
      padding: '0 5px',
      border: '1px solid var(--dsw-alias-brand-primary, #7aa2ff)',
      borderRadius: '999px',
      color: 'var(--dsw-alias-brand-primary, #7aa2ff)',
      fontSize: '10px',
      lineHeight: '14px',
      whiteSpace: 'nowrap',
    }
    const SKILL_BADGE_PAST_STYLE = {
      padding: '0 5px',
      border: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.18))',
      borderRadius: '999px',
      color: 'var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.5))',
      fontSize: '10px',
      lineHeight: '14px',
      whiteSpace: 'nowrap',
    }
    const SKILL_USED_LINE_STYLE = {
      color: 'var(--dsw-alias-brand-primary, #7aa2ff)',
      fontSize: '11px',
      whiteSpace: 'normal',
    }
    /** Hover has to be a class rule: inline styles cannot carry a pseudo-class. */
    const SKILL_PANEL_CSS = [
      '.dsh-skill-palette-row{display:flex;align-items:center;gap:4px;width:100%;box-sizing:border-box;padding:4px 8px;border:0;border-radius:8px;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}',
      '.dsh-skill-palette-row:hover{background:var(--dsw-alias-bg-l2, rgba(255,255,255,0.08))}',
      '.dsh-skill-palette-row:active{background:var(--dsw-alias-bg-l3, rgba(255,255,255,0.13))}',
      '.dsh-skill-palette-main{display:flex;align-items:baseline;gap:8px;flex:1 1 auto;min-width:0}',
      '.dsh-skill-palette-star{flex:0 0 auto;margin-left:2px;padding:0 2px;border:0;background:transparent;color:inherit;opacity:.3;cursor:pointer;font-size:12px;line-height:16px}',
      '.dsh-skill-palette-star:hover{opacity:.85}',
      '.dsh-skill-palette-star.is-on{opacity:1;color:var(--dsw-alias-brand-primary, #7aa2ff)}',
      '.dsh-skill-palette-pin{margin-left:auto;display:inline-flex;align-items:center;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,#8b8d94);cursor:pointer;transition:color .12s ease,opacity .12s ease}',
      '.dsh-skill-palette-pin:hover{color:var(--dsw-alias-label-secondary,#c9cbd1)}',
      '.dsh-skill-palette-pin.is-on{color:var(--color-blue-500,#4d6bfe)}',
      '.dsh-skill-palette-pin>svg{display:block;width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}',
      '.dsh-skill-palette-tab{padding:2px 9px;margin-right:2px;border:1px solid transparent;border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:12px;font-weight:500;line-height:17px;cursor:pointer;opacity:.52}',
      '.dsh-skill-palette-tab:hover{opacity:.85}',
      '.dsh-skill-palette-cat{padding:0 7px;border:0;border-left:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12));background:transparent;color:inherit;font:inherit;font-size:10.5px;line-height:15px;cursor:pointer;opacity:.5}',
      '.dsh-skill-palette-cat:first-child{padding-left:10px;border-left:0}',
      '.dsh-skill-palette-cat:hover{opacity:.85}',
      '.dsh-skill-palette-cat.is-on{opacity:1;background:transparent;box-shadow:none;color:var(--color-blue-500, #3b82f6);font-weight:600}',
      '.dsh-skill-palette-cat:focus,.dsh-skill-palette-tab:focus{outline:none}',
      '.dsh-skill-palette-cat:focus-visible,.dsh-skill-palette-tab:focus-visible{outline:none}',
      '.dsh-skill-palette-tab:hover{opacity:.95;background:var(--dsw-alias-bg-l2, rgba(255,255,255,0.08))}',
      '.dsh-skill-palette-zh{flex:0 0 auto;height:22px;padding:0 10px;border:0;border-radius:6px;background:var(--color-blue-500,#3b82f6);color:#fff;font:inherit;font-size:11px;font-weight:600;line-height:22px;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.28)}',
      '.dsh-skill-palette-zh:hover{background:color-mix(in oklab,var(--color-blue-500,#3b82f6) 84%,#000)}',
      '.dsh-skill-palette-zh:active{transform:translateY(1px)}',
      '.dsh-skill-palette-zh:focus-visible{outline:2px solid color-mix(in oklab,var(--color-blue-500,#3b82f6) 60%,transparent);outline-offset:1px}',
      '.dsh-skill-palette-zh:disabled{opacity:.55;cursor:default;transform:none}',
      '.dsh-skill-palette-tab.is-on{opacity:1;border-color:var(--dsw-alias-border-l3, rgba(255,255,255,0.3));color:var(--dsw-alias-brand-primary, #7aa2ff)}',
    ].join('')

    /**
     * The scope of `apply`'s dynamic `remote.skills` injection, once it resolves.
     * The catalog face is injected dynamically rather than declared in the plugin's
     * static list, so a host without that face still gets the meters instead of the
     * whole plugin staying pending.
     */
    let skillFaceScope = null

    /** The browser→host skill catalog face, or null while it is not mounted. */
    function skillsFaceOf(ctx) {
      const sources = []
      if (skillFaceScope !== null) sources.push(skillFaceScope)
      sources.push(ctx)
      for (const source of sources) {
        try {
          const remote = source.remote ?? (typeof source.get === 'function' ? source.get('remote') : undefined)
          const skills = remote === null || remote === undefined ? undefined : remote.skills
          if (skills !== null && skills !== undefined && typeof skills.list === 'function') return skills
        } catch {
          /* try the next source */
        }
      }
      return null
    }

    /**
     * The Session's human-invocable skills, cached for a minute per Session. `force`
     * skips that cache so a skill installed a moment ago shows up on the next open.
     */
    async function loadSkills(ctx, sessionId, force) {
      const now = Date.now()
      if (force !== true && skillCache !== null && skillCache.sessionId === sessionId && now - skillCache.at < SKILL_CACHE_MS) {
        return skillCache.skills
      }
      const skills = skillsFaceOf(ctx)
      if (skills === null) throw new Error('技能目录未就绪（remote.skills 未挂载），稍后再点一次')
      // `skills/list` declares cancellation (`{parameter:'signal'}`), so hand it a real one.
      const abort = new AbortController()
      const result = await skills.list({ sessionId }, abort.signal)
      if (result === null || result === undefined || result.ok !== true) {
        const failure = result === null || result === undefined ? null : asRecord(result.error)
        const code = failure === null || typeof failure.code !== 'string' ? 'unknown' : failure.code
        const detail = failure === null || typeof failure.message !== 'string' ? '' : ' ' + failure.message
        throw new Error('skills/list 失败：' + code + detail)
      }
      const value = asRecord(result.value)
      const list = value === null || !Array.isArray(value.skills) ? [] : value.skills
      const rows = []
      for (const raw of list) {
        const entry = asRecord(raw)
        if (entry === null || typeof entry.name !== 'string' || entry.name === '') continue
        rows.push({
          name: entry.name,
          description: typeof entry.description === 'string' ? entry.description : '',
          whenToUse: typeof entry.whenToUse === 'string' ? entry.whenToUse : '',
          modelInvocable: entry.modelInvocable === true,
        })
      }
      rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      skillCache = { sessionId, at: now, skills: rows }
      return rows
    }

    /** One JSON string[] out of localStorage; anything unexpected reads as empty. */
    function readSkillStore(key) {
      try {
        const raw = localStorage.getItem(key)
        const parsed = raw === null ? null : JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string' && item !== '') : []
      } catch {
        return []
      }
    }

    function writeSkillStore(key, list) {
      try {
        localStorage.setItem(key, JSON.stringify(list))
      } catch {
        /* a full quota must not break the picker */
      }
    }

    function readFav() {
      return readSkillStore(SKILL_FAV_KEY)
    }

    function writeFav(list) {
      writeSkillStore(SKILL_FAV_KEY, list)
    }

    /** Push `name` to the front of the recency log and persist it. */
    function touchSkillRecent(name) {
      const next = [name]
        .concat(readSkillStore(SKILL_RECENT_KEY).filter((item) => item !== name))
        .slice(0, SKILL_RECENT_MAX)
      writeSkillStore(SKILL_RECENT_KEY, next)
      return next
    }

    /** The visible composer editor (the last visible contenteditable), or null. */
    function composerEditor() {
      try {
        const nodes = document.querySelectorAll('[contenteditable="true"]')
        for (let i = nodes.length - 1; i >= 0; i -= 1) {
          if (nodes[i].getBoundingClientRect().height > 0) return nodes[i]
        }
      } catch {
        /* no editor reachable */
      }
      return null
    }

    /** Everything left of the caret inside `editor`, for the whitespace check. */
    function textBeforeCaret(editor) {
      try {
        const selection = window.getSelection()
        if (selection !== null && selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
          const range = document.createRange()
          range.selectNodeContents(editor)
          range.setEnd(selection.anchorNode, selection.anchorOffset)
          return range.toString()
        }
      } catch {
        /* fall through to the whole text */
      }
      return String(editor.innerText === undefined ? '' : editor.innerText)
    }

    /**
     * Type the gesture into the real editor. Going through the contenteditable
     * (rather than only the draft store) is what makes the core skill plugin
     * re-tokenise the draft, so `/name` turns into its blue chip at once.
     */
    function writeGesture(name) {
      const editor = composerEditor()
      if (editor === null) return false
      try {
        editor.focus()
        if (window.getSelection() !== null && (window.getSelection().rangeCount === 0 || !editor.contains(window.getSelection().anchorNode))) {
          const range = document.createRange()
          range.selectNodeContents(editor)
          range.collapse(false)
          window.getSelection().removeAllRanges()
          window.getSelection().addRange(range)
        }
      } catch {
        /* focus is best effort; the insert below still reports success */
      }
      const before = textBeforeCaret(editor)
      // The host only reads a gesture bounded by whitespace (see SKILL_GESTURE),
      // so a draft ending in a word would glue the slash onto it and stay plain text.
      const lead = before === '' || /[\s\u00a0]$/.test(before) ? '' : ' '
      try {
        return document.execCommand('insertText', false, lead + '/' + name + ' ')
      } catch {
        return false
      }
    }

    /** Put the caret back in the composer so a loaded gesture can be sent at once. */
    function focusComposer() {
      try {
        const nodes = document.querySelectorAll('[contenteditable="true"]')
        for (let i = nodes.length - 1; i >= 0; i -= 1) {
          const node = nodes[i]
          if (node.getBoundingClientRect().height > 0) {
            node.focus()
            return
          }
        }
      } catch {
        /* focus is a nicety: the gesture is already in the draft */
      }
    }

    /** How many catalog rows still only have the author's English line. */
    /** Chinese purpose when listed, otherwise the catalog's own line. */
    function skillChinese(name, description) {
      const zh = Object.prototype.hasOwnProperty.call(SKILL_ZH, name) ? SKILL_ZH[name] : ''
      return zh === '' ? String(description === null || description === undefined ? '' : description) : zh
    }

    /**
     * What to show under a skill name: the hand-written Chinese line, or — for a
     * skill nobody translated yet — the first sentence of its own description.
     * Those descriptions are sometimes a whole page; showing it raw turned the
     * picker into a wall of English that pushed the list off screen.
     */
    function skillDescOf(row) {
      const zh = zhLineOf(row.name)
      if (zh !== '') return zh
      const raw = String(row.description === null || row.description === undefined ? '' : row.description).replace(/\s+/g, ' ').trim()
      return raw.length > 80 ? raw.slice(0, 80) + '…' : raw
    }

    /** The skill a `skill` tool call asked for (`{"name":"..."}`), or null. */
    function skillNameInArgs(argsRaw) {
      if (typeof argsRaw !== 'string' || argsRaw === '') return null
      try {
        const parsed = JSON.parse(argsRaw)
        if (parsed !== null && typeof parsed === 'object' && typeof parsed.name === 'string' && parsed.name !== '') {
          return parsed.name.split('\n')[0]
        }
      } catch {
        /* a malformed call is not a skill load */
      }
      return null
    }


    function contentText(content) {
      if (!Array.isArray(content)) return ''
      let text = ''
      for (const block of content) {
        const record = asRecord(block)
        if (record !== null && record.type === 'text' && typeof record.text === 'string') text += record.text + '\n'
      }
      return text
    }

    /** `/name` gestures typed by the human (the same pattern the host matches). */
    function gesturesIn(text) {
      const names = []
      if (typeof text !== 'string' || text.indexOf('/') === -1) return names
      const pattern = new RegExp(SKILL_GESTURE.source, 'g')
      let match = pattern.exec(text)
      while (match !== null) {
        names.push(match[2])
        match = pattern.exec(text)
      }
      return names
    }

    /**
     * Skills this Session actually used: `/name` gestures in human messages plus the
     * names carried by `skill` tool calls. `current` is the tail after the newest
     * human message, i.e. the reply on screen.
     */
    function collectUsedSkills(nodes, partial) {
      const all = []
      const current = []
      const push = (bucket, name) => {
        if (typeof name !== 'string' || name === '' || bucket.indexOf(name) !== -1) return
        bucket.push(name)
      }
      const list = Array.isArray(nodes) ? nodes : []
      let humanSeq = -1
      for (const node of list) {
        const record = asRecord(node)
        if (record !== null && record.kind === 'user' && typeof record.seq === 'number' && record.seq > humanSeq) humanSeq = record.seq
      }
      for (const node of list) {
        const record = asRecord(node)
        if (record === null) continue
        const isCurrent = typeof record.seq === 'number' && humanSeq !== -1 && record.seq > humanSeq
        if (record.kind === 'user') {
          for (const name of gesturesIn(contentText(record.content))) {
            push(all, name)
            if (isCurrent) push(current, name)
          }
          continue
        }
        if (record.kind !== 'assistant' && record.kind !== 'tool-result') continue
        // A tool-result carries the call as `{name, argsRaw}`; an assistant node
        // carries its blocks. Both name the `skill` tool the same way.
        const blocks = record.kind === 'assistant' ? record.blocks : [record.call]
        if (!Array.isArray(blocks)) continue
        for (const block of blocks) {
          const cell = asRecord(block)
          if (cell === null || cell.name !== SKILL_TOOL) continue
          const name = skillNameInArgs(cell.argsRaw)
          push(all, name)
          if (isCurrent) push(current, name)
        }
      }
      const tail = asRecord(partial)
      const tailBlocks = tail !== null && Array.isArray(tail.blocks) ? tail.blocks : []
      for (const block of tailBlocks) {
        const cell = asRecord(block)
        if (cell === null || cell.kind !== 'tool-call' || cell.name !== SKILL_TOOL) continue
        const name = skillNameInArgs(cell.argsRaw)
        push(all, name)
        push(current, name)
      }
      return { all, current }
    }

    /**
     * Same walk, but bucketed per assistant node: the skills that had been used by
     * the time that node was produced. 回答下方那一排胶囊按 turnTail 给的 seq 取。
     */
    function collectUsedByTurn(nodes) {
      const out = new Map()
      const list = Array.isArray(nodes) ? nodes : []
      let bucket = []
      for (const node of list) {
        const record = asRecord(node)
        if (record === null) continue
        if (record.kind === 'user') {
          bucket = []
          for (const name of gesturesIn(contentText(record.content))) {
            if (bucket.indexOf(name) === -1) bucket.push(name)
          }
          continue
        }
        const blocks = record.kind === 'assistant' ? record.blocks : record.kind === 'tool-result' ? [record.call] : null
        if (blocks === null) continue
        if (!Array.isArray(blocks)) continue
        let touched = false
        for (const block of blocks) {
          const cell = asRecord(block)
          if (cell === null || cell.name !== SKILL_TOOL) continue
          const name = skillNameInArgs(cell.argsRaw)
          if (name !== null && bucket.indexOf(name) === -1) {
            bucket.push(name)
            touched = true
          }
        }
        if (record.kind === 'assistant' && (bucket.length > 0 || touched)) out.set(record.seq, bucket.slice())
      }
      return out
    }

    /** Stand-in for the chat hook before that target is mounted. */

    const EMPTY_SELECTOR_HOOK = () => null
    const selectChatNodes = (state) =>
      state === null || state === undefined || state.legacy === null || state.legacy === undefined ? null : state.legacy.nodes
    const selectChatPartial = (state) =>
      state === null || state === undefined || state.legacy === null || state.legacy === undefined ? null : state.legacy.partial

    /**
     * The skills the reply on screen ran, as a chip right of the composer. Hover
     * lists each name and its purpose; a reply that ran none renders nothing.
     */
    function UsedSkills(props) {
      ensureMeterCss()
      const kit = props ?? {}
      const loadRef = useRef(kit.loadSkills)
      loadRef.current = kit.loadSkills
      // The board's 本次回复已用 window: the tail after the newest human message.
      // The hook is called unconditionally; the stand-in returns null.
      const chatHook = typeof kit.useChat === 'function' ? kit.useChat : EMPTY_SELECTOR_HOOK
      const used = collectUsedSkills(chatHook(selectChatNodes), chatHook(selectChatPartial))
      const [settings] = useSettings()
      const names = used.current
      const key = names.join(' ')
      const [rows, setRows] = useState(null)
      const [spot, setSpot] = useState(null)
      const [tipAt, setTipAt] = useState(null)
      const [hover, setHover] = useState(false)
      const boxRef = useRef(null)
      useEffect(() => {
        if (key === '') return undefined
        let alive = true
        Promise.resolve()
          .then(() => (typeof loadRef.current === 'function' ? loadRef.current() : []))
          .then((catalog) => {
            if (alive && Array.isArray(catalog)) setRows(catalog)
          })
          .catch(() => {
            /* the pills still name the skills without their catalog lines */
          })
        return () => {
          alive = false
        }
      }, [key])
      // Outside the composer card, one pill per skill. The list runs downward first
      // and only wraps into a second column when the window runs out of room below,
      // so it never covers the box or leaves the viewport.
      useEffect(() => {
        if (key === '') return undefined
        let alive = true
        const place = () => {
          if (!alive) return
          const card = document.querySelector('[data-composer-card]')
          if (card === null) return
          const rect = card.getBoundingClientRect()
          const room = Math.round(window.innerWidth - rect.right)
          const floor = USED_PILL * 2 + 4
          // Beside the box the frame starts on the composer card's own top edge and
          // may grow no taller than the card, so it lines up with the input while it
          // still hugs a short list; longer lists fill the band, then wrap and scroll.
          setSpot(room >= USED_SIDE_ROOM
            ? { left: Math.round(rect.right + 10), top: Math.round(rect.top), maxHeight: Math.round(rect.height), maxWidth: Math.max(120, room - 20), overflow: 'auto' }
            : { right: Math.max(8, room), top: Math.round(rect.bottom + 6), maxHeight: Math.max(floor, Math.round(window.innerHeight - rect.bottom - 14)) })
        }
        place()
        window.addEventListener('resize', place)
        return () => {
          alive = false
          window.removeEventListener('resize', place)
        }
      }, [key])
      // The card hangs above the pills, so it is measured from the box itself and
      // follows the window while the pointer rests on the box.
      useEffect(() => {
        if (!hover) return undefined
        const fit = () => showTip()
        window.addEventListener('resize', fit)
        return () => window.removeEventListener('resize', fit)
      }, [hover])
      if (names.length === 0 || spot === null || !settings.pill) return null
      const line = new Map()
      for (const row of Array.isArray(rows) ? rows : []) {
        const cell = asRecord(row)
        if (cell !== null && typeof cell.name === 'string') line.set(cell.name, cell.description)
      }
      const tip = ['本次回复使用的技能']
      for (const name of names) tip.push('/' + name + ' — ' + skillChinese(name, line.get(name)))
      // A native title would drop downwards over the composer, so the card is
      // drawn above the box by hand, while the pointer is on it.
      const showTip = () => {
        const el = boxRef.current
        if (el === null) return
        const rect = el.getBoundingClientRect()
        const width = Math.min(USED_TIP_WIDTH, Math.max(200, window.innerWidth - 24))
        setTipAt({
          left: Math.max(8, Math.min(Math.round(rect.left), window.innerWidth - width - 8)),
          bottom: Math.max(8, Math.round(window.innerHeight - rect.top + 6)),
          width,
        })
      }
      return createElement(
        'div',
        {
          className: 'dsh-skill-palette-capsule dsh-used-box',
          ref: boxRef,
          style: { ...USED_FLOAT_STYLE, ...spot },
          onMouseEnter: () => {
            setHover(true)
            showTip()
          },
          onMouseLeave: () => setHover(false),
        },
        hover && tipAt !== null
          ? createElement(
              'div',
              { key: 'tip', role: 'tooltip', style: { ...USED_TIP_STYLE, ...tipAt } },
              tip.map((row, index) => createElement('div', { key: String(index), style: index === 0 ? USED_TIP_HEAD_STYLE : undefined }, row)),
            )
          : null,
        names.map((name) => createElement('span', { key: name, style: USED_NAME_STYLE }, name)),
      )
    }

    /**
     * The picker. `inputActions`/`useInput`/`useChat` are standard props of a
     * session-scope slot entry (the composer's input facade and the Chat target),
     * and `loadSkills` is injected from `apply` where the Session id is known.
     */
    function SkillPicker(props) {
      ensureMeterCss()
      const kit = props ?? {}
      const inputActions = kit.inputActions
      const useInput = kit.useInput
      const useChat = kit.useChat
      const load = kit.loadSkills
      // `useInput` is a standard prop of this seat. Without it the draft cannot be
      // read, so the append fallback is skipped rather than clobbering whatever the
      // user already typed.
      const canReadDraft = typeof useInput === 'function'
      const draft = canReadDraft ? useInput((state) => (state === null || state === undefined ? '' : state.draft)) : ''
      const [open, setOpen] = useState(false)
      const [query, setQuery] = useState('')
      const [skills, setSkills] = useState(null)
      // Bumped whenever the host hands back fresh translations, so the rows
      // re-render without copying the cache into component state.
      const [zhRev, setZhRev] = useState(0)
      const [zhBusy, setZhBusy] = useState(false)
      const [zhError, setZhError] = useState('')
      const [error, setError] = useState(null)
      const [anchor, setAnchor] = useState(null)
      // 'all' | 'recent' | 'fav' — one board, three orders.
      const [tab, setTab] = useState('all')
      const [cat, setCat] = useState('')
      const [pinned, setPinned] = useState(readSkillPin)
      const [fav, setFav] = useState(() => readFav())
      const [recent, setRecent] = useState(() => readSkillStore(SKILL_RECENT_KEY))
      const buttonRef = useRef(null)
      const loadRef = useRef(load)
      loadRef.current = load
      // The Chat target's own node window: what the Session actually ran. The
      // hook is called unconditionally (the stand-in returns null) because a
      // conditional hook call would break the seat's render order.
      const chatHook = typeof useChat === 'function' ? useChat : EMPTY_SELECTOR_HOOK
      const used = collectUsedSkills(chatHook(selectChatNodes), chatHook(selectChatPartial))
      const [settings] = useSettings()
      const byTurn = collectUsedByTurn(chatHook(selectChatNodes))
      const turnedRef = useRef('')
      useEffect(() => {
        const signature = JSON.stringify([...byTurn])
        if (signature === turnedRef.current) return
        turnedRef.current = signature
        publishUsedByTurn(byTurn)
      })

      // 开了「新技能自动翻译」：面板一打开就把缺的那几条翻掉，省一次点击。
      useEffect(() => {
        if (!settings.autoZh) return undefined
        if (skills === null || zhBusy) return undefined
        const timer = setTimeout(() => {
          const button = document.querySelector('.dsh-skill-palette-zh:not(:disabled)')
          if (button !== null) button.click()
        }, 500)
        return () => clearTimeout(timer)
      }, [settings.autoZh, skills, zhBusy])

      // Prefetch once on mount so opening the board does not start at "loading".
      useEffect(() => {
        let alive = true
        const run = loadRef.current
        Promise.resolve()
          .then(() => (typeof run === 'function' ? run() : []))
          .then((rows) => {
            if (alive && Array.isArray(rows)) setSkills((previous) => (previous === null ? rows : previous))
          })
          .catch(() => {
            /* the open-time load surfaces the error; prefetch stays silent */
          })
        return () => {
          alive = false
        }
      }, [])

      // The host owns the translated lines (they live on disk), so the panel
      // starts by asking it what it already has — no model call for those.
      useEffect(() => {
        let alive = true
        Promise.resolve()
          .then(() => fetchZhCache())
          .then((map) => {
            if (!alive) return
            SKILL_ZH_EXT = { ...SKILL_ZH_EXT, ...map }
            setZhRev((count) => count + 1)
          })
          .catch(() => {
            /* an older host without the route simply keeps the built-in table */
          })
        return () => {
          alive = false
        }
      }, [])

      useEffect(() => {
        if (!open) return undefined
        let alive = true
        const tick = () => {
          setError(null)
          const run = loadRef.current
          return Promise.resolve()
            .then(() => (typeof run === 'function' ? run(true) : []))
            .then((rows) => {
              if (alive) setSkills(Array.isArray(rows) ? rows : [])
            })
            .catch((reason) => {
              if (!alive) return
              setSkills([])
              setError(reason instanceof Error ? reason.message : String(reason))
            })
        }
        tick()
        // A skill installed while the board is open joins the list on the next tick,
        // without reopening the board.
        const id = setInterval(tick, SKILL_CACHE_MS)
        return () => {
          alive = false
          clearInterval(id)
        }
      }, [open])

      useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        window.addEventListener('keydown', onKey, true)
        const rect = buttonRef.current === null ? null : buttonRef.current.getBoundingClientRect()
        if (rect !== null) {
          setAnchor({
            bottom: Math.max(8, Math.round(window.innerHeight - rect.top + 8)),
            right: Math.max(8, Math.round(window.innerWidth - rect.right)),
          })
        }
        return () => window.removeEventListener('keydown', onKey, true)
      }, [open])

      /** Recent log + "a favourite you just used jumps to the front". */
      const rememberUse = (name) => {
        setRecent(touchSkillRecent(name))
        setFav((previous) => {
          if (previous.indexOf(name) === -1) return previous
          const next = [name].concat(previous.filter((item) => item !== name))
          writeFav(next)
          return next
        })
      }

      const toggleFav = (name) => {
        setFav((previous) => {
          const next = previous.indexOf(name) === -1 ? [name].concat(previous) : previous.filter((item) => item !== name)
          writeFav(next)
          return next
        })
      }

      /** Write the gesture into the composer: editor first, store next, clipboard last. */
      const choose = (name) => {
        const gesture = '/' + name + ' '
        rememberUse(name)
        let written = writeGesture(name)
        if (!written && inputActions !== null && inputActions !== undefined) {
          try {
            const span = typeof inputActions.captureInsertion === 'function' ? inputActions.captureInsertion() : null
            if (span !== null && span !== undefined && typeof inputActions.insertText === 'function') {
              written = inputActions.insertText(gesture, span) === true
            }
          } catch {
            written = false
          }
          if (!written && canReadDraft && typeof inputActions.setDraft === 'function') {
            try {
              const live = typeof draft === 'string' ? draft : ''
              const lead = live === '' || /[\s\u00a0]$/.test(live) ? '' : ' '
              inputActions.setDraft(live + lead + gesture)
              written = true
            } catch {
              written = false
            }
          }
        }
        if (!written) {
          // Last resort: the gesture still lands somewhere the user can use it.
          try {
            void navigator.clipboard?.writeText(gesture)
          } catch {
            /* nothing left to try */
          }
        }
        if (pinned) {
          // Pinned: stay open so the next skill can be picked straight away. The
          // caret already sits after the insertion, so the next one appends.
          setOpen(true)
        } else {
          setOpen(false)
          setQuery('')
          focusComposer()
        }
      }

      const button = createElement(
        'button',
        {
          key: 'button',
          ref: buttonRef,
          type: 'button',
          className: 'dsh-skill-palette-button',
          title: SKILL_TIP,
          'aria-expanded': open,
          onClick: () => setOpen(!open),
          style: SKILL_BUTTON_STYLE,
        },
        SKILL_LABEL,
      )
      const css = createElement('style', { key: 'css' }, METER_CSS)

      if (!open) return [css, button]
      if (anchor === null) return [css, button]

      const needle = query.trim().toLowerCase()
      const catalog = skills ?? []
      const byName = new Map(catalog.map((row) => [row.name, row]))
      // Favourites keep their own order (most recently used first); a name whose
      // skill was uninstalled simply drops out.
      const tabbed =
        tab === 'recent'
          ? recent.map((name) => byName.get(name)).filter((row) => row !== undefined)
          : tab === 'fav'
            ? fav.map((name) => byName.get(name)).filter((row) => row !== undefined)
            : catalog
      const matchRow = (row) => {
        if (needle === '') return true
        return (
          row.name.toLowerCase().includes(needle) ||
          row.description.toLowerCase().includes(needle) ||
          skillChinese(row.name, '').toLowerCase().includes(needle) ||
          skillCatTitleOf(row.name).toLowerCase().includes(needle)
        )
      }
      // A bucket chip narrows whatever list is showing (全部/最近/收藏 alike).
      const filtered = tabbed.filter(matchRow).filter((row) => cat === '' || skillCatOf(row) === cat)
      const renderRow = (row) => {
          const usedNow = used.current.indexOf(row.name) !== -1
          const usedBefore = !usedNow && used.all.indexOf(row.name) !== -1
          const top = [createElement('span', { key: 'name', style: SKILL_NAME_STYLE }, '/' + row.name)]
          if (usedNow || usedBefore) {
            top.push(
              createElement(
                'span',
                { key: 'badge', style: usedNow ? SKILL_BADGE_NOW_STYLE : SKILL_BADGE_PAST_STYLE },
                usedNow ? '本次回复已用' : '本会话已用',
              ),
            )
          }
          // `disable-model-invocation: true` in the skill's frontmatter: the model
          // will not reach for it on its own, only this board can load it.
          if (row.modelInvocable !== true) {
            top.push(createElement('span', { key: 'manual', style: SKILL_BADGE_PAST_STYLE }, '仅手动'))
          }
          const faved = fav.indexOf(row.name) !== -1
          return createElement(
            'div',
            {
              key: row.name,
              className: 'dsh-skill-palette-row',
              title: row.whenToUse === '' ? '/' + row.name : '/' + row.name + '\n' + row.whenToUse,
              onClick: () => choose(row.name),
              // Keep the caret where the click intends to write: a mousedown that
              // moved focus would drop the insertion point first.
              onMouseDown: (event) => event.preventDefault(),
            },
            [
              createElement(
                'div',
                { key: 'main', className: 'dsh-skill-palette-main', style: SKILL_ROW_MAIN_STYLE },
                [
                  createElement('div', { key: 'top', style: SKILL_ROW_TOP_STYLE }, top),
                  // Every row says what the skill is for in Chinese; the author's own
                  // line is the fallback for anything the map does not cover.
                  createElement(
                    'span',
                    { key: 'desc', className: 'dsh-skill-palette-desc', style: SKILL_DESC_STYLE },
                    skillDescOf(row),
                  ),
                ],
              ),
              createElement(
                'button',
                {
                  key: 'star',
                  type: 'button',
                  className: faved ? 'dsh-skill-palette-star is-on' : 'dsh-skill-palette-star',
                  title: faved ? '取消收藏' : '收藏（收藏页里每用一次会顶到最前）',
                  onMouseDown: (event) => event.stopPropagation(),
                  onClick: (event) => {
                    event.stopPropagation()
                    toggleFav(row.name)
                  },
                },
                faved ? '★' : '☆',
              ),
            ],
          )
      }
      const rows = filtered.map(renderRow)
      const sections = cat === '' && tab === 'all' ? skillCatSections(filtered) : null

      const usedLine =
        used.current.length === 0
          ? null
          : createElement('div', { key: 'used', style: SKILL_USED_LINE_STYLE }, '本次回复已用：' + used.current.join('、'))

      const pinButton = createElement(
        'button',
        {
          key: 'pin',
          type: 'button',
          className: pinned ? 'dsh-skill-palette-pin is-on' : 'dsh-skill-palette-pin',
          title: pinned ? '已钉住：选完不收起面板，可以连着点' : '钉住面板：选完不收起，能连续点几个技能',
          onMouseDown: (event) => event.stopPropagation(),
          onClick: () => {
            const next = !pinned
            setPinned(next)
            writeSkillPin(next)
          },
        },
        createElement(
          'svg',
          { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
          createElement('path', {
            d: 'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 0-2H8a1 1 0 0 0 0 2 1 1 0 0 1 1 1z',
          }),
        ),
      )

      const head = createElement('div', { key: 'head', style: SKILL_HEAD_STYLE }, [
        createElement('span', { key: 'title', style: { fontWeight: 600 } }, SKILL_LABEL + (skills === null ? '' : ' · ' + filtered.length)),
        pinButton,
        // Only the degraded case speaks up; the normal hint was just corner noise.
        inputActions === null || inputActions === undefined
          ? createElement('span', { key: 'note', style: SKILL_NOTE_STYLE }, '输入框接口未注入：点选只复制 /名称')
          : null,
      ])

      const tabs = createElement(
        'div',
        { key: 'tabs', style: SKILL_TABS_STYLE },
        [
          ['all', '全部'],
          ['recent', '最近'],
          ['fav', '收藏' + (fav.length === 0 ? '' : ' · ' + fav.length)],
        ].map((pair) =>
          createElement(
            'button',
            {
              key: pair[0],
              type: 'button',
              className: tab === pair[0] ? 'dsh-skill-palette-tab is-on' : 'dsh-skill-palette-tab',
              onClick: () => setTab(pair[0]),
            },
            pair[1],
          ),
        ),
      )

      // Second row: the buckets as chips, so "我在做什么" is one click and the
      // list below holds nothing else.
      const cats = createElement(
        'div',
        { key: 'cats', style: SKILL_CATS_STYLE },
        [['', '全部']]
          .concat(SKILL_CATS.map((item) => [item.title, item.title.split(' / ')[0]]))
          .map((pair) =>
            createElement(
              'button',
              {
                key: pair[0] === '' ? 'all' : pair[0],
                type: 'button',
                className: cat === pair[0] ? 'dsh-skill-palette-cat is-on' : 'dsh-skill-palette-cat',
                onClick: () => setCat(pair[0]),
              },
              pair[1],
            ),
          ),
      )

      const missingZh = catalog.filter((row) => !hasZh(row.name))
      const runTranslate = () => {
        if (zhBusy || missingZh.length === 0) return
        setZhBusy(true)
        setZhError('')
        const items = missingZh.map((row) => ({
          name: row.name,
          description: String(row.description === null || row.description === undefined ? '' : row.description),
        }))
        const step = (index) => {
          if (index >= items.length) return Promise.resolve()
          return translateZh(items.slice(index, index + SKILL_ZH_BATCH)).then((map) => {
            SKILL_ZH_EXT = { ...SKILL_ZH_EXT, ...map }
            setZhRev((count) => count + 1)
            return step(index + SKILL_ZH_BATCH)
          })
        }
        Promise.resolve()
          .then(() => step(0))
          .catch((error) => setZhError(String(error?.message ?? error)))
          .then(() => setZhBusy(false))
      }
      const untranslatedLine =
        missingZh.length === 0 || !settings.zhNotice
          ? null
          : createElement(
              'div',
              { key: 'untranslated', style: SKILL_NOTE_STYLE },
              [
                createElement('span', { key: 'text' }, zhBusy ? '正在翻译 ' + missingZh.length + ' 条…' : missingZh.length + ' 个技能还没有中文说明'),
                createElement(
                  'button',
                  {
                    key: 'go',
                    type: 'button',
                    className: 'dsh-skill-palette-zh',
                    disabled: zhBusy,
                    onClick: runTranslate,
                  },
                  zhBusy ? '翻译中…' : '翻译 ' + missingZh.length + ' 条',
                ),
                zhError === '' ? null : createElement('span', { key: 'err', style: { opacity: 0.75 } }, '失败：' + zhError),
              ],
            )

      const filter = createElement('input', {
        key: 'filter',
        type: 'text',
        value: query,
        placeholder: '筛选…',
        autoFocus: true,
        onChange: (event) => setQuery(event.target.value),
        style: SKILL_FILTER_STYLE,
      })

      const body =
        error !== null
          ? createElement('div', { key: 'error', style: { color: 'var(--dsw-alias-label-tertiary, rgba(255,255,255,0.6))' } }, error)
          : skills === null
            ? createElement('div', { key: 'loading', style: SKILL_NOTE_STYLE }, '加载中…')
            : filtered.length === 0
              ? createElement('div', { key: 'empty', style: SKILL_NOTE_STYLE }, '没有匹配的技能')
              : sections !== null
                ? createElement(
                    'div',
                    { key: 'list', style: SKILL_LIST_STYLE },
                    sections.map((section) =>
                      createElement('div', { key: section.key, style: SKILL_GROUP_STYLE }, [
                        createElement('div', { key: 'head', className: 'dsh-skill-palette-group-head', style: SKILL_GROUP_HEAD_STYLE }, [
                          createElement('div', { key: 'title', style: SKILL_GROUP_TITLE_STYLE }, [
                            createElement('span', { key: 'name' }, section.title),
                            createElement('span', { key: 'count', style: SKILL_GROUP_COUNT_STYLE }, String(section.rows.length)),
                          ]),
                          section.when === ''
                            ? null
                            : createElement('div', { key: 'when', style: SKILL_GROUP_WHEN_STYLE }, section.when),
                        ]),
                      ].concat(section.rows.map(renderRow))),
                    ),
                  )
                : createElement('div', { key: 'list', style: SKILL_LIST_STYLE }, rows)

      const panel = createElement(
        'div',
        {
          key: 'panel',
          className: 'dsh-skill-palette-panel',
          style: Object.assign({}, SKILL_PANEL_STYLE, {
            bottom: anchor.bottom + 'px',
            right: anchor.right + 'px',
            // Anchored above the composer, so the cap has to shrink with the room
            // actually left above the button — otherwise the taller board (tabs +
            // hint line) runs off the top of the window.
            maxHeight: Math.max(240, Math.min(560, window.innerHeight - anchor.bottom - 24)) + 'px',
          }),
        },
        [createElement('style', { key: 'css' }, SKILL_PANEL_CSS), head, tabs, cats, untranslatedLine, usedLine, filter, body],
      )

      const backdrop = createElement('div', {
        key: 'backdrop',
        style: SKILL_BACKDROP_STYLE,
        onMouseDown: () => setOpen(false),
      })

      return [css, button, backdrop, panel]
    }

    /**
     * The directory store as a uSES-safe snapshot. `ctx.modelDirectories` is
     * injected per Session (`directoryFor(sessionId).store`); without it the
     * meter still renders, it just cannot highlight.
     */

    /** 回答末尾那一排：这一轮真正跑过的技能。 */
    function TurnSkillChips(props) {
      ensureMeterCss()
      const seq = typeof props?.seq === 'number' ? props.seq : -1
      const names = useUsedByTurn(seq)
      const [settings] = useSettings()
      if (!settings.turnChips || names.length === 0) return null
      return createElement(
        'div',
        { className: 'dsh-skill-turn' },
        names.map((name) => {
          const zh = zhLineOf(name)
          return createElement(
            'span',
            { key: name, className: 'dsh-skill-turn-chip', title: zh === '' ? '/' + name : zh },
            '/' + name,
          )
        }),
      )
    }

    /* ---------- 设置页：一个分区，四个开关 + 清缓存 ---------- */

    function SettingsSection() {
      ensureMeterCss()
      const [settings, patch] = useSettings()
      const [cacheCount, setCacheCount] = useState(null)
      const [clearing, setClearing] = useState(false)

      useEffect(() => {
        let alive = true
        fetchZhCache()
          .then((map) => {
            if (alive) setCacheCount(Object.keys(asRecord(map) ?? {}).length)
          })
          .catch(() => {
            if (alive) setCacheCount(null)
          })
        return () => {
          alive = false
        }
      }, [])

      const row = (label, hint, value, onChange) =>
        createElement(
          'div',
          { key: label, className: 'dsh-sp-row' },
          createElement(
            'div',
            { className: 'dsh-sp-text' },
            createElement('div', { className: 'dsh-sp-label' }, label),
            createElement('div', { className: 'dsh-sp-hint' }, hint),
          ),
          createElement(
            'button',
            {
              type: 'button',
              className: value ? 'dsh-sp-sw is-on' : 'dsh-sp-sw',
              'aria-pressed': value ? 'true' : 'false',
              onClick: () => onChange(!value),
            },
            createElement('span', { className: 'dsh-sp-knob' }),
          ),
        )

      const clear = () => {
        setClearing(true)
        fetch(SKILL_ZH_ROUTE, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clear: true }),
        })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error('HTTP ' + response.status))))
          .then(() => {
            SKILL_ZH_EXT = {}
            setCacheCount(0)
          })
          .catch(() => {
            /* 清不掉就保持原样，按钮可再点 */
          })
          .then(() => setClearing(false))
      }

      return createElement(
        'div',
        { className: 'dsh-sp-wrap' },
        createElement('h3', { className: 'dsh-sp-title' }, '技能调色板'),
        createElement(
          'p',
          { className: 'dsh-sp-note' },
          '技能按钮、收藏与最近使用都在输入框右侧；下面这些开关只管显示方式。',
        ),
        row(
          '输入框右侧显示本次回复用到的技能',
          '就是「技能」按钮左边那颗胶囊。关掉后只留按钮。',
          settings.pill,
          (next) => patch({ pill: next }),
        ),
        row(
          '回答下方显示这一轮用到的技能',
          '每条回答末尾一行小胶囊，鼠标停上去看它是干什么的。',
          settings.turnChips,
          (next) => patch({ turnChips: next }),
        ),
        row(
          '显示「N 个技能还没有中文说明」',
          '关掉后不提示，也不显示翻译按钮；技能照常显示英文说明。',
          settings.zhNotice,
          (next) => patch({ zhNotice: next }),
        ),
        row(
          '新技能自动翻译',
          '打开面板时自动把缺中文的那几条翻掉，仍然走同一个模型、同一份缓存。',
          settings.autoZh,
          (next) => patch({ autoZh: next }),
        ),
        createElement(
          'div',
          { className: 'dsh-sp-foot' },
          createElement(
            'span',
            { className: 'dsh-sp-hint' },
            cacheCount === null ? '翻译缓存：读不到' : '翻译缓存：' + cacheCount + ' 条（存在 skill-zh.json）',
          ),
          createElement(
            'button',
            { type: 'button', className: 'dsh-sp-btn', disabled: clearing, onClick: clear },
            clearing ? '清理中…' : '清空翻译缓存',
          ),
        ),
      )
    }

    function apply(ctx) {
      const slots = ctx.slots ?? (typeof ctx.get === 'function' ? ctx.get('slots') : undefined)
      if (slots === undefined || slots === null || typeof slots.inject !== 'function') return
      const injectDirectories = typeof ctx.inject === 'function' ? ctx.inject.bind(ctx) : null
      if (injectDirectories === null) return
      // 技能目录在 remote.skills 后面，单独注入：宿主没有这张脸时不影响按钮挂载。
      ctx.effect(
        () =>
          injectDirectories(['remote', 'remote.skills'], (scope) => {
            skillFaceScope = scope
          }),
        'dsh-skill-palette: skill catalog face',
      )
      ctx.effect(
        () =>
          injectDirectories(['slots'], (scope) => {
            scope.slots.inject('settings.section', () =>
              scope.slots.register(
                { name: 'settings.section', id: 'dsh-skill-palette', order: 930, label: () => '技能调色板' },
                SettingsSection,
              ),
            )
            scope.slots.inject('conversation.chat.turnTail', () =>
              scope.slots.register(
                { name: 'conversation.chat.turnTail', id: 'dsh-skill-palette-used', order: 8, label: () => '本轮技能' },
                TurnSkillChips,
              ),
            )
            scope.slots.inject(RIGHT_SLOT, () =>
              scope.slots.register(
                {
                  name: RIGHT_SLOT,
                  id: SKILL_ID,
                  order: SKILL_ORDER,
                  label: SKILL_LABEL,
                  inject: (sessionId) => ({ loadSkills: (force) => loadSkills(ctx, sessionId, force) }),
                },
                SkillPicker,
              ),
            )
            scope.slots.inject(RIGHT_SLOT, () =>
              scope.slots.register(
                {
                  name: RIGHT_SLOT,
                  id: USED_ID,
                  order: USED_ORDER,
                  label: USED_LABEL,
                  inject: (sessionId) => ({ loadSkills: (force) => loadSkills(ctx, sessionId, force) }),
                },
                UsedSkills,
              ),
            )
          }),
        'dsh-skill-palette: composer right seat',
      )
    }

    exports.name = 'dsh-skill-palette'
    exports.inject = ['slots']
    exports.apply = apply

    return module.exports
  },
})
