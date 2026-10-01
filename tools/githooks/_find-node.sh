#!/bin/sh
# 公用：找出可用的 node（PATH 里的优先，其次本机 DSH 捆绑的）
# 由 pre-commit / pre-push 等钩子 source。git 执行钩子时的当前目录是仓库根目录。

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  for cand in \
    "/c/Users/HAPPY/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe" \
    "$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe"
  do
    [ -x "$cand" ] && NODE="$cand" && break
  done
fi
