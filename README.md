# dsh-caveman

## 兼容的 Harness 版本

- **已验证支持**：DeepSeek Harness `0.1.0-rc.6`（web profile）。
- **最新版 `0.1.2-alpha.3`**：适配计划进行中，暂无确切完成时间。升级前请先备份你的 DSH 安装。


让 DeepSeek Harness 里的 AI **少说废话**：像聪明的穴居人一样极简输出，技术信息完整保留。

> **本机实测（DeepSeek V4-Flash，8 任务 × 5 档，2026-08-17）**：
>
> | 档位 | 平均输出 token | 节省 |
> |---|---|---|
> | baseline（正常） | 910 | — |
> | lite | 282 | 69% |
> | full（默认） | 112 | 88% |
> | ultra | 76 | 92% |
> | wenyan-full | 114 | 88% |
>
> 注：这是**输出 token** 的节省，输入和推理 token 不省；且 skill 本身每轮额外占约 1-1.5k 输入 token，**短回答可能反而更贵**。真正省 token 的大头在 [dsh-headroom-suite](https://github.com/wjxn13/dsh-headroom-suite) 的缓存命中（99.9%），输出精简是锦上添花。基准脚本 `benchmark/benchmark_output_tokens.py` 可复现。

> **「穴居人」是什么？** 源自英文梗 `why use many word when few word do trick`（能少说为什么多说）。穴居人（caveman）在西方文化里是「语言能力有限、只会蹦最核心词汇」的刻板印象。中文里更直观的类比是**电报体**「母病速归」或**文言文**「言简意赅」——删掉所有客套、修饰、语气词，只留信息最核心的词。技术信息一个字不少，废话一个不留。

> 本插件是 [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman)（MIT）的 **DeepSeek Harness 移植**，只移植 **skill 层（输出精简）**，不含输入代理（proxy）与浏览压缩。压缩规则源自 caveman，版权归原作者；本插件仅做 dsh 适配与中文强化。

## 为什么只做 skill 层

caveman 有三层：skill（输出精简）、proxy（输入压缩）、browse（浏览压缩）。本插件**只做 skill 层**，原因：

- **输出精简是 dsh 生态空白**——dsh 自带机制（稳定前缀缓存 + 工具结果瘦身 + 上下文压缩）和 [dsh-headroom-suite](https://github.com/wjxn13/dsh-headroom-suite)（Headroom 请求层输入压缩）全是**输入侧**，没人碰输出侧。
- **输入 proxy 不碰**——caveman 的输入 proxy 是有损压缩，会破坏 Headroom 辛苦保住的 99.9% 前缀缓存，两个代理在请求链路上打架。输入侧交给 dsh-headroom-suite，本插件只管输出侧，两者互补不冲突。

## 用法：命令触发

本插件提供**三种**控制方式：设置页面板、输入框一键切换、对话命令（host 端 + 状态文件持久化，注入 system prompt）。

### 对话命令

命令名为**连字符**形式（源码 `src/index.ts` 注册的即 `caveman-*`）：

| 命令 | 作用 |
|---|---|
| `/caveman-on` | 开启精简（默认 full 档）|
| `/caveman-off` | 关闭精简 |
| `/caveman-level <lite\|full\|ultra\|wenyan-full>` | 切档位（自动开启）|
| `/caveman-status` | 查看当前状态与档位 |

开启后，精简规则注入每次请求的 system prompt，**跨会话一直生效**（状态存 `~/.dsh-caveman/state.json`，重启保持）。也可在对话里说「少说废话」「精简」「说重点」触发 skill 层（单会话生效，换会话需重触发）。

### 设置页面板 / 输入框一键切换

装完重启 profile 后，可直接在 UI 上操作，无需记命令：

- **设置页**新增「输出精简」分区（order 45）：开关 + 档位按钮，修改立即生效，无需重启
- **输入框右侧**一键切换按钮（order 90）：当前对话内快速开关

面板数据经插件自有 HTTP 路由读写（`/caveman/status`、`/caveman/state`），实现细节见下方「设置页开关的实现」一节。

## 档位

| 档位 | 效果 |
|---|---|
| lite | 删填充/hedging，保留完整句子 |
| full（默认） | 短句碎片、短同义词，不叙述工具调用 |
| ultra | 一词够就不两词，每事实只述一次 |
| wenyan-full | 中文文言：字面省 80-90%（字符不是 token），高密度信息 |

示例（"为什么 React 组件重复渲染？"）：
- full："每次渲染新对象引用。内联对象 prop = 新引用 = 重渲染。useMemo 包之。"
- wenyan-full："每绘新生对象参照，故重绘；以 useMemo 包之则免。"

## 规则精髓

- **只删废话，不删技术**：填充词/客套/hedging 死，代码/命令/错误/commit 关键字原文保留。
- **红线**：绝不删否定词（不/没/只/仅/除），数字单位精确——翻转语义比省 token 糟。
- **不自指**：不说"精简模式开启"，只输出精简结果。
- **自动恢复**：安全警告、不可逆操作、多步歧义时自动退回完整表达。

## 与 dsh-headroom-suite 配合（输入 + 输出一起省）

[dsh-headroom-suite](https://github.com/wjxn13/dsh-headroom-suite) 管**输入侧**（请求层压缩，保缓存），本插件管**输出侧**（精简废话）。两者正交、互补、不冲突，一起装效果叠加：

| | dsh-headroom-suite | dsh-caveman |
|---|---|---|
| 省哪侧 | 输入 token（工具 schema + 跨轮去重） | 输出 token（删废话） |
| 机制 | Headroom 代理，无损保缓存 | 提示词规则，有损删修饰 |
| 省钱大头 | 99.9% 缓存命中（折扣价） | 88% 输出精简（本机实测） |

> 注：`dsh-headroom` 与 `dsh-headroom-manager` 已合并为 **dsh-headroom-suite**（二合一套件），
> 新装请直接用套件，无需再装那两个独立插件。

一个管**进**（把发给模型的输入压到最省，还不破坏缓存），一个管**出**（把模型吐出来的输出压到最省）。两个都装，token 消耗逼近理论下限。

### 组合实测（2026-08-26，dsh web + Headroom v0.35.0 / dsh-headroom-suite + deepseek-v4-flash）

两者**完全兼容、无冲突**，已验证可叠加省 token。每组开全新 session 切到 `deepseek-official`，
开放题（TCP 三次握手、HTTP/2 改进）各问 2 轮，对比 caveman 关 / ultra：

- **Headroom 代理层（透明，与 caveman 无关）**：每请求稳定压缩约 **173 tok**（主要是 tool_schema 压缩，占输入约 1.2%）；
  真正的大头是**前缀缓存命中**——每轮 18k–37k tok 命中缓存（按 DeepSeek 1/10 价计费），长会话收益最大。
- **caveman 输出侧**：ultra 档相对关闭，**输出 token 省 ~36.6%**（4098 → 2597）。
- **组合**：输入侧重复上下文由 Headroom 转前缀缓存（约 1/10 价），输出侧由 caveman 砍约 37%，二者打在不同层、可同时开。

> 想最大化省费，**稳定系统提示让 Headroom 冻结前缀缓存**比 caveman 档位更关键；长期会话 + 固定系统提示收益最大。
> 详细分工表与启动注意事项见 [dsh-headroom-suite](https://github.com/wjxn13/dsh-headroom-suite) README。

> 注意：本机旧测 8/17 的 ultra 节省 92% 是「8 任务 × 5 档」短答基准（输出 token 相对 baseline），
> 与本测「开放长答」场景不同，二者不矛盾——长答里修饰空间更小、且 Headroom 缓存摊薄了总成本，故 ultra 净省约 37%。

## 设置页开关的实现（攻坚留档）

dsh 当前版本下，第三方插件**无法使用官方 settings 机制**在设置页放自己的开关。曾经试过的两条路都被堵：

1. **settingsScope 注册自定义 namespace** → dsh API 网关 `dsh-host-apiproxy` 的 `exposedNamespaces()` 有硬编码白名单（模型提供者 + `WEB_SETTINGS_NAMESPACES` + `PRODUCT_SETTINGS_NAMESPACES`），插件自定义 namespace 被 `.filter(exposed.has(ns))` 过滤，返回 `settings-not-exposed`。源码注释明说「让插件自己声明暴露」是 **deferred work**（未实现）。
2. **remote.commands.execute 触发命令** → 该方法是 **agent 作用域**（`scope: { context: "agent" }`），设置页无活跃会话，agent identity 解析失败，调用失败。
3. 附带发现：dsh-headroom 源码里 `remote.command`（单数）是 bug，正确是 `remote.commands`（复数）；且 execute 只接受 `line` 一个参数（agent 自动解析），返回值读 `raw.value.result` 而非 `raw.result`。

### 最终方案：绕开 settings，走自定义 HTTP 路由（已实现）

既然官方 settings 通道不通，就**不依赖它**：在 host 的 webServer 上注册**普通 HTTP 路由**，由 browser half 直接 fetch（该做法 dsh-market 已验证可行）。

| 路由 | 方法 | 说明 |
|---|---|---|
| `/caveman/status` | GET | 读取当前开关状态与档位 |
| `/caveman/state` | POST | 写入开关/档位；**写保护**见下 |

**写保护（两模式，桌面端 403 回归的修复）**：宿主有 `connection` 服务（`@deepseek-ai/dsh-client-connection`）时，写入交给平台的 `Connection.requestRejection`——Host/Origin 围栏失配 403、缺签名 cookie 401、放行返回 undefined；该服务缺席（纯 CLI 组合）时才回退到 `Origin === Host` 的同源校验。

不能只做同源校验：**桌面端渲染进程的页面 origin 是 `dsh-app://app`**，Electron 主进程转发插件请求到宿主 loopback 时会**删掉 `origin`/`host`/`cookie`/`sec-fetch-site`** 并重新挂上宿主自己的签名 cookie（见 dsh-desktop `forwardWebRequest`），于是 `Origin === Host` 必然为假 → 每次点击都 403 `untrusted origin`，而 browser half 又把失败 catch 掉，表现为「点了没反应」。取 `connection` 必须用 **getter 每次请求现读**：该服务由异步 apply 定义、晚于路由挂载完成，构造时读一次会永远拿到 undefined。

UI 侧经 slots 注入两个挂载点：

| 挂载点 | id | order | 作用 |
|---|---|---|---|
| `settings.section` | `caveman` | 45 | 设置页「输出精简」分区：开关 + 档位按钮 |
| `conversation.input.right` | `caveman-toggle` | 90 | 输入框右侧一键切换 |

这样既不依赖未开放的 settings namespace，也无需 agent 作用域的 remote 调用，开关与命令共用同一份 `~/.dsh-caveman/state.json`，三种方式状态一致。

**备选攻坚方向**（若将来需要 remote 调用能力）：用 typert 的 `@Remote("name")` 装饰器 + `TypertRemoteService` 基类，定义一个**方法签名不含 agent 参数**的 non-scoped remote 方法（如 `setEnabled(enabled)`），client 端经 `ctx.get('remote').<namespace>.<method>()` 调用，绕过 agent scope。dsh-goal 的 `GoalService` 是可参考的 remote 服务范例。

## 安装

```bash
dsh plugin --profile web add "github:wjxn13/dsh-caveman"
```

装完重启 profile，即可在**设置页「输出精简」**或**输入框右侧按钮**开关；也可在对话里说「少说废话」触发 skill，或用 `/caveman-on|off|level|status` 命令控制（全局生效，跨会话保持）。

## 测试

```bash
npm install
node scripts/build.mjs    # 构建 host，验证源码可编译
npm test                  # 8 项：路由写保护 + 构建产物端到端（含桌面端转发形状）
```

- `test/routes-guard.test.mjs`：真实路由模块 + 真实 HTTP server，锁桌面端转发形状（无 `origin` + 宿主 cookie）被放行、缺 cookie 401、跨站 403、无 `connection` 组合回退同源校验。
- `test/bundle-mount.test.mjs`：直接 `import lib/index.js`（随包发布的产物），桩宿主服务 + 临时 HOME，证明桌面端形状的写入能落盘到 `state.json` 且跨站仍被拒。
- `npm run repro:desktop-toggle`：对**运行中的宿主**（默认 `http://127.0.0.1:19387`，可 `CAVEMAN_BASE` 覆盖）跑一次现场复现，两种请求形状各发一次写请求并断言 200，结束时恢复原状态；RED 退出码 1。

> 现场脚本打的是进程内已加载的旧代码：改完源码要**同步到 profile 的 `node_modules/dsh-caveman` 并重启**（或插件页「重启」），否则仍会 403。

真实功能验证：装进隔离测试实例，发消息说「少说废话」或执行 `/caveman-status`，确认命令注册、状态文件 `~/.dsh-caveman/state.json` 写入、输出变精简；再在设置页「输出精简」分区点开关/档位，确认 `GET /caveman/status`、`POST /caveman/state` 正常工作且与命令状态同步。
