# 共享脚本的页面形态清单

`reads.js` / `notes.js` / `comments.js` / `engage.js` / `offline.js` 由 `index-button.js`
注入到全站 30+ 个 repo。写或改任何一个之前，先对着这张表过一遍——不是每个页面都长成
"一个路径 = 一篇静态文章"。

| 形态 | 例子 | 会咬人的地方 |
|---|---|---|
| 静态文章 | `/philosophy/xxx.html` | 默认假设，没问题 |
| repo 索引 | `/philosophy/index.html` | 条目类名是 `.entry` |
| **一个文件 = 多篇内容** | `/thinker-arena/debate.html?d=<slug>` | 用 `location.pathname` 做 key 会把 100+ 场辩论并成一条记录 |
| **客户端渲染** | 同上 + `/thinker-arena/index.html` | DOMContentLoaded 时是空壳，内容 fetch 回来才有 |
| 非 `.entry` 的索引 | `/thinker-arena/index.html` 的 `.topic-card` | 全站类名约定它没跟 |

## 新共享功能自检三问

1. **key 是什么？** 用 `pathname + 内容相关的 query`，不要用裸 `pathname`。
   `reads.js` / `notes.js` 里的 `keyOf()` / `pageKey()` 是现成的写法（`NOISE_PARAMS`
   负责甩掉 `me` / `utm_*` 这类只影响 UI 的参数）。
2. **内容什么时候到？** 挂载前等内容出现（`reads.js` 的 `whenPresent()`），
   别 `querySelector` 一次拿不到就 `return`。
3. **thinker-arena 试过没有？** 它是独立 repo，改共享脚本时不会顺手打开它，
   于是每次都漏。debate 页 + 议题列表页各开一次，两分钟的事。

## 为什么值得写下来

这三条已经踩过两遍：`notes.js` 修好了 query key（注释里就写着 debate.html），
`reads.js` 后来又原样踩进去，而且**失败是静默的**——找不到内容就 return，
没有报错、没有 console 警告，只有真去用的时候才发现「debate 页没有已读」。

本地验证：`python3 ../serve-offline.py`，然后开
`/thinker-arena/debate.html?d=<slug>` 和 `/thinker-arena/index.html`。
