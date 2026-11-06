#!/usr/bin/env python3
"""Question bank for hub.cissychen.com/quiz.html — the deterministic half.

Claude writes the questions and, separately, answers them blind. This script
decides which articles are next and is the only thing that writes to /quiz/.

    python3 bank.py todo [--n 15]    # next articles -> work/batch.json + work/src/*.txt
    python3 bank.py build            # work/draft.json -> validate -> work/blind.json
    python3 bank.py check            # work/blind_answers.json -> publish what agrees
    python3 bank.py status
    python3 bank.py backfill-en      # work/en.json -> add English to questions already published

Nothing reaches /quiz/ until an independent blind answer matches the author's.
A question the second reader gets wrong is dropped, not argued with.
"""
import argparse, glob, hashlib, html, json, os, random, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HUB = os.path.dirname(HERE)
REPOS = os.path.dirname(HUB)
WORK = os.path.join(HERE, "work")
BANK = os.path.join(HUB, "quiz")
MANIFEST = os.path.join(BANK, "manifest.json")
ATTEMPTS = os.path.join(HERE, "attempts.json")
CREDS = os.path.expanduser("~/.bigcat-hub")
MAX_CHARS = 14000
MIN_CHARS = 800
MAX_ATTEMPTS = 2
NOT_CONTENT = {"cissy0802.github.io", "hub", "cissychen-homepage", "video-pipeline", "daily-quiz",
               "podcast-transcripts", "career-radar", "ai-code-review"}
SKIP = re.compile(r"(^|/)(index|404|skills|profiles|ideas|debate)(\.en)?\.html$")
TWIN = re.compile(r"-(plain|deep)\.html$")


def load(path, default):
    return json.load(open(path)) if os.path.exists(path) else default


def dump(obj, path):
    tmp = path + ".tmp"
    json.dump(obj, open(tmp, "w"), ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def canonical(page):
    return page.replace(".en.html", ".html")


CJK = re.compile(r"[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]")


def en_problems(question, options, explanation):
    """What is wrong with one question's English, as a list."""
    out = []
    question, explanation = str(question or "").strip(), str(explanation or "").strip()
    options = [str(o).strip() for o in (options or [])]
    if not question or not explanation:
        out.append("question_en/explanation_en empty")
    if len(options) != 4 or len(set(options)) != 4 or not all(options):
        out.append("need 4 distinct non-empty options_en, in the same order as options")
    if CJK.search(question + explanation + "".join(options)):
        out.append("English fields contain Chinese")
    return out


def en_page(page):
    """The English twin of a page, or None if there isn't one."""
    repo, rest = page.lstrip("/").split("/", 1)
    if rest.startswith("debate.html?d="):
        return f"/{repo}/debate.en.html?d=" + rest.split("=", 1)[1]
    en = rest.replace(".html", ".en.html")
    return f"/{repo}/{en}" if os.path.exists(os.path.join(REPOS, repo, en)) else None


def en_title(page):
    target = en_page(page)
    if not target:
        return None
    repo, rest = target.lstrip("/").split("/", 1)
    if rest.startswith("debate.en.html?d="):
        f = os.path.join(REPOS, repo, "debates", rest.split("=", 1)[1] + ".json")
        return json.load(open(f)).get("question_en") if os.path.exists(f) else None
    raw = open(os.path.join(REPOS, repo, rest), encoding="utf-8", errors="ignore").read()
    m = re.search(r"(?is)<title>(.*?)</title>", raw)
    t = html.unescape(m.group(1)).strip() if m else None
    return t if t and not CJK.search(t) else None


def bank_file(page):
    """/repo/x.html -> repo/x.json ; /thinker-arena/debate.html?d=s -> thinker-arena/debate-s.json"""
    repo, rest = page.lstrip("/").split("/", 1)
    rest = rest.replace(".html?d=", "-").replace(".html", "").replace("/", "__")
    return f"{repo}/{rest}.json"


def twin_of(page):
    """plain/deep versions of a piece share one set of questions, written from the deep one."""
    return TWIN.sub("-deep.html", page) if TWIN.search(page) else page


def reader_counts():
    """Returns (readers per article, articles the priority account has read)."""
    env = dict(os.environ)
    for line in open(os.path.join(CREDS, ".env")):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k.replace("export ", "").strip()] = v.strip().strip("\"'")
    owner = env.get("QUIZ_PRIORITY_USER", "")
    if not re.fullmatch(r"[0-9a-f-]{36}", owner):
        sys.exit("QUIZ_PRIORITY_USER missing from ~/.bigcat-hub/.env")
    sql = f"SELECT page, count(*) n, max(user_id = '{owner}') mine FROM reads WHERE is_read = 1 GROUP BY page"
    cmd = [os.path.join(CREDS, "node_modules/.bin/wrangler"), "d1", "execute", "bigcat-engage",
           "--remote", "--json", "--command", sql]
    err = ""
    for _ in range(3):
        p = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=CREDS)
        if p.returncode == 0:
            out, mine = {}, set()
            for r in json.loads(p.stdout)[0]["results"]:
                k = twin_of(canonical(r["page"]))
                out[k] = out.get(k, 0) + r["n"]
                if r["mine"]:
                    mine.add(k)
            if not mine:
                sys.exit("priority account has no read articles; check QUIZ_PRIORITY_USER")
            return out, mine
        err = (p.stderr + p.stdout)[-400:]
    sys.exit("wrangler failed: " + err)


