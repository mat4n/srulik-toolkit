# Self-learning loop inside T3 Code: the review starts a T3 thread on a signals
# snapshot. Reuses the learn_* helpers from 21_learn.py.
with tempfile.TemporaryDirectory() as temporary:
    base = pathlib.Path(temporary)
    home = base / "home"
    repo = learn_repo(base)
    bin_dir = base / "bin"
    bin_dir.mkdir()
    for name in ["t3", "t3.cmd", "t3.exe"]:
        (bin_dir / name).write_text("", encoding="utf-8")
    learn_run(home, ["capture", "claude"], {"cwd": str(repo), "prompt": "no, wrong file"})
    learn_run(home, ["start", "claude"], {"cwd": str(repo)}, T3CODE_THREAD_ID="thread-1", PATH=str(bin_dir) + os.pathsep + os.environ.get("PATH", ""))
    launch = json.loads((learn_project(home) / "state.json").read_text(encoding="utf-8"))["last_launch"]
    if launch["route"] != "t3" or launch["argv"][:3] != ["t3", "thread", "start"] or launch["argv"][-2:] != ["--worktree", "HEAD"]:
        raise SystemExit(f"inside T3 Code the review must start a T3 thread in a worktree: {launch}")
    snapshot = learn_project(home) / "signals.review.jsonl"
    learn_run(home, ["capture", "claude"], {"cwd": str(repo), "prompt": "no, later signal"})
    offset = json.loads((learn_project(home) / "state.json").read_text(encoding="utf-8")).get("review_offset")
    if not snapshot.is_file() or "later signal" in snapshot.read_text(encoding="utf-8") or offset != snapshot.stat().st_size:
        raise SystemExit("the T3 review must read a snapshot taken at launch")
print("Self-learning loop passed")
