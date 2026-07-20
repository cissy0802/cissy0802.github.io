# 跨站合成 · Synthesis TOPICS

Hub 层的季度长文路线图。**这条线的目的是把存量变成网络,而不是继续加长列表**——不写新知识,只写「已经写过的东西之间的关系」。

## 这是什么

普通内容站回答「X 是什么」;合成文回答「**X 这个东西,在我这几个站里分别是什么,以及它们为什么对不上**」。每篇的源材料**全部来自本 hub 已发布的页面**,每一节都深链回源页——读者可以顺着链接钻回去,存量因此变成一张网。

## 选题标准(硬门槛)

一个概念**跨站出现**不构成选题理由。必须同时满足:

1. **甜区 4–8 站**。覆盖 15+ 站的概念(如「风险」18 站、「决策」21 站)写出来必然是浆糊——每站沾一句,哪站都不深。少于 4 站则不成网。
2. **各站的「机器」真正不同**。同一个词在各领域背后是不同的机制,而不是同一件事换个说法。
3. **有一个锋利的钩子**——通常是下面两种之一:
   - **断裂点**:类比在哪里失效(如热力学熵有物理定律撑腰,「房间会变乱」没有)
   - **透镜差**:同一对象被几个学科看见了不同的层
4. **源材料实打实**:至少 3 个站有**成篇**(而非顺带提及)的源页。

**反面教材**:凑数式的「这个词在 12 个站出现过」;把收敛写得太便宜(如「科学证实了佛陀」);没有断裂点的平铺罗列。

## 三种体裁

- **A. 同一个词,不同机器** —— 词旅行到别的领域,机器没跟过来。灵魂是**写清断裂在哪**。
- **B. 同一个对象,多重透镜** —— 一件事被几个学科各看到一层。灵魂是**透镜之间的互补与冲突**。
- **C. 同一套方法,跨域复用** —— 一种推理工具在各领域的不同要求与标准。

## 约定

- 文件名 `synthesis-{slug}.html` + `synthesis-{slug}.en.html`,放 hub 仓根目录(与 `blog-pipeline.html` 同级)
- **中英双语,手写独立页,无自动同步机制——改一版必须同时镜像另一版**(含 SVG 标签翻译)
- 每篇写完:① 把引用的源页路径登记进 `synthesis-map.json`(供反向链接注入);② 确认 `build-search.yml` 已把 hub 内容页纳入索引
- **暂不做 routine**。季度一篇的频率不值得自动化;先手写 3–4 篇、骨架稳定后再议
- **合成文是活的**:源站继续更新时,已发布的合成文可以增补新的一节(如 physics 补上拓扑物态后,Syn 16 才补齐)

---

## 第一梯队(材料厚 + 钩子锋利,先写这 6 篇)

- **Syn 1: 熵** 〔A〕— 断裂:热力学熵有物理定律撑腰,「房间会变乱」没有。全网被滥用最狠的概念。
  源:`physics/entropy-arrow-day7`(100 次) · `ai-ml/probability-information-day33`(75) · `mathematics/information-theory-day13`(46) · `mental-models/information-theory-day58`、`physics-thinking-day36` · `meta-knowledge/bioenergetics-day23`(生命作为抗熵机器) · `deep-reading/order-of-time-read18`(时间之箭)、`flow-read15`(精神熵) · `book-recommendations/time-many-faces-book29`

- **Syn 2: 合作的演化** 〔A/C〕— 「为什么会有合作?」四套**互不相容**的答案:演化生物学算基因的账(汉密尔顿 `rB>C`)、博弈论算重复的账(Axelrod 的 tit-for-tat)、国际关系算可信承诺的账、佛学**拒绝算账**(菩萨道不图回报)。前三套用「其实是自利」消解利他,第四套掀桌子。收尾落在自然主义谬误。
  源:`mental-models/game-cooperation-day28`(博弈 60 / 合作 21)、`strategy-day04`、`evolutionary-psychology-day53` · `meta-knowledge/game-theory-day11`(40)、`trust-cooperation-day58`(26)、`evolutionary-biology-day4` · `deep-reading/selfish-gene-read2`(合作 28 / 选择层级 15) · `civics-geopolitics/war-and-peace-rules-day13`(可信承诺 13)、`great-power-rivalry-day10` · `buddhism/bodhisattva-day11`(利他 21) · `leadership/office-politics-day6`(19) · `philosophy/individual-society-day15`、`ethics-virtue-day5` · `psychology/evolutionary-psychology-day32` · `sales/trust-currency-day2`(信任作为昂贵信号)
  待补:book-recommendations Issue 62《博弈论与合作的演化》发布后再加一节书单锚点

