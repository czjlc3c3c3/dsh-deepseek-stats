# dsh-deepseek-stats（DeepSeek 余额/用量浮窗）

DeepSeek 账户「余额 / 用量」实时浮窗插件（DSH 长期生效版）：页面右上角悬浮卡片，展示官方余额、今日 token 消耗与峰谷计价成本，官方价目自动同步。

## 功能一览

- **排障**：余额取不到时，卡片会显示一行「诊断：账号服务 可见/不可见 · 账号登录态 … · 宿主账号凭据 有/无 · Key 有/无 · client版本 …」，宿主同时写日志 `[deepseek-stats] 余额通道诊断: {...}`，`/state.balanceDiag` 有完整字段；页脚显示插件版本号便于确认是否已热更。
- **官方余额（双通道）**：① Web/自建部署走 API Key——`DEEPSEEK_API_KEY` 经 DSH 凭据通道读取（不进浏览器），直连 `api.deepseek.com/user/balance`；② **DSH 桌面端**（登录官方账号、无 API Key）自动回落到官方账号通道 `ctx.deepseekAccount.getBalance(client)`，语义映射 `value`=充值余额、`bonusWallets`=赠金余额，卡片展示总额＝两者之和。15 秒缓存，点击 ⟳ 强制刷新（2 秒冷却，旋转反馈）；「价源」行会标注当前「余额源 API Key / 官方账号」。
- **今日消耗可视化（v1.4.0）**：详细页用**成本占比环形图**代替文字堆叠——中心是今日总成本（含 Search/Fetch）与 tokens；外环按**成本**分段（≤4 个模型 + 「其他 n 个」，Search/Fetch 有成本时单独一段）；右侧图例显示色点/短名/金额·占比，与环段双向联动；**悬停**环段或图例显示占比/成本/tokens/步数，悬停中心显示「模型 / Search-Fetch / 未计价」拆分；免费期 Search/Fetch 不进环、只在图例末行灰字显示次数与计费起始；未计价模型不入环并提示「另有 N 步未计价」。
- **今日用量**：宿主监听 `session/event` 的 `assistant/message`（含 `usage`）实时累加；启动时回填当日已落库事件——**按会话日志 mtime 预筛「今日活跃会话」**（长寿命会话不会因"创建得早"被漏掉），存储布局/服务不可识别时回退全量（上限 500 个会话）；按北京时间午夜自动滚动。展开卡片可见「回填」覆盖行（模式/候选/成功/折叠条数），`/state` 里对应 `backfill` 字段。
- **峰谷计价**：高峰时段 = 北京时间 周一至周五（**不含中国法定节假日**）09:00–12:00 / 14:00–18:00（价格 ×官方倍率，默认 2）；其余时段**包括周末与法定节假日全天、调休上班日**均为空闲 ×1（官方 2026-09 页脚注口径）。按每条消息发起时刻计价；缓存命中 / 未命中 / 缓存写 / 输出分档；未知模型不计价并在界面标注。内置价目（2026-09-10 官方）：`deepseek-flash` 0.02 / 1 / 4、`deepseek-v4-pro` 0.15 / 4.5 / 13.5（元/百万 tokens，空闲时段；高峰 ×2）。旧名 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 与已转正的实验名 `deepseek-v4.1-flash-expires-on-0910` 均按 `deepseek-flash` 计价；名称含 `flash` / `pro` 的未知变体分别按 flash / pro 价兜底。
- **节假日表**：内置 2026 全年（33 天法定休假日 + 6 个调休上班日），并按日从 `holiday-cn`（国务院公告口径数据集）同步当年与次年安排；同步失败保留内置表；卡片「价源」行会标注「节假日源 官方数据集 / 内置」。
- **官方价目自动同步**：启动时 + 每 6 小时抓取官方价目页并解析；**列数自适应**（列名取自表头，官方增删模型无需改代码）；失败回落内置价，并以「启动后 30 秒 → 2 分钟 → 8 分钟」退避重试；展开卡片可查看「价源」行（官方 / 内置）。
- **时段进度环**：卡片头部为动态圆环——绿色＝空闲、红色＝高峰，环弧代表当前时段剩余时间比例，悬停显示倍率与剩余时长。
- **交互**：标题栏可拖拽；▾ 收起为一行摘要（余额 + 今日消耗），▸ 展开为完整详情；每 10 秒自动刷新。

