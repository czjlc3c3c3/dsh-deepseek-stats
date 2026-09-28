# dsh-deepseek-stats（DeepSeek 余额/用量浮窗）

DeepSeek 账户「余额 / 用量」实时浮窗插件（DSH 长期生效版）：页面右上角悬浮卡片，展示官方余额、今日 token 消耗与峰谷计价成本，官方价目自动同步。

## 功能一览

- **官方余额**：直连 `api.deepseek.com/user/balance`（API Key 走 DSH 凭据通道 `DEEPSEEK_API_KEY`，不进入浏览器）；15 秒缓存，点击 ⟳ 强制刷新（2 秒冷却，旋转反馈）。
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

- **已验证**：DSH **0.1.7-rc.2** 与 **0.2.0-rc.1**（Web profile）上功能完整——宿主 `session/event` 载荷（`(session, event)` + `assistant/message.usage`）、`credentials.resolve`、`webServer.register`、`sessionPersistence.root` / `dshHomePath`、客户端 `__ModuleLoader__` 协议与 `shell.overlay` 槽位、bundle 路由 `plugins/??<id>/client.js&rev=…` 均未变。
- **用量事件**：DSH 里只有 `assistant/message` 带 `usage`；`assistant/attempt`（失败/重试/取消的尝试）**按类型不带 usage**，本机历史日志 71 条 attempt 亦未见用量记录——故按 `assistant/message` 折叠即为完整口径。
- **0.2.0 插件兼容门禁（重要，本插件安全通过）**：DSH 0.2.0 起，profile 组装时会核对每个 bundle 的 `peerDependencies` 中 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 项与运行时版本的 semver 匹配；**不匹配则该 bundle 被整体跳过**（启动日志：`dsh: skipping profile bundle "<name>": Error: Plugin <pkg>@<ver> is incompatible with dsh <runtime>…`）。
  - 本插件**不声明任何 `@deepseek-ai/*` peerDependencies**（只 import Node 内置模块，经 `ctx` 服务与客户端 `__ModuleLoader__` 协议取数），门禁的 `if (!Object.hasOwn(fields, "peerDependencies")) return undefined` **直接放行**——0.2.0-rc.1 实测未出现在跳过名单，功能完整。
  - **维护不变量：不要给本插件添加 `@deepseek-ai/dsh-*` 的 peerDependencies**。一旦声明门禁就会开始校验，范围写窄就会像其它插件那样在 DSH 升级后被**静默跳过**（同机 `dsh-mnemon`、`dsh-zotero`、`dsh-plugin-writing-guard` 即因此被跳过）。
  - 核查：`grep 'skipping profile bundle' <DSH 启动日志> | grep deepseek-stats`（无输出=已加载；也可看日志里有否插件的 `[deepseek-stats]` 行）。
  - 万一将来被跳过：用 `dsh plugin allow-version` 或插件管理器授予**精确版本豁免**（写入该 profile 的 `compatibility.json`，形如 `{"<pkg>@<ver>": ["<DSH 版本>"]}`），再重启；桌面端由应用管理，豁免须在桌面端侧授予。
- **桌面端（Electron）**：DSH 0.2.0 起有 Electron 桌面端，它使用**保留 profile 名 `desktop`**，CLI 明确拒绝管理（`error: profile "desktop" is managed exclusively by the Electron application`）。因此桌面端安装本插件必须**由桌面应用自身管理**（应用内的插件/设置入口），不能用 `dsh plugin --profile desktop …`。
- 桌面端能否显示本浮窗取决于桌面宿主是否满足两点（本机容器内无法验证，需在桌面端实测）：① 客户端插件表按 `dsh.client.platform` 过滤，随附 Web 宿主硬编码只接受 `"web"`——若桌面宿主复用同一实现则本插件（`platform: "web"`）可直接加载，若它使用别的平台标识则需另出桌面变体；② 宿主需挂载 `webServer`（本插件宿主半身暴露 HTTP 路由），且界面与路由同源（客户端用相对路径 `fetch('/plugins/deepseek-stats/state')`）。
- 若桌面端装上后浮窗不出现，请提供桌面应用的启动日志（其中会打印本插件的 `[deepseek-stats]` 行，如「回填…」「价目同步…」）：**有插件日志=宿主半身已加载**，问题在客户端平台/同源；**完全没有=宿主半身未加载**（可能缺 `webServer` 服务）。

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
