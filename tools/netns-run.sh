#!/bin/bash
# Runs a command in its own network namespace with only a loopback interface (Linux, root), so a test suite
# can use the usual ports (8765/8766/8080/8081/8092) while another copy runs on the same machine.
#   sudo bash tools/netns-run.sh xvfb-run -a node central-usage/test-host.mjs
set -euo pipefail
exec unshare --net -- bash -c '
python3 - <<PY
import socket, fcntl, struct
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
flags = struct.unpack("16sH", fcntl.ioctl(s, 0x8913, struct.pack("16sH", b"lo", 0))[:18])[1]
fcntl.ioctl(s, 0x8914, struct.pack("16sH", b"lo", flags | 1))
PY
exec "$@"' bash "$@"