def all_pages():
    pages = []
    for d in sorted(os.listdir(REPOS)):
        path = os.path.join(REPOS, d)
        if d in NOT_CONTENT or not os.path.isdir(os.path.join(path, ".git")):
            continue
        out = subprocess.run(["git", "-C", path, "ls-files", "*.html"], capture_output=True, text=True).stdout
        for f in out.split():
            if not f.endswith(".en.html") and not SKIP.search(f):
                pages.append(twin_of(f"/{d}/{f}"))
    for f in glob.glob(os.path.join(REPOS, "thinker-arena", "debates", "*.json")):
        pages.append("/thinker-arena/debate.html?d=" + os.path.basename(f)[:-5])
    return sorted(set(pages))


def html_to_text(s):
    s = re.sub(r"(?is)<(script|style|nav|header|footer|svg|button|noscript)[^>]*>.*?</\1>", " ", s)
    s = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h[1-6]|section|blockquote|tr)>", "\n", s)
    t = html.unescape(re.sub(r"<[^>]+>", " ", s))
    t = re.sub(r"[ \t ]+", " ", t)
    return re.sub(r"\n\s*\n+", "\n", t).strip()


def article(page):
    repo, rest = page.lstrip("/").split("/", 1)
    subprocess.run(["git", "-C", os.path.join(REPOS, repo), "pull", "--ff-only", "-q"],
                   capture_output=True, timeout=120)
    if repo == "thinker-arena" and rest.startswith("debate.html?d="):
        f = os.path.join(REPOS, repo, "debates", rest.split("=", 1)[1] + ".json")
        if not os.path.exists(f):
            return None, None
        d = json.load(open(f))
        parts = [d.get("question", ""), d.get("sub", "")]
        parts += [f"[{p.get('thinker')}] {p.get('text', '')}" for p in d.get("posts", [])]
        parts += [s.get("summary", "") for s in d.get("summaries", [])[:1]]
        return "辩论：" + d.get("question", ""), "\n".join(parts)
    f = os.path.join(REPOS, repo, rest)
    if not os.path.exists(f):
        return None, None
    raw = open(f, encoding="utf-8", errors="ignore").read()
    m = re.search(r"(?is)<title>(.*?)</title>", raw)
    title = html.unescape(m.group(1)).strip() if m else rest
    body = re.search(r"(?is)<(article|main)[^>]*>(.*)</\1>", raw)
    return title, html_to_text(body.group(2) if body else raw)


def cmd_todo(n):
    os.makedirs(os.path.join(WORK, "src"), exist_ok=True)
    for f in glob.glob(os.path.join(WORK, "src", "*")) + glob.glob(os.path.join(WORK, "*.json")):
        os.remove(f)
    done = load(MANIFEST, {"pages": {}})["pages"]
    tried = load(ATTEMPTS, {})
    counts, mine = reader_counts()
    rnd = random.Random(0)
    pages = list(set(all_pages()) | set(p for p in counts if not SKIP.search(p.split("?")[0])))
    # The priority account's reads first, then other readers' most-read, then the rest.
    pages.sort(key=lambda p: (p not in mine, -counts.get(p, 0), rnd.random()))
    batch = []
    for page in pages:
        if page in done or tried.get(page, 0) >= MAX_ATTEMPTS:
            continue
        title, text = article(page)
        if not text or len(text) < MIN_CHARS:
            continue
        slot = len(batch) + 1
        src = os.path.join(WORK, "src", f"{slot:02d}.txt")
        open(src, "w").write(text[:MAX_CHARS])
        batch.append({"slot": slot, "page": page, "title": title, "src": src,
                      "text_truncated": len(text) > MAX_CHARS,
                      "src_hash": hashlib.sha1(text.encode()).hexdigest()[:12]})
        if len(batch) == n:
            break
    dump({"articles": batch}, os.path.join(WORK, "batch.json"))
    print(f"{len(done)} articles in bank; next {len(batch)} -> work/batch.json")
    for b in batch:
        print(f"  {b['slot']:2d}. {'mine ' if b['page'] in mine else '     '}readers={counts.get(b['page'], 0)}  {b['page']}")


