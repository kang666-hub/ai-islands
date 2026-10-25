# 康總的Ai群島（ai-islands）

純靜態網站：`index.html` + ES module + `data/islands.json`，不需要 build，GitHub Pages 從 `main` / root 直接服務。
`data/islands.json` 由 Mac 每小時跑 `scripts/export_islands.py` 產生（真資料）。

原始開發資料夾：`~/Documents/claude工作區/KANG個人品牌/05_ai-islands/`（第一階段成果與報告 `cc_report.md`）。

## 結構
```
index.html           入口（importmap 指向 vendor/）
style.css            版面與色票（CSS 變數）
js/main.js           場景、鏡頭、燈光、主迴圈
js/world.js          島、棧橋、海面（依 JSON axial 座標程式產生）
js/decor.js          各島裝飾（8-2）
js/people.js         小人：Q 版公仔、InstancedMesh 部件池、導航圖（8-3）
js/ui.js             島名標籤、資訊卡、全景鈕、首次提示、點擊聚焦、流動線（8-4）
js/data.js           讀 JSON、驗證
js/palette.js        JS 色票（與 style.css 同一組）
data/islands.json    唯一的資料來源（由匯出腳本產生，勿手改）
fonts/               Noto Sans TC 子集（由 scripts/build_font_subset.py 產生）
scripts/             export_islands.py（匯出）、islands.template.json（固定文字）、manual.json（手動值）、build_font_subset.py
vendor/              Three.js r170（固定版本，含授權；addons: controls / geometries / utils / lines）
```

## 本機預覽
```
python3 -m http.server 8731 --bind 127.0.0.1
# → http://127.0.0.1:8731/
# 除錯參數（可組合）：
#   ?focus=<島id>&polar=<俯角>&az=<方位>      鏡頭放到該島特寫
#   ?person=<角色>&idx=<第幾個>&dist=<距離>    鏡頭跟著某個小人（正面）
#   &act=1                                    該小人一直重複招牌動作
#   &freeze=1                                 小人全部靜止
#   &act=sit                                  （居民）直接去坐最近的長椅
#   &open=<島id>                              直接打開該島資訊卡（走正式聚焦流程）
#   &debug=1                                  window.__islands = { world, people, camera }
```

## 字型
Noto Sans TC 700 / 900 只保留網站用到的字。文字（JSON 或介面文案）變動後重跑：
```
python3 scripts/build_font_subset.py
```
來源字型放在 repo 根目錄的 `fonts-src/`（已列入 `.gitignore`，不進 git）。repo 裡沒有這個資料夾時，從 `05_ai-islands/fonts-src/` 複製過來再跑。

## 小人（`js/people.js`）
- 30 個，角色與數量來自 JSON `people`（`role` ∈ kang / agent-claude / agent-codex / agent-agy / pilot / boxer / engineer / postman / resident）。
- 每種部件一個 `InstancedMesh`（頭、眼、身體、手臂、腿、帽子、拳套、眼鏡…共 25 池），動畫用隱形 Object3D 骨架算矩陣寫回實例；整批小人約 25 次 draw call。
- 導航：每島三圈候選路徑點 → 用建物／樹／家具的障礙圓過濾 → 線段無遮擋才連邊；棧橋兩端節點接起全島；BFS 找路。跨島只走棧橋。
- LOD：離鏡頭 > 26 單位時眼睛、腮紅、搖桿縮成 0。
- `prefers-reduced-motion`：小人靜止（仍顯示）。

## UI（`js/ui.js`）
- 島名標籤：HTML 按鈕，每幀把島中心上方 3.4 投影到畫面定位；點標籤或點島上任何網格（raycast，按下到放開移動 < 6px 才算點）→ 聚焦。
- 聚焦：鏡頭 0.8 秒 easeInOutCubic 補間到該島（距離 3×島半徑、俯角 50°、保留目前方位），資訊卡從下方滑出，右上出現「全景」；關閉卡片或按全景 → 補間回總覽取景。`prefers-reduced-motion` 時不補間直接跳。
- 資訊卡：編號、島名、一句說明、3 個數字（等寬字、千分位；`null` → 「—（待接）」）、資料更新時間、相關流動線文案。島資料不完整（缺 `name.zh` 或 `stats`）→ 只顯示「資料更新中」。
- 流動線：聚焦某島時顯示與它相關的 `flows`（from → 中央島 → to 的橘色虛線弧＋終點小球，虛線往 to 方向跑）。用 three 的 `Line2`（`vendor/addons/lines/`），線寬 3px 像素單位，視窗改變時更新 `resolution`。
- 聚焦時其他島標籤淡到 40%（hover 回 100%），仍可點。
- 聚焦取景：投影島的六個角與建物高度點，二分搜尋距離使島寬 ≤ 85% 畫面寬、高度塞進「卡片以上可視區」的 86%，再沿鏡頭上方向平移，把島放在可視區中央（卡片高度由 DOM 實測）。
- 資訊卡數字格標籤不換行：塞不下先縮字到 9px，仍塞不下改兩格一列。
- 首次提示「拖曳旋轉・點小島看數據」：第一次按下畫布或點標籤後淡出。
- 視窗大小改變：只有在總覽狀態才重新取景，聚焦中不會被拉回總覽。

