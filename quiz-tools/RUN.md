# 题库每日补题

目录：仓库 cissy0802.github.io 的 `quiz-tools/`，命令都在这里跑。先 `git -C .. pull --ff-only origin main`。

平时由云端 routine 运行：那里只挂载了这个仓库，`bank.py` 会把各站点克隆到 `work/clones/` 读原文，读者记录从 engage worker 的 `/quiz-reads` 取（环境变量 `BIGCAT_ADMIN_TOKEN`）。在笔记本上跑时自动改用旁边的本地仓库和 `~/.bigcat-hub/.env`。

1. `python3 bank.py todo --n 15`。它决定今天出哪些文章（先补 `QUIZ_PRIORITY_USER` 读过的，再补别人读过的，最后是其余文章），它失败（克隆失败、`/quiz-reads` 失败、缺 token）就停下汇报，不要自己挑文章。
2. 按 `WRITE-QUESTIONS.md` 写 `work/draft.json`，跑 `python3 bank.py build` 直到 OK。
3. 派一个**全新的 subagent** 按 `BLIND-CHECK.md` 盲答。只给它这份文件的路径，不要告诉它答案，也不要自己代答。
4. `python3 bank.py check`。只有这一步会写进 `../quiz/`，被丢弃的题不要手工加回去。
5. 只提交题库：`git -C .. add quiz quiz-tools/attempts.json`，提交信息 `Quiz bank: +N articles`，然后 `git -C .. fetch origin main && git -C .. rebase origin/main && git -C .. push origin HEAD:main`（云端是在 claude/* 分支上，必须推到 main 才会上线）。推送失败就汇报，不算完成。
6. 汇报：新增几篇几题、丢弃几题及原因、题库总量、出题时发现的文章问题（有争议的研究被当定论、两篇互相矛盾）。

不要改 `bank.py`、指南、`quiz.html`；发现问题就写进汇报。