- **Syn 3: 自我,与无我** 〔B〕— 全站最惊人的一次东西方收敛:佛学两千年前说「无我」,神经科学从**注意图式理论**走到几乎同一结论——自我是大脑造的一个模型、一个有用的失真。**但别让收敛太便宜**:佛学的无我是修行结论(看破我执为离苦),神经科学的自我模型是价值中立的机制描述;把 AST 当成「科学证实了佛陀」是廉价的胜利。收尾落在意识难题——两条路都没解决「为什么会有主观体验」。
  源:`buddhism/dialogue-day31`(无我 35)、`lankavatara-day17`、`yogacara-day3`、`mysticism-day36` · `neuroscience/self-model-topic12`(注意图式)、`global-workspace-topic13`、`hard-problem-topic10`、`neural-correlates-topic11` · `philosophy/free-will-day3`(无我 16)、`life-death-day6`(人格同一性)、`consciousness-awareness-day25`、`existence-day1` · `psychology/consciousness-day24` · `book-recommendations/mind-machine-book9` · `deep-reading/being-you-read20`
  已知缺腿:**AI 那条**(「LLM 有没有自我」)几乎无材料,仅 `cs-papers-deepread/constitutional-ai-paper15` 沾边

- **Syn 4: 注意力** 〔A〕— 词从心理学 → 机器学习 → 经济学**旅行了三轮**,三套机器毫无关系:Transformer 的 QK 点积、丘脑的选择性门控、作为稀缺资源被交易的注意力。
  源:`ai-ml`(8 页,注意力机制) · `neuroscience/attention-topic2` · `super-individual`(5 页,注意力经济) · `cs-papers-deepread`(2 页) · `mental-models` · `philosophy`(专注)

- **Syn 5: 记忆** 〔A/B〕— 「模型记忆」和「人的记忆」是不是同一回事?LLM 的 context window ≠ 记忆,参数里的也不是——这个混淆在产品设计上代价很大。
  源:`neuroscience/long-term-memory-topic4`、`working-memory-topic3` · `ai-ml`(8 页) · `meta-knowledge`(间隔重复) · `mental-models`(6 页) · `super-individual`(6 页,agent 记忆工程) · `book-recommendations`(7 页)

- **Syn 6: 因果** 〔C〕— 史学家、流行病学家、ML 工程师说「因果」时,**要求的证据标准差三个数量级**。
  源:`history`(23 页,史学因果) · `health-longevity`(混杂与 RCT) · `ai-ml`(相关≠因果) · `meta-knowledge`(Pearl 因果阶梯) · `mathematics`
  待补:meta-knowledge Day 67「因果推断」发布后作为主锚

## 第二梯队(成立,材料够)

- **Syn 7: 复利** 〔A〕— 断裂:金融复利有**再投资**这个物理机制;「技能复利」「人脉复利」只是激励隐喻,没有对应机制。
  源:`investing`(17 页) · `personal-finance` · `leadership` · `writing` · `mental-models`

- **Syn 8: 睡眠** 〔B〕— B 类范本:同一件事的生理 / 认知 / 发育 / 行为四层透镜。
  源:`health-longevity`(21 页,含 `sleep-day3`) · `neuroscience`(记忆巩固) · `psychology` · `parenting` · `mental-models`

- **Syn 9: 死亡与有限性** 〔B〕— 科学延长它、佛学接受它、哲学追问它——三种回应同一个事实。
  源:`health-longevity`(衰老生物学 5 页) · `buddhism`(无常) · `philosophy/life-death-day6` · `deep-reading` · `book-recommendations`

- **Syn 10: 苦 / 疼痛** 〔B〕— 「苦」(dukkha)和「pain」在翻译层就不是一回事:一个是生理信号,一个是存在论判断。
  源:`buddhism`(11 页,苦谛) · `health-longevity`(疼痛生理) · `psychology`(慢性痛与情绪) · `philosophy` · `mental-models` · `deep-reading`

- **Syn 11: 幂律与长尾** 〔A〕— 断裂:大量被声称的「幂律」其实是对数正态,**误判会毁掉风险模型**。
  源:`mental-models`(6 页) · `ai-ml`(scaling law) · `investing`(尾部风险) · `cs-papers-deepread` · `mathematics` · `meta-knowledge`

