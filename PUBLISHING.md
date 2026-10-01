# 发布指南（第一次开源照着做）

这份文档写给你自己：从零把脚本发布到 **GitHub** 和 **GreasyFork**。每一步都写清了"点哪里、填什么、为什么要这么做"。不需要会 git。

> 现在什么都不用改。**先把 GitHub 仓库建好**（第 2 步，一分钟），回来执行第 0 步那条命令，占位符一次性全部替换掉。

---

## 第 0 步：一条命令填掉所有占位符

脚本和文档里有几处占位符（`YOUR_NAME` / `YOUR_GITHUB` / `GREASYFORK_*`）。仓库建好后，在项目目录里执行：

```bash
# 先预览会改哪些地方（不写文件）
node tools/setup-metadata.cjs --dry --name "你的展示名" --github 你的GitHub用户名

# 确认没问题就去掉 --dry 真正写入
node tools/setup-metadata.cjs --name "你的展示名" --github 你的GitHub用户名
```

它会一次性改好这些地方，可反复执行、不会重复添加：

| 文件 | 改动 |
| --- | --- |
| `auto-pip-mini-player.user.js` | `@author`、`@namespace`、`@homepageURL`、`@supportURL` |
| `README.md` | 文末的 Issue 链接 |
| `LICENSE` | `Copyright (c) 年份 你的展示名` |
| `package.json` | `name`（仓库名） |

等 GreasyFork 发布、拿到两个数字 ID 之后，再跑一次带 ID 的（会自动补上自动更新地址）：

```bash
node tools/setup-metadata.cjs --name "你的展示名" --github 你的GitHub用户名 --gf-user 用户ID --gf-script 脚本ID
```

> `--repo` 默认是 `auto-pip-mini-player`；如果你的仓库名不一样，加上 `--repo 你的仓库名`。
> `@namespace` 只是给油猴用的唯一标识，不要求能打开：没给 `--gf-user` 时用仓库地址，给了就用 GreasyFork 用户主页地址。
> 执行完可以跑一次 `npm test`，确认脚本没被改坏（应输出 `ALL PASS`）。

---

## 第 1 步：准备好仓库里要放的文件

需要这 8 个（`PUBLISHING.md`、也就是本文，放不放进去都行 —— 放进去能让人看到你的测试与发布流程，不放也完全正常）：

```
auto-pip-mini-player/
├── auto-pip-mini-player.user.js    ← 脚本本体
├── README.md                        ← 项目说明（GitHub 首页会渲染它）
├── LICENSE                          ← MIT 许可证
├── CHANGELOG.md                     ← 更新日志
├── package.json                     ← 只有一条 npm test 命令
├── .gitignore
├── tools/
│   └── setup-metadata.cjs           ← 填占位符的小工具
└── test/
    └── smoke-test.cjs               ← 冒烟测试（90+ 项断言）
```

`README.md` 里补一句你实测过的站点、以及一句"欢迎反馈 xxxx"就够了；第一次发布不用写得很完美。

**建议加一张截图或动图**（录成 gif 效果最好）：GreasyFork 上带图示的脚本安装量明显更高。用你实测米游社时那张小窗截图就够，放到仓库里，然后在 README 顶部用 `![演示](demo.gif)` 引用。

---

## 第 2 步：发布到 GitHub

