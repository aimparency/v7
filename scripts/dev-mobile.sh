#!/bin/sh
# Phone reaches the dev servers as localhost (secure context; the UI derives the
# backend address from its own host) through adb reverse, over USB or Wi-Fi.
# Over the phone's hotspot, Android's "Wireless debugging" refuses to start, but
# legacy TCP mode works: once per phone boot, plug in USB and run
# `adb tcpip 5555`. Without a device attached, this then connects to the
# default gateway (the phone) on 5555, or to the ip:port given as argument.
#
# A running stack keeps running; its ports come from the runtime config it
# wrote. Otherwise this starts `pnpm dev` on the default ports.
set -e
cd "$(dirname "$0")/.."
if ! adb get-state >/dev/null 2>&1; then
  target=${1:-$(ip route show default | awk '{print $3; exit}'):5555}
  adb connect "$target"
  adb -s "$target" get-state >/dev/null 2>&1 || { echo "No phone at $target. Plug in USB once and run: adb tcpip 5555" >&2; exit 1; }
fi

config=packages/frontend/public/runtime-config.json
running=false
if [ -f "$config" ]; then
  frontend=$(node -p "require('./$config').frontendPort")
  nc -z localhost "$frontend" >/dev/null 2>&1 && running=true
fi
ports=$(if $running; then
  node -p "const c = require('./$config'); [c.frontendPort, c.backendHttpPort, c.backendWsPort].join(' ')"
else
  echo 4000 3000 3001
fi)
for port in $ports; do adb reverse "tcp:$port" "tcp:$port"; done
echo "On the phone, open http://localhost:${ports%% *}"
$running || exec pnpm dev