- **Syn 12: 叙事** 〔B〕— 同一个工具:被用来写作、被用来构建自我、被用来给公司定价。
  源:`writing`(22 页,技艺) · `book-recommendations`(16 页) · `investing`(故事驱动估值 9 页) · `psychology`(叙事身份) · `biographies` · `art-aesthetics`

## 第三梯队(成立但更窄,或需等材料长出来)

- **Syn 13: 免疫** 〔A〕— 「认知免疫 / 思想接种」这个借喻,借得有多准确?生物免疫有记忆细胞和特异性,认知接种有对应物吗?
  源:`health-longevity`(6 页) · `meta-knowledge`(6 页,接种理论) · `psychology` · `deep-reading`

- **Syn 14: 情绪** 〔B〕— 建构论(情绪是被造出来的)vs 基本情绪论,以及审美情绪为何被排除在心理学之外。
  源:`psychology`(25 页) · `neuroscience/emotion-construction-topic8` · `parenting`(19 页) · `art-aesthetics`(18 页) · `leadership`

- **Syn 15: 临界与相变** 〔A〕— 材料最多(14 站)但**必须收窄**,否则写散。锁定四条腿即可:物理相变 / 历史革命 / 系统过载崩溃 / 疾病阈值。
  源:`physics` · `history` · `system-design` · `health-longevity` · `mental-models`(tipping point)

- **Syn 16: 拓扑** 〔A〕— 亮点:`neuroscience` 的**视网膜拓扑映射(retinotopy)是拓扑的字面实现**——大脑真的在跑连续映射;而 `system-design` 的「网络拓扑」是完美的断裂案例:词旅行了,「连续形变下的不变量」那套机器一点没跟过来。
  源:`mathematics/topology-day9`(26)、`graph-theory-day8` · `meta-knowledge/topology-day62`(48) · `mental-models/mathematical-structures-day67` · `neuroscience/ref-visual-pathway` · `system-design/cdn-edge-day28`
  **等材料**:physics 的拓扑物态(2016 诺奖那条线)尚未写,最硬的一条腿现在缺席。建议 physics TOPICS 补一行后再动笔
  **顺带发现**:`mathematics/topology-day9` 与 `meta-knowledge/topology-day62` 角度高度重合(都是「拓扑直觉科普」)——cross-ref-sync 只防 ai-ml↔super-individual,没人防这一对

- **Syn 17: 自由意志** 〔B〕— 甜区但材料偏薄(6 站/9 页)。与 Syn 3 有重叠(`philosophy/free-will-day3` 两边都用),写时需明确分工:Syn 3 问「谁在做决定」,本篇问「这个决定是不是自由的」。
  源:`physics`(决定论) · `philosophy/free-will-day3` · `neuroscience` · `deep-reading` · `super-individual`

---

## 已评估但不收录(记下来免得重复讨论)

- **信任与合作** —— 与 Syn 2 重叠过多(`meta-knowledge/trust-cooperation-day58` 是两者共同主锚),已并入 Syn 2
- **风险 / 不确定性**(18 站)、**决策**(21 站)、**稀缺**(12 站) —— 覆盖太广,不满足甜区门槛,写出来必然是浆糊
- **涌现**(10 站)、**贝叶斯**(11 站)、**非线性 / 混沌**(10 站) —— 略超甜区,若日后收窄到 4–6 条腿可重新考虑
- **美 / 审美**(5 站/9 页)、**群体与集体**(8 站/16 页) —— 甜区但材料偏薄,待存量增长
- **学习 / 技能**、**记忆巩固**单列 —— 已被 Syn 5 覆盖

## 扫描方法备忘(下次找选题时复用)

用关键词跨全站扫**已发布 HTML**(不是 TOPICS.md——路线图里的条目还没页面可链),按「站数 × 成篇页数」定位甜区。两个踩过的坑:

1. **必须剥 HTML 标签再统计**。否则 `<body>` 会让「身体」跨 22 站、`lang=` 属性会让「语言」跨 19 站、CSS 里的 `space` 会让「空间」跨 18 站——全是假阳性。
2. **短的英文缩写不能直接当关键词**。`ESS`(演化稳定策略)小写后匹配到 proc**ess** / l**ess** / addr**ess**,一次扫出 370 页垃圾。
3. **中文常用词要分维度**。「自我」在心理学站大量出现,但绝大多数是「自我效能 / 自我调节」,和「自我作为一个实体是否存在」无关——按维度分开扫才看得出真实材料。
