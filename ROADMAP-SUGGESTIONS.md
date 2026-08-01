# Roadmap 前沿刷新建议（月度巡检）

> 生成日期：2026-08-01　｜　覆盖周期：2026 年 7 月
> 本文件仅为**建议**，不修改任何仓库的 TOPICS.md / 页面 / 封顶。是否采纳由人工决定。
> 纪律：宁缺勿滥；每条来源均已 WebSearch/WebFetch 验证真实存在。

## 上月遗留（2026-07 巡检）
- ✅ **AP2 / 智能体商务与支付协议**：已采纳为 super-individual Day 52。
- 🔭 **Nested Learning**：仍为 watching。本月未见 Google 之外的独立复现或进入主流综述，维持不采纳。

---

## ai-ml-daily（AI/ML 学术，已封顶 Day 1–55）

**建议 1：扩散语言模型（Diffusion LM）— 非自回归的文本生成路线**
- 为什么值得加：roadmap 里「扩散」只出现在 Day 20 的图像生成语境，Day 45「解码与采样数学」整篇建立在自回归逐 token 之上——而**离散扩散做文本**已经从实验路线走成了可下载的开放权重。Google 于 2026-06-10 放出 **DiffusionGemma**（基于 Gemma 4 的 26B/4B-active MoE，从噪声画布出发按 256-token 块并行去噪，官方称单张 H100 上 >1000 tok/s、约为同级自回归模型的 4 倍），Apache 2.0 权重公开；紧接着 ICML 2026（7 月 6–11 日，首尔）的 Outstanding Paper 之一 *Flexibility Trap: Rethinking the Value of Arbitrary Order in Diffusion Language Models* 直接质疑「任意顺序生成」这一扩散 LM 卖点的实际价值。一个「开放权重已落地 + 顶会同期打问号」的组合，正好够单列一日讲清楚：为什么并行去噪能快、任意顺序到底值不值、它与自回归在似然/可控性上的真实取舍。属机制/概念层，与 super-individual 的工程分工不冲突。
- 来源：[Google AI — DiffusionGemma 模型文档](https://ai.google.dev/gemma/docs/diffusiongemma)　｜　[Hugging Face — google/diffusiongemma-26B-A4B-it](https://huggingface.co/google/diffusiongemma-26B-A4B-it)　｜　[The Register — Google's DiffusionGemma (2026-06-11)](https://www.theregister.com/ai-and-ml/2026/06/11/googles-diffusiongemma-uses-diffusion-tech-to-speed-text-generation/5254406)　｜　[ICML 2026 Awards](https://blog.icml.cc/2026/07/05/announcing-the-icml-2026-awards/)
- 建议位置：Day 55 之后（承接 Day 20 生成模型与 Day 45 解码采样，作为二者之间缺的那一格）

**建议 2：可言说表示与「全局工作空间」（J-lens）— 可解释性的新读出工具**
- 为什么值得加：Anthropic 可解释性团队 7 月发表 *Verbalizable Representations Form a Global Workspace in Language Models*，提出 **Jacobian lens（J-lens）**：用平均输入-输出 Jacobian 把任意层的残差流向量线性搬运到末层基底、再用模型自己的 unembedding 解码，读出「这个激活倾向于让模型说出什么」。据此论证模型中层存在一个占激活方差不足约 10% 的低维子空间（J-space），**模型能说出口的表示，正是它沉默推理时用的那批表示**，并与意识研究的全局工作空间理论对照。这与 Day 27（SAE / feature circuits / probing）是**不同的读出轴**——SAE 问「这里编码了什么特征」，J-lens 问「这里准备让模型说什么」——且直接接上 Day 55 的 CoT 可监控性（一个可监控的内部状态，理论上能在输出前发现隐藏推理）。官方开源了配套代码，学界已有公开评议（LessWrong 有针对该论文的 review），够正反两面讲。
- 来源：[Transformer Circuits — Verbalizable Representations Form a Global Workspace in Language Models](https://transformer-circuits.pub/2026/workspace/index.html)　｜　[GitHub — anthropics/jacobian-lens（配套代码，Apache 2.0）](https://github.com/anthropics/jacobian-lens)　｜　[Forbes — Anthropic Illuminates LLM J-Space With J-Lens (2026-07-12)](https://www.forbes.com/sites/johnwerner/2026/07/12/anthropic-illuminates-llm-j-space-with-j-lens/)　｜　[LessWrong — A Review of Anthropic's Global Workspace Paper](https://www.lesswrong.com/posts/zFJ3ZdQwrTWE9jT5S/a-review-of-anthropic-s-global-workspace-paper)
- 建议位置：Day 55 之后（承接 Day 27 可解释性，与 Day 55 CoT 监控互为一组）

---

## super-individual-weekly（AI 工程实战，已封顶 Day 1–59）

**建议 1：MCP 2026-07-28 —「无状态化」重写与迁移**
- 为什么值得加：Day 18 讲 MCP 时的心智模型（initialize 握手、`Mcp-Session-Id`、stdio vs http 的会话语义）**在 7 月 28 日发布的新版规范里被直接拆掉了**——这是 MCP 至今最大的一次修订，且是破坏性的。要点：协议层彻底无状态（每个请求自带协议版本/客户端身份/能力，走 `_meta`）；新增必填 `Mcp-Method` / `Mcp-Name` 头，让网关和负载均衡不用拆 JSON-RPC body 就能路由与鉴权；服务端可以裸跑在轮询 LB 后面，不再需要粘性路由或共享 session store；以 **MRTR（多轮往返请求）** 取代原先需要长连接的服务端发起请求；授权侧弃用 Dynamic Client Registration 转向 CIMD 并加入 RFC 9207 issuer 校验；Roots / Sampling / Logging 正式弃用（12 个月日落期）；列表结果可缓存（`ttlMs` / `cacheScope`）。对自建 MCP server 的个人开发者，这是一次必须动手的迁移，四个官方 SDK（TS/Python/Go/C#）均已跟进。**这一条与其说是新主题，不如说是 Day 18 的时效性坍塌**——是新开一日讲「无状态化与迁移」还是回头改写 Day 18，请人工定夺。
- 来源：[MCP Blog — The 2026-07-28 Specification](https://blog.modelcontextprotocol.io/posts/2026-07-28/)　｜　[MCP Blog — 2026-07-28 Release Candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)　｜　[AWS — How AgentCore Gateway supports the MCP 2026-07-28 spec](https://aws.amazon.com/blogs/machine-learning/how-agentcore-gateway-supports-the-mcp-2026-07-28-spec/)　｜　[Microsoft — MCP Just Went Stateless](https://techcommunity.microsoft.com/blog/appsonazureblog/mcp-just-went-stateless-%E2%80%94-what-the-2026-spec-changes-about-scaling-on-app-servic/4530222)
- 建议位置：Day 59 之后（或改写 Day 18；若新开一日，正文需与 Day 18 明确交叉标注新旧）

**建议 2：可移植的 agent 运行时治理（Agent Control Specification）**
- 为什么值得加：Day 50 讲的是**自己实现**护栏（输入输出过滤、PII 脱敏、沙箱），Day 33/36 讲的是**组织层面**的治理流程——中间缺的一格是「护栏本身能不能标准化、跟着 agent 走」。微软 2026-06-02 开源的 **ACS（Agent Control Specification）** 正是这一格：把治理策略写成一个随 agent 迁移的策略文件，在 agent 生命周期的五个校验检查点（输入 / LLM / 状态 / 工具执行 / 输出）上拦截，每点可 allow / block / 脱敏 / 升级到 human-in-the-loop；声明为厂商中立、开源、跨框架（LangChain、OpenAI Agents SDK、Anthropic Agents SDK、AutoGen、CrewAI、Semantic Kernel、MCP 工具）。对超级个体的现实意义是：换框架时不用把护栏重写一遍。**时点说明**：严格算它属于 6 月初而非 7 月，之所以仍列出，是因为它填的是 roadmap 明确空白、且是 Day 52 之后又一个「新协议/标准层」——同类判断上月已有先例（AP2）。若嫌新意不足，也可作为 Day 50 的补充材料而非单开一日。
- 来源：[Microsoft — Agent Control Specification: Portable runtime governance for AI Agents](https://commandline.microsoft.com/agent-control-specification-runtime-governance/)　｜　[Microsoft Foundry Blog — Build agents you can trust across any framework](https://devblogs.microsoft.com/foundry/build-2026-open-trust-stack-ai-agents/)　｜　[ACS 文档（Agent Governance Toolkit）](https://microsoft.github.io/agent-governance-toolkit/packages/agent-control-specification/)　｜　[TechCrunch — Microsoft offers devs a better way to control AI agent behavior (2026-06-02)](https://techcrunch.com/2026/06/02/microsoft-offers-devs-a-better-way-to-control-ai-agent-behavior/)
- 建议位置：Day 59 之后（紧邻 Day 50 安全护栏与 Day 52 协议层）

---

## investing-weekly（投资，已封顶 Day 1–58）

**建议 1：私募信贷的「零售化」— 个人投资者被递到面前的新结构**
- 为什么值得加：这是 roadmap 的真空——Day 39 债券只讲到公开市场的信用利差，Day 53 触及困境债，Day 18 覆盖的是早期股权，**私募信贷（private credit）作为一个已达约 2.6 万亿美元、正主动向零售端铺货的资产类别，一格没有**。CFA Institute 于 2026 年 7 月发布专题研究报告，主题正是市场结构、基金设计与零售准入：私募信贷如何从 2008 后的银行让位者长成非银行信用中介的支柱，以及它如何通过半流动性基金、非上市 BDC、interval fund 与数字平台进入财富管理与零售渠道；报告的核心警示恰好是个人投资者最该懂的那部分——半流动性/interval 结构在流动性、透明度与投资者保护之间做的取舍，以及适当性标准是否跟得上产品创新。对本仓「个人投资者视角」的定位是高度对口的一条，且可与 Day 44（指数化的隐患）形成「公开市场 vs 私募市场，两种结构性风险」的对照。
- 来源：[CFA Institute Research & Policy Center — Private Credit: Market Structure, Fund Design, & Retail Access (2026-07)](https://rpc.cfainstitute.org/research/reports/2026/private-credit-market-structure-fund-design-retail-access)　｜　[报告 PDF](https://rpc.cfainstitute.org/sites/default/files/docs/research-reports/rpc_private-credit_marketstructure-funddesign-andretailaccess_online.pdf)　｜　[CFA Institute — Private Market Investing 专题](https://rpc.cfainstitute.org/topics/private-market-investing)
- 建议位置：Day 58 之后（承接 Day 39 债券与 Day 53 特殊机会，与 Day 44 指数化的隐患对照）

---

## meta-knowledge-daily（元知识，已封顶 Day 1–72）

本月无新增。检索到的元科学/复现率新数字均无法追到一手研究（正是 Day 66「僵尸统计」与 Day 70「先问尺子」提醒要警惕的那类引用），按引用纪律不列入。

## health-longevity-weekly（健康长寿，已封顶 Day 1–64）

本月无新增。检索到的「2026 长寿突破」条目多为营销向汇编、缺可核验的一手试验报告，未见改变临床共识的新循证结论。

---

### 巡检备注
- 本月 5 条建议，分布：ai-ml 2 / super-individual 2 / investing 1 / meta-knowledge 0 / health 0。
- 严格落在「过去一个月」窗口内的是：MCP 2026-07-28 规范（7/28）、J-lens 论文（7 月）、ICML 2026 颁奖（7/5–7/11）、CFA 私募信贷报告（7 月）。DiffusionGemma（6/10）与 ACS（6/2）略早于窗口，已在条目内标注时点，保留理由是二者所填的均为 roadmap 明确空白且势头仍在扩张。
- **super-individual 建议 1 性质特殊**：它不是「新增一个没讲过的主题」，而是「已发布的 Day 18 讲的协议被破坏性改写了」。这类时效性坍塌之前没在本巡检里出现过，处理方式（新开一日 / 回头改写 / 加勘误）需人工定一次调，之后可作为惯例。
- 本月未采纳的候选，备录：ICML 2026 Outstanding Position Paper《The alignment community is unintentionally building a censor's toolkit》（对齐方法的双用途风险）——议题好，但与 ai-ml Day 26/47 的对齐主题重叠度偏高，且属立场论文而非新机制，暂不单列。
- 经典领域（哲学 / 佛学 / 儒释道 / 数学 / 历史 / 思维模型 / 传记 / 艺术）按纪律默认无新增，本月未见范式级新发现。
