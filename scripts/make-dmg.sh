#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LockPass — 可靠的 macOS .dmg 生成（不依赖 osascript / Finder / node）
#
# Tauri 自带的 create-dmg 末尾要用 AppleScript 美化窗口，在无 GUI /
# 无 Finder 自动化授权的环境（如 CI、远程、部分本地终端）会失败。
# 这里改用 hdiutil 直接打包：含 <应用名>.app + Applications 快捷方式，
# 任何环境下都能成功，产物命名与 Tauri 一致。
#
# 用法：先 `npm run tauri build`（产出 .app），再 `npm run make-dmg`
# ═══════════════════════════════════════════════════════════════════
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MACOSDIR="$ROOT/src-tauri/target/release/bundle/macos"
DMGDIR="$ROOT/src-tauri/target/release/bundle/dmg"
CONF="$ROOT/src-tauri/tauri.conf.json"

# 从 tauri.conf.json 用 grep 提取（不依赖 node，避免子 shell 中 node 缺失）
PRODUCT=$(grep -m1 '"productName"' "$CONF" | sed -E 's/.*:[[:space:]]*"([^"]+)".*/\1/')
VERSION=$(grep -m1 '"version"'     "$CONF" | sed -E 's/.*:[[:space:]]*"([^"]+)".*/\1/')
ARCH="aarch64"   # 本机 arm64；若构建 universal 请改此值

APP="$MACOSDIR/${PRODUCT}.app"
if [ ! -d "$APP" ]; then
  echo "❌ 找不到 $APP"
  echo "   请先运行: npm run tauri build"
  exit 1
fi

OUT="$DMGDIR/${PRODUCT}_${VERSION}_${ARCH}.dmg"
mkdir -p "$DMGDIR"

STAGE=$(mktemp -d)
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

echo ">>> 生成 dmg: $OUT"
hdiutil create -volname "$PRODUCT" -srcfolder "$STAGE" -ov -format UDZO "$OUT"
rm -rf "$STAGE"

echo "✅ 完成: $OUT ($(du -h "$OUT" | cut -f1))"