def cmd_build():
    batch = {a["slot"]: a for a in load(os.path.join(WORK, "batch.json"), {"articles": []})["articles"]}
    draft = load(os.path.join(WORK, "draft.json"), {"questions": []})["questions"]
    errs, qs, per = [], [], {}
    for i, q in enumerate(draft, 1):
        n_err = len(errs)
        a = batch.get(q.get("slot"))
        opts = [str(o).strip() for o in q.get("options", [])]
        if not a:
            errs.append(f"q{i}: slot {q.get('slot')} not in batch")
            continue
        if len(opts) != 4 or len(set(opts)) != 4 or not all(opts):
            errs.append(f"q{i}: need 4 distinct non-empty options, correct one FIRST")
        if not str(q.get("question", "")).strip() or not str(q.get("explanation", "")).strip():
            errs.append(f"q{i}: question/explanation empty")
        if len(opts) == 4:
            others = max(len(o) for o in opts[1:])
            if len(opts[0]) > 1.8 * others:
                errs.append(f"q{i}: correct option is by far the longest — a giveaway")
        errs += [f"q{i}: {e}" for e in en_problems(q.get("question_en"), q.get("options_en"), q.get("explanation_en"))]
        if re.search(r"第[一二三四1-4]项|选项\s*[A-Da-d1-4]|[A-D]\s*项|前者|后者", str(q.get("explanation", ""))):
            errs.append(f"q{i}: explanation refers to an option by position; options get shuffled")
        per[q["slot"]] = per.get(q["slot"], 0) + 1
        if per[q["slot"]] > 3:
            errs.append(f"q{i}: more than 3 questions for slot {q['slot']}")
        if len(errs) > n_err:
            continue
        qid = hashlib.sha1((a["page"] + q["question"]).encode()).hexdigest()[:10]
        order = list(range(4))
        random.Random(qid).shuffle(order)
        en_opts = [str(o).strip() for o in q["options_en"]]
        qs.append({"id": qid, "slot": q["slot"], "question": q["question"].strip(),
                   "options": [opts[j] for j in order], "answer": order.index(0),
                   "explanation": q["explanation"].strip(),
                   "question_en": q["question_en"].strip(),
                   "options_en": [en_opts[j] for j in order],
                   "explanation_en": q["explanation_en"].strip()})
    missing = sorted(set(batch) - set(per))
    if missing:
        print("note: no questions for slots", missing, "(allowed if the article cannot support a good one)")
    # By chance the answer is the longest option about a quarter of the time. Far
    # above that, readers can score by picking the longest without reading.
    if len(qs) >= 8:
        longest = sum(1 for q in qs
                      if len(q["options"][q["answer"]]) >= max(len(o) for o in q["options"]))
        if longest / len(qs) > 0.4:
            errs.append(f"correct option is the longest (or tied) in {longest}/{len(qs)} questions; "
                        "keep it at or under 40% by lengthening distractors or tightening answers")
        shortest = sum(1 for q in qs
                       if len(q["options"][q["answer"]]) <= min(len(o) for o in q["options"]))
        if shortest / len(qs) > 0.5:   # the overcorrection is just as learnable
            errs.append(f"correct option is the shortest (or tied) in {shortest}/{len(qs)} questions; "
                        "keep it at or under 50%")
    if len({q["id"] for q in qs}) != len(qs):
        errs.append("duplicate questions")
    if errs or not qs:
        print("REJECTED — fix work/draft.json and rerun build:")
        for e in errs or ["no questions"]:
            print("  -", e)
        sys.exit(1)
    dump({"questions": qs}, os.path.join(WORK, "pending.json"))
    blind = [{"id": q["id"], "slot": q["slot"], "src": batch[q["slot"]]["src"],
              "question": q["question"], "options": q["options"]} for q in qs]
    dump({"questions": blind}, os.path.join(WORK, "blind.json"))
    print(f"OK {len(qs)} questions -> work/blind.json, awaiting the blind check")


