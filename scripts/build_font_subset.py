#!/usr/bin/env python3
"""產生 Noto Sans TC 子集字型（700 / 900），只保留網站實際用到的字。

用法：
    python3 scripts/build_font_subset.py

來源字型放在 fonts-src/（不進 git，只有產出的子集會進 fonts/）：
    fonts-src/NotoSansTC-Bold.otf    → fonts/NotoSansTC-700.woff2
    fonts-src/NotoSansTC-Black.otf   → fonts/NotoSansTC-900.woff2
（若來源是可變字型 NotoSansTC[wght].ttf，會自動在 700 / 900 兩個權重實體化）

字集來源：
    1. data/islands.json 裡所有 zh / en 字串
    2. index.html 與 js/*.js 裡 UI_TEXT 常數與 HTML 文字
    3. 固定保底：ASCII 可見字元、全形標點、「資料更新中」等固定文案
文字變動時重跑即可，會印出字數與檔案大小。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "fonts-src"
SITE = ROOT / "site" if (ROOT / "site" / "index.html").is_file() else ROOT  # repo 版網站在根目錄
OUT_DIR = SITE / "fonts"

WEIGHTS = {700: "NotoSansTC-Bold", 900: "NotoSansTC-Black"}
VARIABLE_NAME = "NotoSansTC[wght]"

# 不管 JSON 寫什麼都一定保留的字（UI 固定文案、常見標點）
ALWAYS = (
    "康總的Ai群島 資料更新中 全景 拖曳旋轉・點小島看數據 "
    "群島資料暫時讀不到，請稍後重新整理。 資料更新時間 關閉 "
    "0123456789 ，。、：；！？（）「」『』—－・‧…％＋ "
)


def collect_strings(obj, out: set[str]) -> None:
    if isinstance(obj, str):
        out.update(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            collect_strings(v, out)
    elif isinstance(obj, list):
        for v in obj:
            collect_strings(v, out)


def gather_chars() -> set[str]:
    chars: set[str] = set(ALWAYS)
    chars.update(chr(c) for c in range(0x20, 0x7F))  # ASCII 可見字元

    data = json.loads((SITE / "data" / "islands.json").read_text("utf-8"))
    collect_strings(data, chars)

    # HTML 標籤之間的文字
    html = (SITE / "index.html").read_text("utf-8")
    for text in re.findall(r">([^<>]+)<", html):
        chars.update(text)

    # JS 字串常值（單、雙引號與樣板字串）
    for js in (SITE / "js").glob("*.js"):
        src = js.read_text("utf-8")
        for m in re.finditer(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"|`((?:[^`\\]|\\.)*)`", src):
            chars.update(m.group(1) or m.group(2) or m.group(3) or "")

    chars.discard("\n")
    chars.discard("\t")
    return chars


def find_source(weight: int) -> tuple[Path, bool]:
    for ext in ("otf", "ttf"):
        p = SRC_DIR / f"{WEIGHTS[weight]}.{ext}"
        if p.exists():
            return p, False
    for ext in ("ttf", "otf"):
        p = SRC_DIR / f"{VARIABLE_NAME}.{ext}"
        if p.exists():
            return p, True
    sys.exit(f"找不到來源字型：請把 {WEIGHTS[weight]}.otf 或 {VARIABLE_NAME}.ttf 放進 {SRC_DIR}/")


def build(weight: int, chars: set[str]) -> Path:
    src, is_variable = find_source(weight)
    font = TTFont(str(src))

    if is_variable:
        from fontTools.varLib import instancer

        font = instancer.instantiateVariableFont(font, {"wght": weight})

    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["kern", "liga", "palt"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.recalc_bounds = True
    options.hinting = False
    options.desubroutinize = True

    subsetter = subset.Subsetter(options)
    subsetter.populate(text="".join(sorted(chars)))
    subsetter.subset(font)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"NotoSansTC-{weight}.woff2"
    font.save(str(out))
    return out


def main() -> None:
    chars = gather_chars()
    cjk = sum(1 for c in chars if ord(c) > 0x2E7F)
    print(f"字集：{len(chars)} 字（其中中日韓字 {cjk}）")
    for weight in WEIGHTS:
        out = build(weight, chars)
        print(f"  {weight} → {out.relative_to(ROOT)}  {out.stat().st_size / 1024:.1f} KiB")


if __name__ == "__main__":
    main()