## 目录结构

```
dsh-deepseek-stats/
├── package.json        # 包名、dsh.bundle.patch / dsh.client 元信息
├── cordis.patch.yml    # bundle 补丁：自动注册 deepseek-stats 插件行
├── README.md
└── lib/
    ├── index.js        # 宿主半身（ESM 插件，直连官方接口 / 价目同步 / 用量折叠）
    └── client.js       # 客户端半身（__ModuleLoader__ 协议，浮窗 UI）
```

## 安装（其他 DSH 用户 / 其他机器）

```bash
# 1. 在 profile 目录安装（pnpm 直接安装 GitHub 仓库）
cd ~/.dsh/profiles/web
pnpm add github:czjlc3c3c3/dsh-deepseek-stats#semver:^1.0.0

# 2. 登记为 bundle：确保 ~/.dsh/profiles/web/package.json 的
#    dsh.profile.bundles 数组包含 "dsh-deepseek-stats"（首次安装需手动加一次）

# 3. 重启 DSH web 进程，浏览器硬刷新（Ctrl+Shift+R）
```

包内 `cordis.patch.yml`（由 `dsh.bundle.patch` 声明）会在 profile 组装时自动插入插件行，无需手动修改 `cordis.yml`。

更新：`cd ~/.dsh/profiles/web && pnpm update dsh-deepseek-stats` 后重启（`#semver:^1.0.0` 会自动取最新版本的 git tag）。

## 本地开发（改完重启即生效）

在仓库根目录执行 `pnpm link` 接入本机（或在 profile 的 `node_modules` 里用软链接指向仓库根目录），重启 DSH；改动提交推送 GitHub 后，其他用户 `pnpm update` 即可同步。

## 接口（宿主路由）

| 路由 | 说明 |
|---|---|
| `GET /plugins/deepseek-stats/state` | 完整快照（余额 15 秒缓存 + 今日用量 + 时段 + 价源） |
| `GET /plugins/deepseek-stats/refresh` | 强制刷新余额（2 秒冷却） |

## 兼容性（DSH 版本 / 桌面端）

- **已验证**：DSH **0.1.7-rc.2**、**0.2.0-rc.1**、**0.2.0-rc.2**、**0.2.1-alpha.1**、**0.2.1-rc.2**（Web profile，另见下方桌面端）上功能完整——宿主 `session/event` 载荷（`(session, event)` + `assistant/message.usage`）、`TokenUsage` 字段、`credentials.resolve`、`webServer.register`（`:326`）、`sessionPersistence.root` / `dshHomePath`、会话日志布局 `…/<id>/session.v4.jsonl.zstd`、客户端 `__ModuleLoader__` 协议与 `shell.overlay` 槽位、bundle 路由 `plugins/??<id>/client.js&rev=…` 均未变。
- **变更面核查方式**：一律用「两版本 npm tarball 逐包 diff」（`https://registry.npmjs.org/@deepseek-ai/<pkg>/-/<pkg>-<ver>.tgz`），关键函数直接按区间取 md5 比对是否逐字节相同。0.2.1-rc.2 相对 alpha.1：新增 `engines.dsh` 门禁语义、客户端 **release 门禁**、`job/*` 与 `working-directory/change` 事件类型、`remote-access` 与 `working-directory`/`tool-working-directory` 服务行、若干 experimental bundle（plugin-market / ralph / session-search / session-titles / terminal / tool-worktree / cot-translation / badge-skill），移除 webhook 与 hooks-* 包；**本插件依赖的接口全部未变**。
- **用量事件**：DSH 里只有 `assistant/message` 带 `usage`；`assistant/attempt`（失败/重试/取消的尝试）**按类型不带 usage**，本机历史日志 71 条 attempt 亦未见用量记录——故按 `assistant/message` 折叠即为完整口径。
- **Search / Fetch 计费（v1.3.0 起，v1.4.3 修正）**：官方 Search / Fetch API 各 **5 元 / 1000 次成功请求**（¥0.005/次，固定单价、不乘峰谷）。**走独立 API（`deepseek-search-api` / `deepseek-fetch-api`）时按价格表立即计费**（C 2026-10-19 以控制台"tool-fetch 已计费"证实）；**11-01 00:00 只针对「服务端工具」路径**（`deepseek-official`），且该路径搜索次数被适配器丢弃、DSH 拿不到——插件对它只计数、不估算费用（卡片灰字注明）。本地抓取（`http`）不计费。插件按会话事件统计：`web_search` 按 `arguments.queries` 条数计（每条查询=一次 provider 请求），`web_fetch` 每次计 1；`tool/result` 有 `error` 字段=失败、成功但无结果=工具输出 `No results found.`，两者均不计费。**仅当 web provider 是独立 API（`deepseek-search-api` / `deepseek-fetch-api`）时计入成本**；DSH 默认组合（`deepseek-official` 服务端工具 + `http` 本地抓取）只计数不计费（服务端工具 2026-11-01 起才收费）。卡片显示次数、计费数与「模型 + Search/Fetch」合计；`/state.websearch` 有完整计数与口径。
  - 边界：多查询调用中任一查询失败会**整体中止**（已成功的查询已被计费但事件里看不出条数 → 少计）；切回服务端工具路径后（2026-11-01 起收费）次数**无法精确获得**（DSH 丢弃该用量的 `server_tool_use` 计数）。
