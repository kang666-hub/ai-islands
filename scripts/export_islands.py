#!/usr/bin/env python3
"""康總的Ai群島：把 Mac 本機的真數字匯出成 site/data/islands.json。

只用標準庫。只輸出數字、布林、null 與 ISO 時間戳；所有文字都來自
scripts/islands.template.json（固定值），不經匯出。

用法：
    python3 scripts/export_islands.py                     # 正式匯出
    python3 scripts/export_islands.py --out /tmp/x.json   # 改輸出位置
    python3 scripts/export_islands.py --source lib=/不存在  # 覆寫某個來源（測試用）
    python3 scripts/export_islands.py --now 2026-10-20T12:00:00+08:00   # 假設「現在」（測試用）
    python3 scripts/export_islands.py --inject-test-string # 自檢測試：故意塞字串，應中止不寫檔

結束碼：0 正常（部分欄位為 null 也算正常）；2 自檢失敗未寫檔；3 模板／輸出寫入錯誤。
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import statistics
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

TPE = ZoneInfo("Asia/Taipei")
HOME = Path.home()
SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parent

# 來源白名單（規格第 2 節），不得新增；--source 只能覆寫既有名稱
SOURCES = {
    "state": HOME / ".claude-dash/state",
    "agy_out": HOME / "ai-work/agy-out",
    "codex_out": HOME / "ai-work/codex-out",
    "claude_out": HOME / "ai-work/claude-out",
    "inbox_done": HOME / ".claude-dash/inbox-queue/done",
    "inbox_failed": HOME / ".claude-dash/inbox-queue/failed",
    "lib": HOME / "Documents/KangBot_Notes/AI資產庫",
    "box": HOME / "Documents/claude工作區/BOXING拳擊專案/Recordings",
    "fpv_output": HOME / "fpv_output",
    "fpv_trainer": HOME / "Documents/claude工作區/FPV/花飛訓練平台/fpv-trainer",
    "bridge": HOME / "bridge-3d-inspection",
    "works": HOME / "Documents/claude工作區/KANG個人品牌/03_website/kangup-site/data/works.json",
    "manual": SCRIPTS / "manual.json",
}
TEMPLATE = SCRIPTS / "islands.template.json"
# repo 版網站就在根目錄；05_ai-islands 原始版在 site/ 底下
SITE = ROOT / "site" if (ROOT / "site" / "index.html").is_file() else ROOT
DEFAULT_OUT = SITE / "data/islands.json"

BOX_WINDOW = timedelta(days=30)   # 康總 2026-10-25 決定：拳擊改 30 天
INBOX_WINDOW = timedelta(hours=24)

# 自檢：這些子樹底下的字串整棵放行（都來自模板）
FREE_TEXT_KEYS = {"name", "summary", "label"}
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$")


def log(msg: str) -> None:
    print(f"[export_islands] {msg}", file=sys.stderr)


def parse_time(s: str) -> datetime:
    t = datetime.fromisoformat(s)
    return t if t.tzinfo else t.replace(tzinfo=TPE)  # 沒帶時區一律當台北時間


def is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


# ---------- 各來源 ----------

def ai_sessions(src):
    files = sorted(src["state"].glob("*.json"))
    if not src["state"].is_dir():
        raise FileNotFoundError("state 目錄不存在")
    running = 0
    for f in files:
        try:
            if json.loads(f.read_text("utf-8")).get("state") == "running":  # 只讀 state 欄
                running += 1
        except (OSError, ValueError, AttributeError) as e:
            log(f"state 檔讀不到，略過一筆：{type(e).__name__}")
    return {"running_sessions": running, "sessions_total": len(files)}


def ai_jobs(src):
    total = 0
    for name in ("agy_out", "codex_out", "claude_out"):
        d = src[name]
        if not d.is_dir():
            raise FileNotFoundError(f"{name} 目錄不存在")
        total += sum(1 for p in d.iterdir() if p.is_dir())  # 只數子資料夾，不開內容
    return total


def port_new_inbox(src, now):
    d = src["inbox_done"]
    if not d.is_dir():
        raise FileNotFoundError("inbox done 目錄不存在")
    n = 0
    for f in d.glob("*.json"):
        try:
            t = parse_time(json.loads(f.read_text("utf-8"))["received_at"])  # 只讀 received_at
        except (OSError, ValueError, KeyError, TypeError) as e:
            log(f"inbox 檔讀不到，略過一筆：{type(e).__name__}")
            continue
        if now - INBOX_WINDOW <= t <= now:
            n += 1
    return n


def port_failed(src):
    d = src["inbox_failed"]
    if not d.is_dir():
        raise FileNotFoundError("inbox failed 目錄不存在")
    return sum(1 for p in d.iterdir() if p.is_file() and not p.name.startswith("."))


def lib_counts(src):
    root = src["lib"]
    if not root.is_dir():
        raise FileNotFoundError("AI資產庫不存在")

    def count(p: Path):
        if not p.is_dir():
            raise FileNotFoundError(f"{p.name} 目錄不存在")
        return sum(1 for _ in p.rglob("*.md"))

    return root, count


def box_sessions(src):
    """回傳去重後的分析資料夾清單：同一影片有 _2、_3 版本時只取尾碼最大的。"""
    rec = src["box"]
    if not rec.is_dir():
        raise FileNotFoundError("Recordings 目錄不存在")
    dirs = {p.name[len("_分析_"):]: p for p in rec.glob("_分析_*") if p.is_dir()}
    best: dict[str, tuple[int, Path]] = {}
    for name, p in dirs.items():
        m = re.match(r"^(.*)_(\d+)$", name)
        if m and m.group(1) in dirs:          # 只有「去掉尾碼後的原名也存在」才算版本
            base, ver = m.group(1), int(m.group(2))
        else:
            base, ver = name, 1
        if base not in best or ver > best[base][0]:
            best[base] = (ver, p)
    return [p for _, p in best.values()]


def box_stats(src, now):
    folders = box_sessions(src)
    recent = []
    for p in folders:
        try:
            d = json.loads((p / "summary.json").read_text("utf-8"))
            t = parse_time(d["video_time"])
            s = d["summary"]
        except (OSError, ValueError, KeyError, TypeError) as e:
            log(f"拳擊 summary 讀不到，略過一筆：{type(e).__name__}")
            continue
        if now - BOX_WINDOW <= t <= now:
            recent.append(s)
    out = {"sessions_total": len(folders)}
    if not recent:
        out.update(punches_30d=0, speed_p50=None, ppm=None)
        return out
    out["punches_30d"] = sum(int(s["punch_n"]) for s in recent)
    out["speed_p50"] = round(statistics.median(float(s["speed_p50"]) for s in recent), 1)
    out["ppm"] = round(statistics.median(float(s["ppm"]) for s in recent), 1)
    return out


def fpv_highlights(src):
    d = src["fpv_output"]
    if not d.is_dir():
        raise FileNotFoundError("fpv_output 不存在")
    return sum(1 for p in d.glob("*.mp4") if p.is_file())


def git_count(path: Path):
    r = subprocess.run(["git", "-C", str(path), "rev-list", "--count", "HEAD"],
                       capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        raise RuntimeError(f"git rev-list 失敗（{r.returncode}）")
    return int(r.stdout.strip())


def works_count(src):
    data = json.loads(src["works"].read_text("utf-8"))
    if not isinstance(data, list):
        raise ValueError("works.json 不是陣列")
    return len(data)


def manual_value(src, key):
    v = json.loads(src["manual"].read_text("utf-8"))[key]
    if not is_number(v):
        raise ValueError(f"manual.json 的 {key} 不是數字")
    return v


# ---------- 組裝 ----------

def collect(src, now):
    """回傳 {(島, 欄位): 值}；任何來源失敗 → 該欄 None，其他照常。"""
    vals: dict[tuple[str, str], object] = {}

    def attempt(label, fn, keys):
        try:
            res = fn()
        except Exception as e:  # 單一來源失敗不得中止整支
            log(f"{label} 失敗 → null：{type(e).__name__}: {e}")
            res = None
        for k in keys:
            if res is None:
                vals[k] = None
            elif isinstance(res, dict):
                vals[k] = res.get(k[1])
            else:
                vals[k] = res

    attempt("ai/sessions", lambda: ai_sessions(src), [("ai", "running_sessions"), ("ai", "sessions_total")])
    attempt("ai/jobs", lambda: ai_jobs(src), [("ai", "jobs_total")])
    attempt("port/new_inbox", lambda: port_new_inbox(src, now), [("port", "new_inbox")])
    attempt("port/failed", lambda: port_failed(src), [("port", "inbox_failed")])

    # 三個數字分開容錯：wiki/ 不見不該連帶讓 notes 變 null
    for key, sub in (("notes", None), ("wiki", "wiki"), ("raw", "raw")):
        def one(sub=sub):
            root, count = lib_counts(src)
            return count(root / sub) if sub else count(root)
        attempt(f"lib/{key}", one, [("lib", key)])

    attempt("box", lambda: box_stats(src, now),
            [("box", "punches_30d"), ("box", "speed_p50"), ("box", "ppm"), ("box", "sessions_total")])
    attempt("fpv/highlights", lambda: fpv_highlights(src), [("fpv", "highlights")])
    attempt("fpv/trainer_commits", lambda: git_count(src["fpv_trainer"]), [("fpv", "trainer_commits")])
    attempt("bridge/commits", lambda: git_count(src["bridge"]), [("bridge", "commits")])
    attempt("bridge/progress", lambda: manual_value(src, "bridge_progress"), [("bridge", "progress")])
    attempt("brand/works", lambda: works_count(src), [("brand", "works")])
    attempt("brand/ig_views_30d", lambda: manual_value(src, "ig_views_30d"), [("brand", "ig_views_30d")])
    return vals


def build(template, vals, now):
    out = copy.deepcopy(template)
    out["updatedAt"] = now.isoformat(timespec="seconds")
    for isl in out["islands"]:
        iid = isl["id"]
        for s in isl.get("stats", []):
            if s.get("fixed"):
                continue  # 模板固定值，不是匯出資料
            s["value"] = vals.get((iid, s["key"]))
        for k in list(isl.get("visual", {})):
            isl["visual"][k] = vals.get((iid, k))
    return out


# ---------- 自檢 ----------

class SelfCheckError(Exception):
    pass


def self_check(out, template):
    """輸出裡的字串只准：updatedAt（ISO）、name/summary/label 子樹、或與模板同位置完全相同的固定值。"""
    data = json.loads(json.dumps(out, ensure_ascii=False))  # 用 json.dumps 掃一次實際輸出內容

    def walk(node, tmpl, path, free):
        if isinstance(node, str):
            if path == "updatedAt":
                if not ISO_RE.match(node):
                    raise SelfCheckError("updatedAt 格式不對")
                return
            if free:
                return
            if node != tmpl:
                raise SelfCheckError(f"{path} 出現模板以外的字串")
        elif isinstance(node, dict):
            for k, v in node.items():
                t = tmpl.get(k) if isinstance(tmpl, dict) else None
                walk(v, t, f"{path}.{k}" if path else k, free or k in FREE_TEXT_KEYS)
        elif isinstance(node, list):
            for i, v in enumerate(node):
                t = tmpl[i] if isinstance(tmpl, list) and i < len(tmpl) else None
                walk(v, t, f"{path}[{i}]", free)
        elif node is None or isinstance(node, bool) or is_number(node):
            return
        else:
            raise SelfCheckError(f"{path} 型別不允許")

    walk(data, template, "", False)


def atomic_write(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".islands-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)  # 只清掉自己剛建的暫存檔
        raise


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--template", type=Path, default=TEMPLATE)
    ap.add_argument("--source", action="append", default=[], metavar="名稱=路徑",
                    help="覆寫來源路徑（只能用既有名稱：" + "、".join(SOURCES) + "）")
    ap.add_argument("--now", help="假設的現在時間（ISO，測試用）")
    ap.add_argument("--inject-test-string", action="store_true", help="自檢測試：塞一個字串欄位，應中止不寫檔")
    args = ap.parse_args(argv)

    src = dict(SOURCES)
    for item in args.source:
        name, _, p = item.partition("=")
        if name not in SOURCES or not p:
            ap.error(f"--source 名稱不在白名單：{name}")
        src[name] = Path(p).expanduser()

    now = parse_time(args.now).astimezone(TPE) if args.now else datetime.now(TPE)
    now = now.replace(microsecond=0)

    try:
        template = json.loads(args.template.read_text("utf-8"))
    except (OSError, ValueError) as e:
        log(f"模板讀不到：{e}")
        return 3

    out = build(template, collect(src, now), now)
    if args.inject_test_string:
        out["islands"][0]["stats"][0]["value"] = "/Users/test/should-not-leak"

    try:
        self_check(out, template)
    except SelfCheckError as e:
        log(f"自檢失敗，中止且不寫檔：{e}")
        return 2

    text = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
    try:
        atomic_write(args.out, text)
    except OSError as e:
        log(f"寫檔失敗：{e}")
        return 3
    nulls = sum(1 for isl in out["islands"] for s in isl["stats"] if s["value"] is None)
    log(f"完成：{args.out.name}，updatedAt={out['updatedAt']}，null 格數={nulls}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
