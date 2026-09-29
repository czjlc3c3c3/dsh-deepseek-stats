# 更新日志

## 1.2.2（2026-09-29）

- 文档：README「已验证 DSH 版本」加入 **0.2.0-rc.2**（附注 rc.2 的变更面经 npm tarball 逐包 diff 核对＝仅 CLI 启动器与类型 + README，其余包只有版本号）
- 文档：**桌面端（Electron）段落重写为实测结论**——能正常加载（宿主+客户端半身均生效）、余额走官方账号通道（v1.2.0 起，实测正常）；外部 CLI 仍拒绝 `desktop` profile，但 **0.2.0-rc.2 起由 Desktop 应用内置命令运行时管理其插件操作**；新增⚠️**「更新插件后必须重启桌面应用」**（桌面端无热更新，不重启会继续跑旧代码，典型现象＝更新了却报旧版提示）与排障顺序（先看卡片页脚插件版本号 → 再看启动日志有无 `[deepseek-stats]` 行 → 再查兼容门禁跳过）
- 无代码改动、无需重启

## 1.2.1（2026-09-28）

- **修正账号通道的 client 元数据**：`x-client-version` 改为传**运行版本**（取自 `profileContext.installAnchor` 下 dsh 包的 `package.json`，本机实测得到 `0.2.0-rc.1`；取不到才退回插件版本）。此前传的是插件版本 `1.2.0`，与官方 UI 的 `accountClientMetadata(locale, "0.2.0-rc.1")` 不一致，平台侧若按 `x-client-version` 校验会被拒。
- **新增余额诊断**（用于定位「桌面端已登录却报未登录」）：失败时写日志 `[deepseek-stats] 余额通道诊断: {...}`，并随 `/state.balanceDiag` 暴露，卡片在告警下方多显示一行「诊断：账号服务 可见/不可见 · 账号登录态 … · 宿主账号凭据 有/无 · Key 有/无 · client版本 …」。
  - `accountVisible` = `ctx.get('deepseekAccount')` 且有 `getBalance`；
  - `accountState` = `getState().status`（`signed-out` / `credential-stored`）；
  - `accountCredential` = `credentials.listRecords()` 中是否存在键名含 `deepseek-account-platform` 的记录（官方账号平台把登录凭据写在这里），用来区分「服务不可见」与「宿主凭据库里确实没有登录凭据」。
- 卡片页脚新增**插件版本号**（`插件 v1.2.1`），用于确认桌面端是否真的热更到了新版本。
- 离线验证仍 4/4 通过；另验证诊断字段在「账号未登录」「服务不可见」两种情形下取值正确、`clientVersion` 解析为运行版本。

## 1.2.0（2026-09-28）

- **新增：余额双通道，支持 DSH 桌面端（官方账号登录，无需 API Key）**。桌面端登录官方账号后，插件原先只认 `DEEPSEEK_API_KEY`，会误报「未配置 KEY」；现改为：
  1. 先走 API Key 通道（Web/自建部署）：`credentials.resolve('DEEPSEEK_API_KEY')` → `api.deepseek.com/user/balance`；
  2. 未命中则回落到**官方账号通道**：`ctx.get('deepseekAccount').getBalance({version, locale, timezoneOffsetSeconds})` —— 语义按官方实现映射：`balance.value` = **充值余额**、`balance.bonusWallets` = **赠金余额**（与官方设置页「充值余额 / 赠金余额」文案一致），展示的总额 = 两者之和。
- `keyState` 新增 `mode`：`api-key` / `account` / `account-signed-out` / `none`；卡片按模式给出准确提示（账号未登录就提示去登录、两者皆无才提示配置 Key），并在「价源」行附带「余额源 API Key / 官方账号」。
- 账号服务经 `ctx.get('deepseekAccount')` **动态获取**，缺失时安全回落——因此**不新增任何 `@deepseek-ai/*` 依赖**，仍不声明 peerDependencies，兼容门禁照旧放行。
- 离线验证 4/4 通过：① 仅 Key（解析 total/granted/topped）② 无 Key + 账号已登录（充值 123.45 + 赠金 6.55 → 130，client metadata 含 version/locale/tz）③ 账号未登录（提示登录）④ 两者皆无（提示配置 Key）。

## 1.1.3（2026-09-28）

