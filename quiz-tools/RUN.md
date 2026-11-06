# 题库每日补题

目录：`~/Desktop/repos/cissy0802.github.io/quiz-tools`，命令都在这里跑。先 `git -C .. pull --ff-only`。

1. `python3 bank.py todo --n 15`。它决定今天出哪些文章（有人读过的优先），`wrangler` 失败就停下汇报，不要自己挑文章。
2. 按 `WRITE-QUESTIONS.md` 写 `work/draft.json`，跑 `python3 bank.py build` 直到 OK。
3. 派一个**全新的 subagent** 按 `BLIND-CHECK.md` 盲答。只给它这份文件的路径，不要告诉它答案，也不要自己代答。
4. `python3 bank.py check`。只有这一步会写进 `../quiz/`，被丢弃的题不要手工加回去。
5. 只提交题库：`git -C .. add quiz quiz-tools/attempts.json`，提交信息 `Quiz bank: +N articles`，然后 `git -C .. pull --rebase` 并 push 到 main。
6. 汇报：新增几篇几题、丢弃几题及原因、题库总量、出题时发现的文章问题（有争议的研究被当定论、两篇互相矛盾）。

不要改 `bank.py`、指南、`quiz.html`；发现问题就写进汇报。
