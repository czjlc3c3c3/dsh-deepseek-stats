# dsh-deepseek-stats（DeepSeek 余额/用量浮窗）

DeepSeek 账户「余额 / 用量」实时浮窗插件（DSH 长期生效版）：页面右上角悬浮卡片，展示官方余额、今日 token 消耗与峰谷计价成本，官方价目自动同步。

## 功能一览

- **官方余额**：直连 `api.deepseek.com/user/balance`（API Key 走 DSH 凭据通道 `DEEPSEEK_API_KEY`，不进入浏览器）；15 秒缓存，点击 ⟳ 强制刷新（2 秒冷却，旋转反馈）。
- **今日用量**：宿主监听 `session/event` 的 `assistant/message`（含 `usage`）实时累加，启动时回填当日已落库事件；按北京时间午夜自动滚动。
- **峰谷计价**：高峰时段 = 北京 周一至周五 09:00–12:00 / 14:00–18:00（价格 ×官方倍率，默认 2），其余时间（含周末、夜间）×1；按每条消息发起时刻计价；缓存命中 / 未命中 / 缓存写 / 输出分档；未知模型不计价并在界面标注。
- **官方价目自动同步**：启动时 + 每 6 小时抓取官方价目页并解析；失败回落内置价，并以「启动后 30 秒 → 2 分钟 → 8 分钟」退避重试；展开卡片可查看「价源」行（官方 / 内置）。
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

- 余额为整个 DeepSeek 账号（官网、其他程序、其他机器共用 Key 都会扣减）；今日用量只统计本工作区内通过 DSH 的模型调用，且统计窗口从插件启动时刻起算（含当日早前事件的启动回填）。
- DeepSeek 官方调整价格后，插件最迟 6 小时自动采用新价；同步失败期间按内置价目计费并在界面标注。
- 高峰/空闲切换以请求发起时刻为准，跨时段请求按发起时刻所在时段计价。