- **新增：0.2.0 插件兼容门禁说明（本插件安全通过）**。DSH 0.2.0 起 profile 组装会校验 bundle 的 `@deepseek-ai/dsh*` peerDependencies 与运行时版本；**不匹配即整包跳过**（`dsh: skipping profile bundle …`）。本机实测：`dsh-mnemon@0.5.13`、`dsh-zotero@0.10.1`、`dsh-plugin-writing-guard@2.0.1` 均被跳过（后者已在 web profile 的 `compatibility.json` 中按精确版本豁免）；**`dsh-deepseek-stats` 未在跳过名单**——因为它不声明任何 `@deepseek-ai/*` peerDependencies，门禁 `if (!Object.hasOwn(fields, "peerDependencies")) return undefined` 直接放行
- README 增补该门禁的判定规则、自查命令与豁免逃生口，并写入**维护不变量：不要添加 `@deepseek-ai/dsh-*` peerDependencies**（一旦声明就会开始被校验，范围写窄将在 DSH 升级后被静默跳过）；桌面端同样受此门禁约束，且豁免需在桌面端侧授予
- 无代码改动（纯文档 + 版本号）

## 1.1.2（2026-09-28）

- **DSH 0.2.0-rc.1 兼容性核对：无需改代码**。宿主侧 `session/event`（`(session, event)`）、`TokenUsage` 字段、`webServer.register`、`credentials.resolve`、`sessionPersistence.root`、`dshHomePath`；客户端侧 `__ModuleLoader__` 协议、`shell.overlay` 槽位、bundle 路由 `plugins/??<id>/client.js&rev=…` 均未变。生产实测：`/state` 正常（回填 `mode=mtime`）、客户端 bundle 200（18.5 KB，注入 5 处、widget 标记齐全）
- **用量口径复核**：DSH 里只有 `assistant/message` 携带 `usage`；`assistant/attempt`（失败/重试/取消的尝试）**按类型无 usage 字段**，本机历史 71 条 attempt 亦未见用量记录；14,157/14,178 条 `assistant/message` 带 usage → 按 `assistant/message` 折叠即为完整
- **桌面端（Electron）说明入 README**：0.2.0 起桌面端使用保留 profile 名 `desktop`，CLI 明确拒绝管理（`profile "desktop" is managed exclusively by the Electron application`），安装须由桌面应用自身完成；随附 Web 宿主的客户端插件表硬编码只接受 `dsh.client.platform === "web"`，桌面端是否可直接加载本插件需在桌面实机验证（另需宿主挂载 `webServer` 且界面同源，客户端才取得到数据）。附排障判据：看桌面端启动日志里有无本插件 `[deepseek-stats]` 行
- 参考（未采纳）：0.2.0 新增官方 `tokenMeter` 服务与 `usage-projection`/`turn-usage` 折叠，但它们给出的是**会话生命周期总量/上下文占用量**，不含"按日"切分，无法直接替代本插件的当日统计

## 1.1.1（2026-09-25）

- **修复：启动回填漏会话导致「今日用量」系统性少算**。原实现 `listSessions().slice(0, 40)` 取的是**按创建时间**最新的 40 个会话，长寿命会话（如创建于 08-26 的本会话）永远排不进窗口 → 它们"启动前活跃、启动后不活跃"的当日用量既没被回填、也收不到实时事件，直接丢失
  - 实测（2026-09-25）：插件报 51,090,406 tokens，日志全量为 89,037,789 → **少算 37,947,383（43%）**；
  - 缺口逐笔对齐：`session-6dd5a9de` 26,795,240 + `session-4f48857a` 8,324,627 + `session-906ea654` 2,827,516 = **37,947,383**（三会话启动前用量之和，分毫不差）
- **改法**：回填改为**按会话日志 mtime 预筛「今日活跃会话」**（根目录优先问 `sessionPersistence.root`，其次 `dshHomePath('sessions')`，最后按 `DSH_HOME` 约定；目录名与会话 id 做 `session-` 前缀归一化匹配），识别不到布局或筛不出任何会话时**回退全量**（上限 500）
- 新增 `/state.backfill` 诊断（`mode`/`sessions`/`candidates`/`scanned`/`events`），卡片新增「回填」覆盖行；「今日总计」标注（全部署），README 明确该口径=全部署所有会话（含子代理）
- 研究结论（不改代码）：**不使用 `TokenUsage.totalTokens`**。它是同一公式的另一写法（适配器 `usage.totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens`），且在本会话 247 条事件中**缺失 87 条（35%）**、存在时与插件公式**零不一致**

## 1.1.0（2026-09-25）

- **新增：中国法定节假日感知（修正峰谷判定）**。官方 2026-09 页脚注明确：高峰 = 北京时间**周一至周五（不含中国法定节假日）**09:00–12:00 / 14:00–18:00，其余时段**包括周末与法定节假日全天**均为空闲。此前插件只看「星期几 + 钟点」，在法定节假日（如 2026-09-25 中秋节）会误判为高峰 → 成本翻倍高估
- 新增节假日表：**内置 2026 全年**（元旦/春节/清明/劳动/端午/中秋/国庆共 33 天休假日 + 6 个调休上班日），并按日从 `holiday-cn`（国务院公告口径数据集，jsDelivr → GitHub raw 双源）同步当年与次年安排；同步失败保留内置表，界面标注「节假日源 官方数据集/内置」
- 调休上班日（均落在周末）按官方规则仍计空闲，界面单独标注，不参与计价
- 时段环/备注改为区分 高峰 / 空闲（法定节假日、周末、调休上班、夜间），并显示下一个高峰；`window` 新增 `dayType`、`holidayName` 字段
- 兼容性复核：在 DSH 0.1.7-rc.2 上确认 `session/event` 载荷、`credentials.resolve`、`webServer.register` 与客户端 bundle 注入均未变（用法依旧可用；DSH 新增的 `TokenUsage.totalTokens` 不影响计价）

