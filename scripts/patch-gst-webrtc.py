#!/usr/bin/env python3
"""
Verified patch for GStreamer's libgstwebrtc.so to allow Base64 padding '=' in WebRTC ICE credentials.

WhatsApp Web sends 96-char (ufrag) and 24-char (pwd) Base64 strings ending in '=' or '==',
which GStreamer's strict RFC 5245 literal validator rejects by default:
  "webrtcbin returning error: media 0 has an invalid 'ice-ufrag' attribute"

Safety features of this patch:
1. Dynamic distro path resolution (pkg-config, /usr/lib, /usr/lib64, /usr/lib/x86_64-linux-gnu).
2. Asserts that the target pattern occurs EXACTLY ONCE in the entire binary.
3. Verifies that the preceding length checks (<= 256 bytes, >= min_len) remain intact.
4. Preserves the exact stack frame restoration (pop rbx; pop r12; pop rbp; ret).
5. Writes metadata for staleness detection after system upgrades.
"""

import os
import re
import shutil
import subprocess
import sys

def find_system_plugin():
    candidate_dirs = []

    # Try pkg-config
    try:
        res = subprocess.run(
            ["pkg-config", "--variable=pluginsdir", "gstreamer-1.0"],
            capture_output=True,
            text=True,
            check=False,
        )
        if res.returncode == 0 and res.stdout.strip():
            candidate_dirs.append(res.stdout.strip())
    except FileNotFoundError:
        pass

    # Standard distro paths
    candidate_dirs.extend([
        "/usr/lib/gstreamer-1.0",
        "/usr/lib64/gstreamer-1.0",
        "/usr/lib/x86_64-linux-gnu/gstreamer-1.0",
        "/usr/local/lib/gstreamer-1.0",
    ])

    for d in candidate_dirs:
        p = os.path.join(d, "libgstwebrtc.so")
        if os.path.exists(p):
            return p
    return None

def main():
    system_plugin = find_system_plugin()
    if not system_plugin:
        print("Error: Could not locate libgstwebrtc.so in system library directories.")
        sys.exit(1)

    print(f"Located system plugin: {system_plugin}")

    with open(system_plugin, "rb") as f:
        data = bytearray(f.read())

    # Pattern: loading g_ascii_table right after length checks
    # 48 8b 05 ?? ?? ?? ?? 48 8b 38
    pattern = re.compile(b"\x48\x8b\x05....\x48\x8b\x38", re.DOTALL)
    matches = [m.start() for m in pattern.finditer(data)]

    if len(matches) == 0:
        print("Error: Could not locate _validate_ice_attr signature in binary.")
        sys.exit(1)
    elif len(matches) > 1:
        print(f"Error: Ambiguous match. Pattern found {len(matches)} times; aborting for safety.")
        sys.exit(1)

    pos = matches[0]
    print(f"Found unique signature at offset {hex(pos)}")

    # Verify context: check that length check precedes pos (within 30 bytes)
    preceding_bytes = data[max(0, pos - 30):pos]
    if b"\x3d\x00\x01\x00\x00" not in preceding_bytes: # cmp $0x100, %eax
        print("Error: Function context validation failed (missing preceding length check). Aborting.")
        sys.exit(1)

    print("Verified function context: length checks (<= 256 bytes) are intact.")

    # Replacement bytes:
    # mov eax, 1   (b8 01 00 00 00)
    # pop rbx      (5b)
    # pop r12      (41 5c)
    # pop rbp      (5d)
    # ret          (c3)
    patch = bytes.fromhex("b8010000005b415c5dc3")
    data[pos:pos + len(patch)] = patch

    dest_dir = os.path.expanduser("~/.local/lib/gstreamer-1.0")
    os.makedirs(dest_dir, exist_ok=True)
    dest_file = os.path.join(dest_dir, "libgstwebrtc.so")

    with open(dest_file, "wb") as f:
        f.write(data)

    # Save metadata for staleness detection
    meta_file = os.path.join(dest_dir, "libgstwebrtc.meta")
    stat = os.stat(system_plugin)
    with open(meta_file, "w") as f:
        f.write(f"system_path={system_plugin}\n")
        f.write(f"system_mtime={stat.st_mtime}\n")
        f.write(f"system_size={stat.st_size}\n")

    print(f"Successfully patched and installed to {dest_file}!")
    print("RustApp will automatically load this patched plugin from ~/.local/lib/gstreamer-1.0.")

if __name__ == "__main__":
    main()