- **回填策略**：按会话日志 mtime 预筛「今日活跃会话」；**布局不可识别**时全量兜底（上限 500），**布局已识别但今日无日志写入**时直接跳过（`/state.backfill.skippedEmpty`）——不会为此把全部会话重放校验一遍。
- **经反代/发布 URL 访问**：DSH 对外入口（manager 3080、或 nginx/tailnet）为**全路径转发**，`/plugins/*` 无需额外配置即可到达；客户端一律相对路径取数，`dsh web --public-url` 不影响本插件。
- **插件兼容门禁（重要，本插件安全通过）**：DSH 0.2.0 起，profile 组装时会核对每个 bundle 声明的 DSH 版本要求，**不匹配则该 bundle 被整体跳过**（启动日志：`dsh: skipping profile bundle "<name>": Error: Plugin <pkg>@<ver> is incompatible with dsh <runtime>…`）。
  - **0.2.1-rc.2 起语义更新**：优先看 `package.json` 的 **`engines.dsh`** 范围（声明了它就**只按它判定、忽略 peerDependencies**）；没有 `engines.dsh` 才回落到 `peerDependencies` 里的 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`；**两者都没有则直接放行**。判定函数 `unmetRequirements`（`dsh-app-boot`），结果字段由 `peers` 改为 `requirements`。
  - 本插件只声明 `engines.node`（**无 `engines.dsh`、无 `@deepseek-ai/*` peerDependencies**），门禁因此总是放行——0.2.0-rc.1 / 0.2.1-alpha.1 / 0.2.1-rc.2 实测均未出现在跳过名单，功能完整。
  - 若将来要"声明支持范围"，可改用 **`engines.dsh` 的纯下界范围**（如 `">=0.1.7-rc.2"`）：新版本永远满足、不会因升级被跳过，但注意 semver 预发布语义（`-rc.N` 版本对 `>=` 范围的匹配需实测确认），改完必须重启并在日志里确认未被跳过。
  - **客户端 release 门禁（0.2.1-rc.2 新增，插件无需适配）**：客户端模块图携带 `WebBootRelease {version, commit}`；页面启动时的图与随后连上的 Host 版本不一致时，**图不会被应用**，更新暂停到"Host 回到该 release 或页面重载"。含义：**DSH 升级后已打开的标签页要刷新**才会换上新前端/新插件 bundle。插件侧无需声明任何东西（该字段由 Host 图携带，可选）。
  - **维护不变量：不要给本插件添加 `@deepseek-ai/dsh-*` 的 peerDependencies**。一旦声明门禁就会开始校验，范围写窄就会像其它插件那样在 DSH 升级后被**静默跳过**（同机 `dsh-mnemon`、`dsh-zotero`、`dsh-plugin-writing-guard` 即因此被跳过）。
  - 核查：`grep 'skipping profile bundle' <DSH 启动日志> | grep deepseek-stats`（无输出=已加载；也可看日志里有否插件的 `[deepseek-stats]` 行）。
  - 万一将来被跳过：用 `dsh plugin allow-version` 或插件管理器授予**精确版本豁免**（写入该 profile 的 `compatibility.json`，形如 `{"<pkg>@<ver>": ["<DSH 版本>"]}`），再重启；桌面端由应用管理，豁免须在桌面端侧授予。
- **桌面端（Electron）实测 ✅**：桌面端**能正常加载本插件**（宿主半身 + 客户端半身都生效，浮窗出现）；余额走官方账号通道（登录官方账号即可，无需 `DEEPSEEK_API_KEY`，v1.2.0 起支持，实测正常）。桌面端使用**保留 profile 名 `desktop`**，外部 CLI 明确拒绝管理（`error: profile "desktop" is managed exclusively by the Electron application`）；**0.2.0-rc.2 起改由 Desktop 应用内置命令运行时管理该 profile 的插件操作** → 桌面端安装/更新本插件请走**应用内的插件入口或内置命令**。⚠️ **桌面端更新插件后必须重启桌面应用**：宿主半身只在应用启动时装载、桌面端没有热更新，不重启则仍跑旧代码（典型现象＝更新了却报旧版提示）。排障第一步看卡片页脚显示的**插件版本号**是否为新版。
- 若桌面端浮窗不出现：先看卡片页脚版本号确认是否已热更（重启后仍为旧版号＝未加载新包），再看桌面应用启动日志里有无本插件的 `[deepseek-stats]` 行——**有=宿主半身已加载**（问题在客户端侧：`dsh.client.platform === "web"` 与界面/路由同源）；**完全没有=宿主半身未加载**（可能缺 `webServer` 服务，或被插件兼容门禁跳过：`grep 'skipping profile bundle' <日志> | grep deepseek-stats`）。

## 卸载

```bash
cd ~/.dsh/profiles/web
pnpm remove dsh-deepseek-stats
# 再从 package.json 的 dsh.profile.bundles 中移除 "dsh-deepseek-stats"，然后重启
```

## 更新方式

- **GitHub 安装的用户**：`cd ~/.dsh/profiles/web && pnpm update dsh-deepseek-stats` → 重启 DSH。
- **本机开发**：直接编辑本地仓库 `lib/` 下文件 → 重启 DSH 生效；改动提交推送 GitHub 即可同步给其他用户。

## 已知边界

- 余额为整个 DeepSeek 账号（官网、其他程序、其他机器共用 Key 都会扣减）。**「今日总计」= 本 DSH 全部署、所有会话（含子代理）的合计**，不是单个对话的消耗；只覆盖经由本 DSH 的模型调用，直接用 Key 调 API 的部分不计入。
- **回填完整性**：回填依赖会话日志的 mtime 预筛；若某会话日志的 mtime 早于今日（例如日志被外部工具改写/复制，或存储后端不是 JSONL），该会话今天的早前用量可能不被计入——此时可看卡片「回填」行的模式（`全量` 表示已兜底）。启动前的实时事件由 `session/event` 持续捕获，不受影响。
- DeepSeek 官方调整价格后，插件最迟 6 小时自动采用新价；同步失败期间按内置价目计费并在界面标注。
- **官方 V4 Pro 政策（2026-09-12 官方更新）**：官方已**撤销**原定 2026-09-14 起的 V4 Pro 下线/改由 V4.1 Flash 计费的计划——该日期之后继续提供 `deepseek-v4-pro` 的 API 服务，计费方式保持不变（如有变动另行通知）。因此插件按 pro 价目计算该模型用量即为正确，无需按时间分支处理。
- **节假日表来源**：法定节假日/调休安排取自社区数据集 `holiday-cn`（国务院公告口径，非 DeepSeek 官方发布）；网络不可达时用内置的 2026 表，跨年后需等国务院公布并由同步补上（同步失败会在「价源」行标注）。**中国港澳台地区及境外的公众假期不在该表内**。
- 高峰/空闲切换以请求发起时刻为准，跨时段请求按发起时刻所在时段计价。