## 1.0.4（2026-09-12）

- 跟进官方 2026-09-12 页面说明：官方**撤销**原定 2026-09-14 的 `deepseek-v4-pro` 下线/改由 V4.1 Flash 计费计划，该日期之后继续提供 V4 Pro API 服务、计费方式不变
- 计价逻辑无需改动（按 pro 价目计算即为正确，也无需按时间分支）；本次仅修正 README「已知边界」里已作废的下线提示，避免据此误判成本
- 模型名与价格与 v1.0.3 一致：flash 0.02 / 1 / 4、pro 0.15 / 4.5 / 13.5（元/百万 tokens，空闲时段；高峰 ×2）

## 1.0.3（2026-09-10）

- 跟随官方 2026-09-10 改版：现行模型名为 **`deepseek-flash`**（DeepSeek-V4.1-Flash，实验名 `deepseek-v4.1-flash-expires-on-0910` 已转正）与 `deepseek-v4-pro`；内置价更新为 flash **hit 0.02 / miss 1 / out 4**、pro 0.15 / 4.5 / 13.5（元/百万 tokens，空闲时段）
- 修复：官方价目页由 3 列改为 2 列后，解析函数写死的「取 m[0]/m[1]/m[2]」第三列取到 `undefined`，被数值校验挡下 → 同步整体失败、长期回退旧内置价。现改为**列数自适应**：列名从表头「模型 … BASE URL」提取、按列序映射，官方增删模型都不再需要改代码；表头与列数不一致时保守回退内置价
- 旧名兼容：`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 按官方说明映射到 `deepseek-flash` 计价（官方：旧名仍可调用，但由 V4.1 Flash 提供服务并按其价格计费）
- 兜底匹配改为 `pro` / `flash` 关键字（`deepseek-chat` 等旧名同样走 flash 价）

## 1.0.2（2026-09-08）

- 新增：内置价目加入实验模型 `deepseek-v4.1-flash-expires-on-0910`（官方价目页未列出，当前与 `deepseek-v4-flash` 同价）
- 修复：官方价目同步不再整体覆盖价表——官方页未列出的内置模型（如上述实验模型）保留内置价，不会被同步「丢掉」
- 增强：模型匹配兜底由 `v4-flash` 放宽为 `flash`，`v4.1-flash-*` 等未来实验/新变体自动按 flash 计价（不再显示未计价）
- 初始价表改为直接从内置表派生，新增模型时不会漏登记

## 1.0.1（2026-08-26）

- 修复：启动回填仅折叠北京时区当日事件，历史日事件不再重置「今日用量」统计（此前回填会把今日已落库用量清零）
- 修复：宿主定时器（价格同步/退避重试）与路由注册随插件生命周期清理，热更新/卸载不再泄漏
- 文档：README 去除本机绝对路径；安装改为 `#semver:^1.0.0` 版本锁定；卸载改用 `pnpm remove`
- CI：新增最小语法检查工作流（`.github/workflows/check.yml`）

## 1.0.0（2026-08-24）

首个正式版本。

- 官方余额：直连 `api.deepseek.com/user/balance`（Key 走 DSH 凭据通道，不进浏览器），15s 缓存 + ⟳ 强制刷新（2s 冷却、旋转反馈）
- 今日用量：监听 `session/event` 的 `assistant/message`（含 `usage`）实时折叠，启动回填当日事件，北京时间午夜滚动
- 峰谷计价：高峰 = 北京周一至周五 09:00–12:00 / 14:00–18:00（×官方倍率，默认 2），其余 ×1；按消息发起时刻计价；缓存命中/未命中/缓存写/输出分档；未知模型不计价并标注
- 官方价目自动同步：启动 + 每 6h 抓取解析，失败回落内置价并退避重试（30s → 2min → 8min）
- 时段进度环：绿（空闲）/红（高峰）动态圆环，按当前时段剩余时间收缩，悬停显示倍率与剩余时长
- 交互：可拖拽、▾ 收起为一行摘要、▸ 展开全详情、10s 轮询
- 包名：dsh-deepseek-stats（语义化命名，路由 `/plugins/deepseek-stats/*`）