1. 注册/登录 [github.com](https://github.com)。
2. 右上角 `+` → **New repository**。
   - **Repository name**：`auto-pip-mini-player`
   - **Description**：`油猴脚本：视频划出视口时变成站内悬浮小窗，或切换为浏览器系统画中画`（可留空）
   - 可见性选 **Public**（开源必须公开）
   - **不要**勾选 "Add a README file"（我们已经有自己的 README，勾了会和上传的文件冲突）
   - 点 **Create repository**
3. 在新仓库页面点 **uploading an existing file**（或 `Add file` → `Upload files`），把这 7 个文件/文件夹**拖进去**（`test` 文件夹直接拖，浏览器会自动带上里面的文件）。
4. 下方 **Commit changes** 里写一句说明，例如 `first release v1.8.0`，点绿色按钮提交。

完成。仓库地址形如 `https://github.com/<你的用户名>/auto-pip-mini-player`。

**可选但推荐**：Tag（版本标签）。仓库页右侧 **Releases** → `Create a new release` → `Choose a tag` 填 `v1.8.0` → 标题写 `v1.8.0`，描述直接把 `CHANGELOG.md` 的内容粘过去 → 发布。这样别人能看到明确的版本。

> 以后改脚本的流程：直接在 GitHub 网页上点开 `auto-pip-mini-player.user.js` → 铅笔图标编辑 → 改完提交。记得同时把脚本里的 `@version` 加一位（例如 `1.8.1`），否则用户浏览器不会认为是新版本。

---

## 第 3 步：发布到 GreasyFork

[GreasyFork](https://greasyfork.org/zh-CN) 是最大的用户脚本站，用户在这里点一下就能安装；它也是**自动更新**的托管方。

1. 用 GitHub 账号直接登录 GreasyFork（右上角 `登录` → `使用 GitHub 登录`，无需另外注册）。
2. 顶部 `脚本` → `发布脚本`（或直接访问 <https://greasyfork.org/zh-CN/script_versions/new>）。
3. 表单逐项填：
   - **脚本内容**：把 `auto-pip-mini-player.user.js` 的**全部内容**粘进文本框。
     （粘进去后，GreasyFork 会自动解析脚本头部的 `@name` / `@description` / `@match` 并回填下面的字段，你会看到它们自动出现。）
   - **语言**：`中文 (简体)`
   - **附加信息**：把 README 开头那两段介绍粘进去（介绍它做什么、怎么用），**不要**粘整个 README 的 Markdown 表格（GreasyFork 的说明框支持有限的 Markdown，表格可能显示不好）。留一个 GitHub 仓库链接最好。
   - **许可协议**：选择 `MIT License`（要和 `LICENSE` 文件一致）。
   - 其它选项（如"适用于以下站点"）会自动从 `@match` 生成，不用改。
4. 点 **发布脚本**。发布后你会被带到脚本页，地址形如：
   `https://greasyfork.org/zh-CN/scripts/598256-...`
   其中的 **`598256` 就是脚本 ID**（你的已经是这个号了）。

**关于 `@downloadURL` / `@updateURL`：不用填。**

实测确认过：GreasyFork 原样提供你上传的脚本内容，不会注入任何东西；油猴在安装时会记住**安装地址**，以后就靠它检查更新。所以：

| 用户从哪里安装 | 自动更新的来源 |
| --- | --- |
| GreasyFork 脚本页 | `update.greasyfork.org/scripts/598256/...user.js`（安装来源） |
| GitHub Raw | `raw.githubusercontent.com/...`（安装来源） |

两条路都能自动更新，**填了反而会把两个来源锁死到一个**，所以脚本里故意不写这两行。

`@namespace` 也保持为仓库地址不要再动：油猴用 `@name` + `@namespace` 判断"这个脚本是不是已经装过"，改了它可能被当成另一个脚本、装出第二份。

---

## 第 4 步：以后怎么发布新版本

这是你之后每次改脚本都要走的流程。**仓库里已经配好 CI，Release 不再需要手点网页。**

1. **本地改脚本**：编辑 `auto-pip-mini-player.user.js`，把头部 `@version` 加一位（例如 `1.8.1` → `1.8.2`），并在 `CHANGELOG.md` 里加一节 `## 1.8.2`（CI 会把它当作 Release 正文）。
   > 油猴只在 `@version` 变大时才认为有新版本，所以这一步不能忘。改完跑一次 `npm test`。
2. **推代码 + 打 tag**（一条命令；也可以让 agent 代做）：
   ```powershell
   & 'C:\Users\HAPPY\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' `
     'C:\Users\HAPPY\.dsh\skills\github-publish\scripts\ghpush.cjs' `
     push -m "release v1.8.2" --tag v1.8.2
   ```
3. **其余全部自动**：

| 谁 | 自动做什么 |
| --- | --- |
| GitHub Actions `Release` | 收到 `v*` 标签 → 从 `CHANGELOG.md` 抽取该版本说明 → 创建 Release，并把 `.user.js` 作为附件上传 |
| GitHub Actions `Test` | 每次推送跑一遍冒烟测试（90+ 项断言） |
| GreasyFork | 配了「从 URL 同步」时，定期检查 GitHub 上的 `@version`，自动发布新版本 |

也就是说：**打一个 tag，GitHub Release 与 GreasyFork 都会自动跟上**，不需要再手动复制粘贴或点 "Draft a new release"。

> 只有你想让正文更精美时，才需要去网页编辑一下自动生成的 Release（一般不必）。

### Release 是怎么自动生成的

工作流文件在 `.github/workflows/release.yml`：触发条件是 `push` 标签 `v*`，用 `GITHUB_TOKEN` 调 `gh release create`，正文来自 `CHANGELOG.md` 里匹配 `## <版本号>` 的那一小节；找不到就退回 GitHub 自动生成的提交列表。想改格式就改那个文件（改完记得提交到默认分支，且**下一次打标签时生效**）。

### 可选：让 GreasyFork 自动跟着 GitHub 走

如果你嫌"每次改两个地方"麻烦，可以让 GreasyFork 定时从 GitHub 拉取：

脚本页 → `管理` → `设置` → **`从 URL 同步`**（Sync from URL）→ 填入 GitHub 上脚本文件的 **Raw 地址**：

```
https://raw.githubusercontent.com/xcyzj/auto-pip-mini-player/main/auto-pip-mini-player.user.js
```

（点开 GitHub 上那个文件，右上角有 `Raw` 按钮，点开后的地址就是它。）

保存后，GreasyFork 会定期检查，发现 `@version` 变大就自动发布新版本 —— 此后你**只改 GitHub** 就够了。

---

## 第 5 步：敏感信息审查（已自动配好）

仓库里现在有三道防线，**默认全部生效**，不需要你记得去跑，也**不消耗任何模型 token**（都是本地脚本 / CI 在跑）：

| 防线 | 在哪 | 什么时候起作用 | 谁跑 |
|---|---|---|---|
| **pre-commit 钩子** | `tools/githooks/pre-commit` | `git commit` 时扫描**已暂存的内容**，命中就中止提交 | 你的电脑，自动 |
| **pre-push 钩子** | `tools/githooks/pre-push` | `git push` 时扫描**所有被跟踪的文件** | 你的电脑，自动 |
| **ghpush 提交前审查** | 技能 `github-publish` 的 `ghpush.cjs` | agent 推送前，命中即中止（它也会自动挂上上面的钩子） | agent 调用时，自动 |
| **CI 扫描** | `.github/workflows/test.yml` 里的 `node tools/check-secrets.cjs` | 每次推送 / PR（服务端强制，钩子被绕过也拦得住） | GitHub |

扫描器是 `tools/check-secrets.cjs`，分两级：

- **【确定】** 精确匹配各家令牌格式（GitHub / OpenAI / Anthropic / AWS / Google / Slack / npm / 私钥块等）→ **直接失败**；
- **【疑似】** `api_key = "..."` 这类启发式 → 默认只提示，加 `--strict` 才失败。

手动使用：

```powershell
node tools/check-secrets.cjs            # 扫所有被跟踪的文件（CI 用的就是这个）
node tools/check-secrets.cjs --staged   # 只扫即将提交的内容
node tools/check-secrets.cjs --history  # 扫历史提交（慢，偶尔跑一次）
node tools/check-secrets.cjs --strict   # 连"疑似"也算失败
```

**误报怎么办**：在该行加注释 `check-secrets:allow`，或把正则写进仓库根的 `.secretsignore`。

**启用 git 钩子**（每个新克隆做一次 —— `.git/` 里的配置不进仓库）：

```powershell
npm run hooks          # 等价于 git config core.hooksPath tools/githooks
```

- 想临时跳过：`git commit --no-verify` / `git push --no-verify`（**CI 那边仍然会拦**）；
- 想对所有仓库生效（可选）：`git config --global core.hooksPath <某个目录>`，但要自己维护那个目录，别把别的项目已有的钩子覆盖掉。

### 万一真的把密钥推上去了

1. **先撤销/轮换那个密钥**（GitHub token 立即 Revoke、云服务密钥立即重置）—— 这一步最重要，改写历史**不等于**密钥安全；
2. 再考虑清理历史：单人仓库最省事的是删库重建，或用 `git filter-repo` 重写；
3. 公开仓库要假设内容已被爬走，所以第 1 步永远优先。

另外 GitHub 对**公开仓库**默认提供 secret scanning 与 push protection（服务端拦截），可在 `Settings → Code security and analysis` 确认状态 —— 那是额外兜底，替代不了上面三道防线。

---

## 第 6 步：发布前自检清单

- [ ] `npm test` 输出 `ALL PASS`
- [ ] 脚本头部 `@version` 是你想要的版本号（首次 `1.8.0`）
- [ ] 4 个占位符已替换（至少 `YOUR_NAME`、`YOUR_GITHUB`；GreasyFork 两个可以先留）
- [ ] `@match` 只包含你实际验证过的站点（宁可少，不要多 —— 免得用户在没测过的站点上遇到问题）
- [ ] `LICENSE` 里的 `YOUR_NAME` 已替换
- [ ] 用**干净的浏览器环境**试一遍：全新装一个 Tampermonkey、装脚本、打开米游社文章页划出视频，确认小窗正常
- [ ] 发布后在脚本页留一句"有问题请到 GitHub 提 Issue"，并把 Issue 地址填进 `@supportURL`

---

## 常见问题（关于发布本身）

**问：GitHub 和 GreasyFork 两边的脚本内容不一样怎么办？**
以 GitHub 为"源"，GreasyFork 用第 4 步的自动同步；不要两边手改，容易分叉。

**问：别人 fork（复制）我的项目要同意吗？**
MIT 允许任何人自由使用、修改、再发布，只需保留版权声明。这正是 MIT 的意思，不用管。

**问：可以改许可证吗？**
可以，但已经发布的版本原则上仍按当时的许可证。第一次发布前想清楚（推荐就用 MIT）。

**问：有人报告脚本在某个网站不生效，我该做什么？**
按 README 的「站点适配器」加配置，或告诉他临时用面板里的「复制本页路径规则」把自己要的站点加进油猴的包含列表。你也可以在 README 的"已支持站点"表里补充验证过的站点。

**问：需要写测试吗？**
项目里已经有一份（`test/smoke-test.cjs`）。它是这次开发过程中真实用过的回归测试，改了逻辑就跑一次，能省很多来回。

