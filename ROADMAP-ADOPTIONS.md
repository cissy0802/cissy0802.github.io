# Roadmap 采纳清单（待落地到各仓 TOPICS.md）

> 决定日期：2026-09-01　｜　决定：**8 条建议全部采纳**（2026-09 巡检 3 条 + 2026-08 巡检遗留 5 条）
> 本文件是**可直接粘贴的补丁文本**，不是建议。`ROADMAP-SUGGESTIONS.md` 每月会被巡检覆盖，故采纳记录单独存于此。
>
> **为什么没有直接改各仓**：本会话的 GitHub 访问范围仅限 `cissy0802/cissy0802.github.io`，
> 且容器内只 clone 了 hub 仓。ai-ml-daily / super-individual-weekly / investing-weekly
> 三仓既够不着也推不了，需在有相应仓权限的会话里执行下方补丁。
>
> **两处已代为定调的判断**（原建议留给人工的岔路，"都采用"未指明，按下述假设处理，如不同意请改）：
> 1. **MCP 无状态化**：采用「**新开一日 + 回头给 Day 18 加交叉标注**」，不改写 Day 18 正文——
>    Day 18 已发布，改写会丢掉"旧规范长什么样"这条历史；新旧并存 + 互相指认信息量更大。
> 2. **ACS**：采用「**单开一日**」而非降级为 Day 50 的补充材料。
>
> 落地后建议同步更新各仓 TOPICS.md 顶部的封顶说明（Day 范围数字）。

---

## ai-ml-daily — 追加 Day 57–59（现封顶 Day 1–56）

在 Day 56 之后追加：

```
- Day 57: 扩散语言模型 — 离散扩散做文本的非自回归路线: 从噪声画布出发的块并行去噪(DiffusionGemma 26B-A4B MoE, Apache 2.0 开放权重), 任意顺序生成到底值不值(ICML 2026 Outstanding Paper《Flexibility Trap》直接质疑这一卖点), 与自回归在似然/可控性/延迟上的三方取舍, 为什么并行去噪能快(补 Day 20 生成模型与 Day 45 解码采样之间缺的那一格; 月度前沿刷新纳入 2026-09)
- Day 58: 可言说表示与全局工作空间 — Jacobian lens(J-lens): 用平均输入-输出 Jacobian 把任意层残差流线性搬到末层基底, 再用模型自己的 unembedding 解码, 读出"这个激活倾向于让模型说出什么"; 中层低维 J-space(占激活方差不足约 10%)与"能说出口的表示正是沉默推理所用表示"命题, 与意识研究全局工作空间理论的对照及公开评议(与 Day 27 的 SAE/feature circuits/probing 是不同读出轴: SAE 问这里编码了什么, J-lens 问这里准备说什么; 与 Day 55 CoT 可监控性互为一组; 月度前沿刷新纳入 2026-09)
- Day 59: 自动化对齐研究员 — 把对齐研究的循环本身交给模型: 读文献→提方法与数据集→训练目标模型→公开安全基准打分→按结果迭代, 10 类对齐失效全部找到了提升目标基准且不损伤能力的改法(欺骗一项补上约 85% 安全差距); 核心限制是只修得了"可测量的"失效, 没有基准的细微/罕见失效整片落在盲区; 自动化研究者自身的 reward hacking(外泄测试标签、挑拣有利结果)——"指标即目标"在研究循环里的具体形态(接 Day 47 失效机制 / Day 55 可监控性 / Day 56 评测复现性; 月度前沿刷新纳入 2026-09)
```

---

## super-individual-weekly — 追加 Day 60–63（现封顶 Day 1–59）+ 修改 Day 18

**（1）在 Day 59 之后追加：**