## `data/islands.json` 欄位定義（schemaVersion 1.0）

### 頂層
| 欄位 | 型別 | 說明 |
|---|---|---|
| `schemaVersion` | string | 目前 `"1.0"` |
| `updatedAt` | string | 台北時間 ISO 8601（例 `2026-10-25T22:01:30+08:00`），顯示在資訊卡「資料更新時間」 |
| `islands` | array | 7 座島，見下 |
| `people` | array | `{role, island, count}`，`count` 合計 30 |
| `flows` | array | `{from, to, label}`，點島時顯示的流動線 |

### 島（`islands[]`）
| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | `brand` / `ai` / `port` / `lib` / `box` / `fpv` / `bridge`，**必填**；缺就略過該島 |
| `no` | string | 顯示用編號 `"00"`–`"06"` |
| `q`, `r` | integer | 六角 axial 座標（pointy-top），**必填**；非整數就略過該島；同一格只放第一座 |
| `name` | `{zh, en}` | 島名；缺 `zh` → 顯示「資料更新中」 |
| `summary` | `{zh, en}` | 一句說明 |
| `stats` | array | 1～3 筆 `{key, label:{zh,en}, value, …}`，卡片只顯示前 3 筆；只有 1 筆時整列一格；缺或空 → 該島顯示「資料更新中」 |
| `stats[].value` | number / string / null | 數字直接顯示（千分位）；字串只會是模板固定值（例 `"v0.3"`）；`null` 預設顯示「—（待接）」 |
| `stats[].fixed` | boolean | `true` = 模板固定值，不是匯出資料，匯出時不覆寫 |
| `stats[].nullText` | string | `value` 為 `null` 時改顯示這段文字（拳擊島用 `"—"`） |
| `stats[].format` | string | `"percent"` → 0～1 顯示成百分比（橋梁島進度） |
| `visual` | object | 給 3D 動態用的原始數字，或保留不顯示的數字，見下 |

### 各島數字與來源（匯出腳本白名單）
| 島 | 卡片顯示 | `visual` | 來源 |
|---|---|---|---|
| `brand` | `works` 網站作品、`ig_views_30d`、`site_version`（固定 v0.3） | — | kangup-site `data/works.json` 陣列長度；`manual.json` |
| `ai` | `running_sessions`、`sessions_total`、`jobs_total` | `running_sessions`：煙囪冒煙強度，0 → 不冒煙 | `~/.claude-dash/state/*.json` 的 `state`；`~/ai-work/{agy,codex,claude}-out` 子資料夾數 |
| `port` | `new_inbox`（24 小時）、`inbox_failed`、`commands`（固定 2） | `new_inbox`：> 0 → 船靠港，否則港外繞行 | inbox-queue `done/*.json` 的 `received_at`；`failed/` 檔案數 |
| `lib` | `notes`、`wiki`、`raw` | （書塔直接讀 `stats.notes`，對數縮放上限 20 層） | AI資產庫全庫／`wiki/`／`raw/` 的 `.md` 數 |
| `box` | `punches_30d`、`speed_p50`、`ppm`（30 天，無資料時 0／—／—） | `sessions_total`：分析資料夾去重總數，不顯示 | BOXING `Recordings/_分析_*/summary.json`，同影片 `_2`、`_3` 只取尾碼最大 |
| `fpv` | `highlights`、`trainer_commits`、`autocut_version`（固定 v0.2） | — | `~/fpv_output/*.mp4`；fpv-trainer `git rev-list --count HEAD` |
| `bridge` | `progress`（顯示百分比，只此一格） | `progress`：橋面進度條（0～1，超出夾回）；`commits`：不顯示 | `manual.json`；bridge-3d-inspection `git rev-list --count HEAD` |

任一來源讀取失敗 → 該欄 `null`、其他照常，錯誤寫在 stderr。`video_time`／`received_at` 沒帶時區時當台北時間。

