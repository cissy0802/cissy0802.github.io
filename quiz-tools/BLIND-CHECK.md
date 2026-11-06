# 盲答核对

你是第二个读者，要独立判断题目的答案。不要读 `work/draft.json` 或 `work/pending.json`，那里有作者的答案。

读 `work/blind.json`，对每道题读它的 `src` 文件，只依据这篇正文作答。写 `work/blind_answers.json`：

```json
[{"id": "题目 id", "choice": 2}]
```

`choice` 是 options 的下标（从 0 开始）。如果正文支持不止一个选项，或哪个选项都不能确定，写 `"choice": -1`，不要猜。这类题会被丢弃，这正是核对的目的。
