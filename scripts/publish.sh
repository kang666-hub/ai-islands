#!/bin/bash
# 康總的Ai群島：匯出真資料 → 有變動才 commit + push。由 launchd 每小時 :07 執行。
#
# 規則：
# - 比對時排除 updatedAt（它每次都會變）；數字沒變 → 還原檔案、不 commit。
# - 新 JSON 的 null 格數比 HEAD 多 → 不 commit、記 WARN、exit 1（防止權限／來源問題把公開數字洗成「—」）。
# - 任何一步失敗 → 還原 data/islands.json、exit 1。
# - push 失敗時保留那個完整的 commit，下一小時開頭會先補推（不算半成品）。
# - 連續失敗 ≥ 6 次，log 標 WARN。
# - log：logs/publish-YYYY-MM-DD.log（按日期分檔，不自動刪，可手動清）。

export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
PY=/opt/homebrew/bin/python3
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DATA="data/islands.json"
LOGDIR="$REPO/logs"
FAILFILE="$LOGDIR/.fail_count"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/publish-$(date +%F).log"

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

fail() {
  git checkout -- "$DATA" 2>>"$LOG"
  local n
  n=$(( $(cat "$FAILFILE" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$FAILFILE"
  if [ "$n" -ge 6 ]; then log "WARN 連續失敗 $n 次：$*"; else log "FAIL（連續第 $n 次）：$*"; fi
  exit 1
}

ok() {
  echo 0 > "$FAILFILE"
  log "OK $*"
  exit 0
}

cd "$REPO" || { log "FAIL 找不到 repo"; exit 1; }
log "---- 開始"

# 0. 上次 push 失敗留下的 commit 先補推
ahead=$(git rev-list --count '@{u}..HEAD' 2>>"$LOG" || echo 0)
if [ "$ahead" -gt 0 ]; then
  log "有 $ahead 個未推送的 commit，先補推"
  git push -q origin main >>"$LOG" 2>&1 || fail "補推失敗（網路？下一小時重試）"
fi

# 1. 匯出（stderr 進 log）
"$PY" scripts/export_islands.py 2>>"$LOG" || fail "export_islands.py 結束碼非 0"

# 2. 比對（排除 updatedAt）＋ null 格數檢查
cmp=$(git show "HEAD:$DATA" 2>/dev/null | "$PY" -c '
import json, sys
old = json.load(sys.stdin)
new = json.load(open(sys.argv[1], encoding="utf-8"))
def nulls(d):
    return sum(1 for i in d["islands"] for s in i.get("stats", []) if s.get("value") is None) + \
           sum(1 for i in d["islands"] for v in i.get("visual", {}).values() if v is None)
o, n = nulls(old), nulls(new)
old.pop("updatedAt", None); new.pop("updatedAt", None)
if n > o:
    print(f"MORE_NULLS {o} {n}")
elif old == new:
    print("SAME")
else:
    print("CHANGED")
' "$DATA" 2>>"$LOG")

case "$cmp" in
  SAME)
    git checkout -- "$DATA" 2>>"$LOG"
    ok "數字沒有變動，不 commit"
    ;;
  CHANGED) ;;
  MORE_NULLS*)
    fail "WARN null 格數增加（${cmp#MORE_NULLS }），可能是來源讀不到或權限問題，不 commit"
    ;;
  *)
    fail "比對失敗（輸出：$cmp）"
    ;;
esac

# 3. commit + push
stamp=$(TZ=Asia/Taipei date '+%F %H:%M')
git add "$DATA" 2>>"$LOG" || fail "git add 失敗"
git commit -q -m "data: $stamp" >>"$LOG" 2>&1 || { git reset -q -- "$DATA" 2>>"$LOG"; fail "git commit 失敗"; }
if ! git push -q origin main >>"$LOG" 2>&1; then
  n=$(( $(cat "$FAILFILE" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FAILFILE"
  if [ "$n" -ge 6 ]; then lvl=WARN; else lvl=FAIL; fi
  log "$lvl（連續第 $n 次）：push 失敗，commit「data: $stamp」保留，下一小時補推"
  exit 1
fi
ok "已 commit 並 push：data: $stamp"