### 公開安全（匯出自檢）
JSON 只能有數字、布林、null、固定文案；**不得**出現指令原文、檔案路徑、Discord ID、網址。
`export_islands.py` 寫檔前自檢：`name`／`summary`／`label` 的 zh/en 子樹放行；`updatedAt` 必須是 ISO；其他任何字串（`key`、`role`、`island`、`from`、`to`、固定值…）必須和 `scripts/islands.template.json` 同位置完全相同，否則中止、不寫檔（結束碼 2）。

### 已知限制
- 棧橋是中央島到各島的直線。7 座島的正式座標都與中央島相鄰，若把島移到不相鄰的格子，棧橋會直線拉長、可能貼近其他島。

## 匯出與部署
```
python3 scripts/export_islands.py                         # 產生 data/islands.json
python3 scripts/export_islands.py --out /tmp/x.json       # 輸出到別處（測試）
python3 scripts/export_islands.py --source lib=/不存在      # 覆寫來源（容錯測試）
python3 scripts/export_islands.py --now 2027-06-01T00:00:00+08:00   # 假設現在時間（測試）
python3 scripts/export_islands.py --inject-test-string    # 自檢測試：應中止不寫檔
```
部署＝把 `data/islands.json` commit 並 push 到 `main`，GitHub Pages 自動更新（約 1 分鐘）。

### 改文字
島名、說明、標籤、固定值都在 `scripts/islands.template.json`。改完：跑一次匯出 → 重跑字型子集 → commit、push。

### 改手動值（`scripts/manual.json`）
```json
{ "bridge_progress": 0.67, "ig_views_30d": 54000 }
```
- `bridge_progress`：0～1 的數字（0.67 = 67%）。
- `ig_views_30d`：整數。
- 必須是數字；寫成字串會讓該欄變 `null`。改完跑匯出（或等下一次排程）即可。

## 每小時自動更新（launchd）
- 排程：`~/Library/LaunchAgents/com.kang.ai-islands.plist`，每小時 **:07** 跑 `scripts/publish.sh`，載入時不自動執行（`RunAtLoad` 關閉）。
- `publish.sh` 流程：
  1. 上次 push 失敗留下的 commit 先補推。
  2. 跑 `export_islands.py`。
  3. 排除 `updatedAt` 後和 HEAD 比對。數字沒變就還原檔案、不 commit。
  4. 有變動才 `git commit -m "data: YYYY-MM-DD HH:MM"` 並 push。
- 因為無變動不 commit，卡片上的「資料更新時間」是**最後一次數字有變動的時間**，不是最後一次檢查的時間。
- **null 防護**：新 JSON 的 null 格數比上一版多，就不 commit，log 記 `WARN`，exit 1。這是為了避免來源讀不到或權限問題，把公開網站上的數字洗成「—」。
- 失敗時還原 `data/islands.json` 並 exit 1。push 失敗（例如網路斷線）屬於正常狀況，完整的 commit 會保留，下一小時補推。連續失敗 6 次以上，log 標 `WARN`。

### log
- `logs/publish-YYYY-MM-DD.log`：按日期分檔，每次執行都有「開始」和 OK／FAIL／WARN 一行，匯出的 stderr 也寫在這裡。
- `logs/launchd.log`：launchd 本身的輸出，正常是空的。
- `logs/.fail_count`：連續失敗次數，成功後歸 0。
- 舊 log **不會自動刪**，可以自行手動清理，只留最近 30 天即可。`logs/` 已列入 `.gitignore`。

### 常用指令
```
launchctl list | grep ai-islands                                   # 是否已載入（第二欄 = 上次結束碼）
launchctl kickstart gui/$(id -u)/com.kang.ai-islands               # 立刻跑一次
bash scripts/publish.sh                                            # 不透過 launchd，手動跑一次
launchctl bootout gui/$(id -u)/com.kang.ai-islands                 # 停止排程（plist 留著）
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kang.ai-islands.plist   # 重新載入
```

### 常見狀況
- **AI資產庫、拳擊、網站作品、FPV 訓練平台突然變「—」，log 出現 WARN null 格數增加**：多半是 macOS 隱私權限擋下 launchd 讀 `~/Documents`。到「系統設定 → 隱私權與安全性 → 完整磁碟取用權限」允許 `/opt/homebrew/bin/python3` 和 `/bin/bash`。必須由本人操作。
- **連續 WARN push 失敗**：檢查網路，以及 `git -C ~/Projects/ai-islands push` 能不能手動推，認證用 macOS 鑰匙圈。
