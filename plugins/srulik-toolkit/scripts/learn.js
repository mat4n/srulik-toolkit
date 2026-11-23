// Self-learning loop. Hooks log corrections and failed checks without a model
// call; the next session start injects active lessons and, at most once a day per
// project, launches a background review whose deltas are merged here.
// Usage: learn.js capture|start <harness> (hook JSON on stdin)
//        learn.js merge <project-key> <deltas-file> [worktree] | stats [project-key]
const cp = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DAY = 86_400_000;
const MARKER = "srulik-learn-review";
const CAP = 10;
const ACTIVE_AT = 2;
const PRUNE_DAYS = 60;
const LOCK_STALE = 2 * 3_600_000;
const root = () => process.env.SRULIK_TOOLKIT_LEARN_HOME || path.join(os.homedir(), ".srulik-toolkit", "learn");
const off = () => process.env.SRULIK_TOOLKIT_LEARN === "0";
const now = () => Number(process.env.SRULIK_TOOLKIT_LEARN_NOW) || Date.now();
const iso = (ms) => new Date(ms).toISOString();

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function git(cwd, args) {
  try { return cp.execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}
function project(cwd) {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  const dir = path.resolve(top || cwd);
  const key = crypto.createHash("sha1").update(dir).digest("hex").slice(0, 12);
  return { top: top ? dir : null, key, dir: path.join(root(), "projects", key) };
}
const stores = (projectDir) => ({
  user: path.join(root(), "user", "lessons.json"),
  override: path.join(root(), "user", "overrides.json"),
  project: path.join(projectDir, "lessons.json"),
});

function redact(text) {
  return String(text)
    .replace(/\b(?:sk-|ghp_|gho_|ghs_|github_pat_|xox[abpr]-|AKIA|glpat-)[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(password|passwd|token|secret|api[_-]?key)(\s*[=:]\s*)\S+/gi, "$1$2[redacted]")
    .slice(0, 500);
}

const correction = /^(?:no\b[,.!:\s]|nope\b|don['’]?t\b|do not\b|stop\b|actually\b|wrong\b|that['’]?s (?:wrong|not)\b|not like that\b|why did you\b|i said\b|instead\b)/i;
const remember = /^remember\s*:/i;
const checkCommand = /(?:^|[\s/;&|(])(?:test|tests|lint|eslint|tsc|typecheck|build|validate(?:\.sh)?|pytest|jest|vitest|cargo\s+(?:test|build|check|clippy)|go\s+(?:test|vet|build))\b/;

function failed(event) {
  if (/failure/i.test(String(event.hook_event_name || ""))) return true;
  const response = event.tool_response;
  for (const value of [event.exit_code, response?.exit_code, response?.exitCode, response?.metadata?.exit_code]) {
    if (typeof value === "number") return value !== 0;
  }
  const text = typeof response === "string" ? response : JSON.stringify(response ?? "");
  return /exit code:?\s*[1-9]\d*/i.test(text) || /"exit_?code"\s*:\s*[1-9]/i.test(text);
}

function classify(event) {
  const prompt = event.prompt ?? event.user_prompt;
  if (typeof prompt === "string") {
    if (prompt.includes(MARKER)) return null;
    const text = prompt.trim();
    if (remember.test(text)) return { kind: "remember", text };
    if (correction.test(text)) return { kind: "correction", text };
    return null;
  }
  const command = event.tool_input?.command ?? event.tool_input?.cmd;
  if (typeof command === "string" && checkCommand.test(command) && failed(event)) {
    const detail = event.error ?? event.error_message ?? "";
    return { kind: "failed_check", text: detail ? `${command}\n${detail}` : command };
  }
  return null;
}

const cwdOf = (event) => event.cwd || event.workspace_roots?.[0] || process.cwd();

function capture(harness, event) {
  if (off()) return "";
  const signal = classify(event);
  if (!signal) return "";
  const { dir } = project(cwdOf(event));
  fs.mkdirSync(dir, { recursive: true });
  const line = { ts: iso(now()), harness, session: String(event.session_id || event.conversation_id || ""), kind: signal.kind, text: redact(signal.text) };
  fs.appendFileSync(path.join(dir, "signals.jsonl"), `${JSON.stringify(line)}\n`);
  return "";
}

function active(projectDir) {
  const entries = [];
  for (const [scope, file] of Object.entries(stores(projectDir))) {
    for (const entry of Object.values(readJson(file, { entries: {} }).entries || {})) {
      if (entry.seen >= ACTIVE_AT && !entry.archived) entries.push({ ...entry, scope });
    }
  }
  return entries.sort((a, b) => b.seen - a.seen || String(b.last_seen).localeCompare(String(a.last_seen))).slice(0, CAP);
}

function lock(dir) {
  const file = path.join(dir, "review.lock");
  try {
    fs.mkdirSync(file);
    return true;
  } catch {
    try {
      if (now() - fs.statSync(file).mtimeMs < LOCK_STALE) return false;
      fs.rmSync(file, { recursive: true, force: true });
      fs.mkdirSync(file);
      return true;
    } catch { return false; }
  }
}

function onPath(name) {
  const extensions = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD").split(";") : [""];
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    for (const extension of extensions) {
      if (directory && fs.existsSync(path.join(directory, name + extension))) return true;
    }
  }
  return false;
}

const AUTOMATIC = path.join(__dirname, "..", "skills", "retro", "references", "automatic.md");
// `files` names the instructions, the signals file, the three entry stores and the deltas output.
function reviewPrompt(key, files, mergeHint) {
  return [
    MARKER,
    `Run the \`retro\` skill in automatic mode: read ${files.instructions} and follow it exactly.`,
    `Signals file: ${files.signals}`,
    `Current entries: ${files.user}, ${files.project}, ${files.override}`,
    `Write the deltas JSON to ${files.deltas}`,
    ...(mergeHint ? [`Then run: node "${__filename}" merge ${key} "${files.deltas}" "<the absolute path of your working directory>"`] : []),
  ].join("\n");
}

const INBOX = ".srulik-learn";
// The CLI review runs sandboxed to its worktree, so its inputs are copied in.
function stageInputs(dir, target) {
  const inbox = path.join(target, INBOX);
  fs.mkdirSync(inbox, { recursive: true });
  const files = { deltas: path.join(inbox, "deltas.json"), instructions: path.join(inbox, "automatic.md") };
  fs.copyFileSync(AUTOMATIC, files.instructions);
  const sources = { signals: path.join(dir, "signals.jsonl"), ...stores(dir) };
  for (const [name, source] of Object.entries(sources)) {
    files[name] = path.join(inbox, path.basename(source) === "lessons.json" ? `${name}-lessons.json` : path.basename(source));
    try { fs.copyFileSync(source, files[name]); } catch { fs.writeFileSync(files[name], name === "signals" ? "" : '{"entries":{}}\n'); }
  }
  return files;
}

const cli = {
  claude: (prompt) => ["claude", ["-p", prompt, "--permission-mode", "acceptEdits"]],
  cursor: (prompt) => ["cursor-agent", ["-p", prompt, "--output-format", "text"]],
  codex: (prompt) => ["codex", ["exec", "--sandbox", "workspace-write", prompt]],
};

function launch(harness, info, state) {
  const prompt = reviewPrompt(info.key, { instructions: AUTOMATIC, signals: path.join(info.dir, "signals.jsonl"), ...stores(info.dir), deltas: path.join(info.dir, "deltas.json") }, true);
  const t3 = Boolean(process.env.T3CODE_THREAD_ID) && onPath("t3") && info.top;
  const route = t3
    ? { name: "t3", command: "t3", args: ["thread", "start", info.top, "-", "--title", "Srulik learn review", "--worktree", "HEAD"], stdin: prompt }
    : { name: "cli", command: process.execPath, args: [__filename, "review", harness, info.key, info.top || ""] };
  state.last_launch = { at: iso(now()), route: route.name, harness, argv: [route.command, ...route.args] };
  if (process.env.SRULIK_TOOLKIT_LEARN_DRY === "1") return;
  const child = cp.spawn(route.command, route.args, {
    cwd: info.top || info.dir,
    detached: true,
    stdio: [route.stdin ? "pipe" : "ignore", "ignore", "ignore"],
    env: { ...process.env, SRULIK_TOOLKIT_LEARN: "0" },
    windowsHide: true,
  });
  child.on("error", () => {});
  if (route.stdin) child.stdin.end(route.stdin);
  child.unref();
}

function start(harness, event) {
  if (off()) return "";
  const info = project(cwdOf(event));
  const statePath = path.join(info.dir, "state.json");
  const state = readJson(statePath, {});
  const out = [];
  const entries = active(info.dir);
  if (entries.length) {
    out.push("Srulik Toolkit learned lessons (apply when relevant):");
    for (const e of entries) out.push(e.scope === "override" ? `- When using \`${e.skill}\`: ${e.text}` : `- ${e.text}`);
  }
  const branches = (state.branches || []).filter((b) => info.top && git(info.top, ["rev-parse", "--verify", "--quiet", `refs/heads/${b.branch}`]));
  if (branches.length) {
    out.push("Srulik Toolkit proposed project fixes on local branches (tell the user, do not merge them):");
    for (const b of branches) out.push(`- ${b.branch}: ${b.summary}${b.pr ? ` (${b.pr})` : ""}`);
  }
  let size = 0;
  try { size = fs.statSync(path.join(info.dir, "signals.jsonl")).size; } catch {}
  const due = !state.last_review_at || now() - Date.parse(state.last_review_at) >= DAY;
  if (size > 0 && due && lock(info.dir)) {
    state.last_review_at = iso(now());
    state.review_offset = size;
    try { launch(harness, info, state); } catch {
      fs.rmSync(path.join(info.dir, "review.lock"), { recursive: true, force: true });
    }
    writeJson(statePath, state);
  }
  return out.join("\n");
}

const ops = new Set(["add", "seen", "edit", "archive", "project_fix"]);
const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
function invalid(delta, fixes) {
  if (!delta || typeof delta !== "object" || !ops.has(delta.op)) return "unknown op";
  if (delta.op === "project_fix") {
    if (!/^[a-z0-9][a-z0-9-]{0,49}$/.test(delta.slug || "")) return "bad slug";
    if (typeof delta.summary !== "string" || !delta.summary || delta.summary.length > 200) return "bad summary";
    return fixes > 0 ? "only one project_fix per review" : null;
  }
  if (!["user", "project", "override"].includes(delta.scope)) return "bad scope";
  if (!idPattern.test(delta.id || "")) return "bad id";
  if (delta.scope === "override" && delta.op === "add" && !/^[a-z0-9-]{1,64}$/.test(delta.skill || "")) return "override needs a skill";
  if (["add", "edit"].includes(delta.op) && (typeof delta.text !== "string" || !delta.text.trim() || delta.text.length > 200)) return "text must be 1 to 200 characters";
  return null;
}

function commitFix(worktree, delta, info, state) {
  if (!worktree || !git(worktree, ["rev-parse", "--show-toplevel"])) return "no worktree";
  if (!git(worktree, ["status", "--porcelain"])) return "no changes";
  const branch = `srulik-learn/${delta.slug}`;
  if (git(worktree, ["checkout", "-b", branch]) === null) return "branch exists";
  git(worktree, ["add", "-A"]);
  if (git(worktree, ["commit", "-m", `chore(learn): ${delta.summary}`]) === null) return "commit failed";
  const record = { branch, summary: delta.summary, at: iso(now()) };
  if (process.env.SRULIK_TOOLKIT_LEARN_PRS === "1" && info.top && git(info.top, ["remote"])) {
    const steps = [["git", ["-C", worktree, "push", "-u", "origin", branch]], ["gh", ["pr", "create", "--draft", "--head", branch, "--title", `Learned: ${delta.summary}`, "--body", "Proposed by the Srulik Toolkit self-learning review from repeated session signals."]]];
    if (process.env.SRULIK_TOOLKIT_LEARN_DRY === "1") record.pr_dry = steps.map(([c, a]) => [c, ...a].join(" "));
    else {
      try {
        cp.execFileSync("gh", ["auth", "status"], { stdio: "ignore", timeout: 10000 });
        for (const [c, a] of steps) record.pr = cp.execFileSync(c, a, { cwd: worktree, encoding: "utf8", timeout: 60000 }).trim();
      } catch { delete record.pr; }
    }
  }
  state.branches = [...(state.branches || []).filter((b) => b.branch !== branch), record];
  return null;
}

function merge(key, deltasFile, worktree) {
  if (!/^[0-9a-f]{12}$/.test(key || "")) throw new Error("bad project key");
  const dir = path.join(root(), "projects", key);
  const info = { key, dir, top: worktree ? path.resolve(git(worktree, ["rev-parse", "--path-format=absolute", "--git-common-dir"]) || worktree, "..") : null };
  const statePath = path.join(dir, "state.json");
  const state = readJson(statePath, {});
  const files = stores(dir);
  const data = Object.fromEntries(Object.entries(files).map(([scope, file]) => [scope, readJson(file, { entries: {} })]));
  const input = readJson(deltasFile, null);
  if (worktree) fs.rmSync(path.join(worktree, INBOX), { recursive: true, force: true });
  const applied = [];
  const rejected = [];
  const at = iso(now());
  let fixes = 0;
  for (const delta of Array.isArray(input?.deltas) ? input.deltas : [{ op: "invalid file" }]) {
    const reason = invalid(delta, fixes);
    if (reason) { rejected.push({ delta, reason }); continue; }
    if (delta.op === "project_fix") {
      fixes++;
      const why = commitFix(worktree, delta, info, state);
      (why ? rejected : applied).push(why ? { delta, reason: why } : delta);
      continue;
    }
    const entries = (data[delta.scope].entries ||= {});
    const entry = entries[delta.id];
    if (!entry && delta.op !== "add") { rejected.push({ delta, reason: "unknown id" }); continue; }
    if (!entry) {
      entries[delta.id] = { id: delta.id, text: delta.text.trim(), ...(delta.skill ? { skill: delta.skill } : {}), seen: 1, first_seen: at, last_seen: at, applied_at: null, recurred_after_apply: 0, archived: false };
    } else if (delta.op === "edit") {
      entry.text = delta.text.trim();
    } else if (delta.op === "archive") {
      entry.archived = true;
    } else {
      if (entry.applied_at) entry.recurred_after_apply++;
      entry.seen++;
      entry.last_seen = at;
      entry.archived = false;
    }
    const current = entries[delta.id];
    if (current.seen >= ACTIVE_AT && !current.applied_at) current.applied_at = at;
    applied.push(delta);
  }
  for (const store of Object.values(data)) {
    for (const entry of Object.values(store.entries || {})) {
      if (!entry.archived && now() - Date.parse(entry.last_seen) > PRUNE_DAYS * DAY) entry.archived = true;
    }
  }
  for (const [scope, file] of Object.entries(files)) writeJson(file, data[scope]);
  const signals = path.join(dir, "signals.jsonl");
  try {
    const rest = fs.readFileSync(signals).subarray(state.review_offset || 0);
    fs.writeFileSync(signals, rest);
  } catch {}
  delete state.review_offset;
  state.last_merge_at = at;
  state.rejected = [...(state.rejected || []), ...rejected.map((r) => ({ at, ...r }))].slice(-20);
  writeJson(statePath, state);
  fs.rmSync(path.join(dir, "review.lock"), { recursive: true, force: true });
  return { applied: applied.length, rejected: rejected.map((r) => r.reason) };
}

function review(harness, key, top) {
  const dir = path.join(root(), "projects", key);
  let worktree = null;
  try {
    if (top) {
      worktree = fs.mkdtempSync(path.join(os.tmpdir(), "srulik-learn-"));
      if (git(top, ["worktree", "add", "--detach", worktree, "HEAD"]) === null) worktree = null;
    }
    const statePath = path.join(dir, "state.json");
    const state = readJson(statePath, {});
    try { state.review_offset = fs.statSync(path.join(dir, "signals.jsonl")).size; } catch { state.review_offset = 0; }
    writeJson(statePath, state);
    const files = stageInputs(dir, worktree || dir);
    const [command, args] = cli[harness](reviewPrompt(key, files, false));
    // shortcut: no shell, so Windows .cmd shims are not found, use a native binary there.
    const run = cp.spawnSync(command, args, { cwd: worktree || dir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 20 * 60_000, env: { ...process.env, SRULIK_TOOLKIT_LEARN: "0" }, windowsHide: true });
    fs.writeFileSync(path.join(dir, "review.log"), `${iso(now())} ${command} exit ${run.status ?? run.error?.code}\n${String(run.stdout || "").slice(-20000)}\n${String(run.stderr || "").slice(-20000)}`);
    // A run that wrote no deltas keeps its signals for the next review.
    if (fs.existsSync(files.deltas)) merge(key, files.deltas, worktree);
  } finally {
    fs.rmSync(path.join(dir, "review.lock"), { recursive: true, force: true });
    if (worktree) git(top, ["worktree", "remove", "--force", worktree]);
  }
}

function stats(key) {
  const dirs = key ? [key] : (() => { try { return fs.readdirSync(path.join(root(), "projects")); } catch { return []; } })();
  const rows = [];
  const seen = new Set();
  for (const k of dirs.length ? dirs : [""]) {
    for (const [scope, file] of Object.entries(stores(path.join(root(), "projects", k)))) {
      if (seen.has(file)) continue;
      seen.add(file);
      for (const e of Object.values(readJson(file, { entries: {} }).entries || {})) rows.push({ scope, ...e });
    }
  }
  const appliedRows = rows.filter((r) => r.applied_at);
  return [
    `lessons: ${rows.length}, applied: ${appliedRows.length}, applied with zero recurrences: ${appliedRows.filter((r) => !r.recurred_after_apply).length}`,
    ...rows.map((r) => `${r.scope}/${r.id}: seen ${r.seen}, applied ${r.applied_at ? "yes" : "no"}, recurred_after_apply ${r.recurred_after_apply}${r.archived ? ", archived" : ""}`),
  ].join("\n");
}

function hook(mode, harness) {
  let raw = "";
  try { raw = fs.readFileSync(0, "utf8"); } catch {}
  let event = {};
  try { event = JSON.parse(raw || "{}"); } catch {}
  let text = "";
  try { text = (mode === "start" ? start : capture)(harness, event); } catch {}
  if (harness === "cursor" && mode === "start") process.stdout.write(JSON.stringify({ additional_context: text }));
  else if (harness === "cursor" && event.hook_event_name === "beforeSubmitPrompt") process.stdout.write(JSON.stringify({ continue: true }));
  else if (text) process.stdout.write(`${text}\n`);
}

const args = process.argv.slice(require.main === module ? 2 : 1);
const [mode, ...rest] = args;
if (mode === "capture" || mode === "start") hook(mode, cli[rest[0]] ? rest[0] : "claude");
else if (mode === "merge") console.log(JSON.stringify(merge(rest[0], rest[1], rest[2])));
else if (mode === "review" && cli[rest[0]]) review(rest[0], rest[1], rest[2]);
else if (mode === "stats") console.log(stats(rest[0]));
else if (require.main === module) { console.error("usage: learn.js capture|start <claude|cursor|codex> | merge <key> <deltas> [worktree] | stats [key]"); process.exitCode = 2; }