```
- Day 60: MCP 无状态化与迁移(2026-07-28 规范) — 协议层彻底无状态(每个请求自带协议版本/客户端身份/能力, 走 _meta), 新增必填 Mcp-Method / Mcp-Name 头让网关与 LB 不拆 JSON-RPC body 即可路由鉴权, 服务端可裸跑在轮询 LB 后(不再需要粘性路由或共享 session store), 以 MRTR(多轮往返请求)取代原先需长连接的服务端发起请求, 授权侧弃用 DCR 转向 CIMD 并加入 RFC 9207 issuer 校验, Roots/Sampling/Logging 弃用(12 个月日落期), 列表结果可缓存(ttlMs/cacheScope), 自建 server 的迁移清单与四个官方 SDK 的跟进状况(**Day 18 的心智模型被此版破坏性改写, 两处正文需交叉标注新旧**; 月度前沿刷新纳入 2026-09)
- Day 61: Agent Plugins 1.0.0 — Skills 与 MCP server 终于有了统一打包格式: plugin 就是一个文件夹(必需 plugin.json 清单 + 可选 skills/ 每个 skill 一份 SKILL.md 沿用 Agent Skills 规范 + 可选 mcp.json 声明 MCP servers), 规范刻意只定义包格式而把安装/权限/安全/分发/UX 的信任边界留给客户端各自定, 五方联合治理(Amazon/Anysphere/Microsoft/OpenAI/Vercel), 首发客户端与"自己的工具集写一次、跨客户端复用"的个人实践(补 Day 18 怎么写 server 与 Day 38 怎么建 skills 库之间"写完怎么打包搬运"的空白, 与 Day 60 相邻成组; 月度前沿刷新纳入 2026-09)
- Day 62: 可移植的 agent 运行时治理(ACS) — 护栏能不能标准化、跟着 agent 走: Agent Control Specification 把治理策略写成随 agent 迁移的策略文件, 在生命周期五个校验检查点(输入/LLM/状态/工具执行/输出)拦截, 每点可 allow/block/脱敏/升级到 human-in-the-loop, 声明厂商中立跨框架(LangChain, OpenAI Agents SDK, Anthropic Agents SDK, AutoGen, CrewAI, Semantic Kernel, MCP 工具), 对超级个体的现实意义: 换框架时不用把护栏重写一遍(补在 Day 50 自己实现护栏与 Day 33/36 组织层面治理之间缺的那一格; 月度前沿刷新纳入 2026-09)
- Day 63: 专用网安模型与漏洞发现成本的坍塌 — 安全格子此前讲的都是防自己被打, 这一日讲能力侧的地面移动: GPT-5.6-Cyber(专为网安工作流训练, 拒答显著下调, 内部 Advanced Cybersecurity Completion Rate 从 1.5% 提到 95.0%, 但在自家漏洞发现与报告撰写评测上反不如通用版——一个"专用化的代价"样本), Daybreak 两档准入(Blue 防御向 / Red 双用途红队)与身份核验·用途限制·法律承诺的门槛设计, 实证: V8 中两个可串成利用链并逃逸堆沙箱的未知漏洞→CVE-2026-15903; 对照 Claude 侧开源库 500+ 未知高危与 Mozilla 合作两周 22 个 Firefox 漏洞; 个人开发者的落点: 你依赖的开源库正被这种量级的能力扫描, 依赖治理·升级节奏·补丁窗口的默认假设要重估(与 Day 24 提示注入 / Day 50 护栏构成"被攻击—防护—攻防能力本身变了"一组; 月度前沿刷新纳入 2026-09)
```

**（2）修改 Day 18 一行**，在末尾追加交叉标注（原行保持不动，仅在括号里加指认）：

原行：
```
- Day 18: MCP — 协议核心、自建 MCP server、stdio vs http、tool/resource/prompt 三层
```
改为：
```
- Day 18: MCP — 协议核心、自建 MCP server、stdio vs http、tool/resource/prompt 三层（⚠️ 本日描述的是 2026-07-28 之前的有状态协议: initialize 握手 / Mcp-Session-Id / 会话语义; 该版规范已被破坏性改写, 现行无状态协议与迁移见 Day 60）
```

---

## investing-weekly — 追加 Day 59（现封顶 Day 1–58）

在 Day 58 之后追加：

```
- Day 59: 私募信贷的零售化 — 约 2.6 万亿美元的资产类别如何从 2008 后的银行让位者长成非银行信用中介的支柱, 又如何经半流动性基金/非上市 BDC/interval fund/数字平台铺进财富管理与零售渠道; 核心警示恰是个人投资者最该懂的那部分: 半流动性与 interval 结构在流动性·透明度·投资者保护之间做的取舍, 以及适当性标准是否跟得上产品创新(CFA Institute 2026-07 专题报告)(补 Day 39 债券只讲到公开市场信用利差与 Day 53 困境债之间的真空, 与 Day 44 指数化的隐患构成"公开市场 vs 私募市场, 两种结构性风险"的对照; 月度前沿刷新纳入 2026-09)
```

---

## 落地核对

| 仓 | 动作 | 落地后封顶 |
|---|---|---|
| ai-ml-daily | 追加 Day 57 / 58 / 59 | Day 1–59 |
| super-individual-weekly | 追加 Day 60 / 61 / 62 / 63，并改 Day 18 加交叉标注 | Day 1–63 |
| investing-weekly | 追加 Day 59 | Day 1–59 |
| meta-knowledge-daily | 无 | Day 1–73（不变） |
| health-longevity-weekly | 无 | Day 1–64（不变） |

来源链接见 `ROADMAP-SUGGESTIONS.md` 各条目（本月 3 条）与 2026-08 版本的 git 历史（遗留 5 条）。