def cmd_check():
    batch = {a["slot"]: a for a in load(os.path.join(WORK, "batch.json"), {"articles": []})["articles"]}
    pending = load(os.path.join(WORK, "pending.json"), {"questions": []})["questions"]
    ans = {r["id"]: r.get("choice") for r in load(os.path.join(WORK, "blind_answers.json"), [])}
    missing = [q["id"] for q in pending if q["id"] not in ans]
    if missing:
        sys.exit(f"REJECTED — blind answers missing for {len(missing)} questions: {missing[:5]}")
    manifest = load(MANIFEST, {"pages": {}, "aliases": {}})
    tried = load(ATTEMPTS, {})
    kept, dropped = {}, []
    for q in pending:
        if ans[q["id"]] == q["answer"]:
            kept.setdefault(q["slot"], []).append(q)
        else:
            dropped.append(q)
    for slot, qs in kept.items():
        a = batch[slot]
        rel = bank_file(a["page"])
        path = os.path.join(BANK, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        dump({"page": a["page"], "title": a["title"], "page_en": en_page(a["page"]),
              "title_en": en_title(a["page"]), "src_hash": a["src_hash"],
              "questions": [{k: q[k] for k in ("id", "question", "options", "answer", "explanation",
                                               "question_en", "options_en", "explanation_en")} for q in qs]},
             path)
        manifest["pages"][a["page"]] = {"t": a["title"], "f": rel, "q": [q["id"] for q in qs]}
        if a["page"].endswith("-deep.html"):
            manifest["aliases"][a["page"].replace("-deep.html", "-plain.html")] = a["page"]
    for slot, a in batch.items():
        if slot not in kept:
            tried[a["page"]] = tried.get(a["page"], 0) + 1
    dump(manifest, MANIFEST)
    dump(tried, ATTEMPTS)
    print(f"published {sum(len(v) for v in kept.values())} questions from {len(kept)} articles; "
          f"dropped {len(dropped)} on the blind check")
    for q in dropped:
        print(f"  dropped slot {q['slot']}: {q['question'][:50]}  (author {q['answer']}, blind {ans[q['id']]})")
    print(f"bank: {len(manifest['pages'])} articles, {sum(len(p['q']) for p in manifest['pages'].values())} questions")


def cmd_backfill_en():
    """work/en.json: {id: {question_en, options_en, explanation_en}}; options_en follow the stored order."""
    en = load(os.path.join(WORK, "en.json"), {})
    errs, files = [], []
    for f in glob.glob(os.path.join(BANK, "*", "*.json")):
        d = json.load(open(f))
        for q in d["questions"]:
            e = en.get(q["id"])
            if not e:
                if "question_en" not in q:
                    errs.append(f"{q['id']}: no translation")
                continue
            errs += [f"{q['id']}: {p}" for p in en_problems(e.get("question_en"), e.get("options_en"), e.get("explanation_en"))]
            q.update({k: e[k] for k in ("question_en", "options_en", "explanation_en") if k in e})
        d["page_en"], d["title_en"] = en_page(d["page"]), en_title(d["page"])
        files.append((f, d))
    if errs:
        print("REJECTED — nothing written:")
        for e in errs:
            print("  -", e)
        sys.exit(1)
    for f, d in files:
        dump(d, f)
    print(f"OK {len(en)} questions translated across {len(files)} articles")


def cmd_status():
    m = load(MANIFEST, {"pages": {}})
    print(f"{len(m['pages'])} articles, {sum(len(p['q']) for p in m['pages'].values())} questions; "
          f"{len(all_pages())} articles exist")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("todo").add_argument("--n", type=int, default=15)
    sub.add_parser("build"); sub.add_parser("check"); sub.add_parser("status"); sub.add_parser("backfill-en")
    a = ap.parse_args()
    {"todo": lambda: cmd_todo(a.n), "build": cmd_build, "check": cmd_check, "status": cmd_status, "backfill-en": cmd_backfill_en}[a.cmd]()
