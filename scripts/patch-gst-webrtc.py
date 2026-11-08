#!/usr/bin/env python3
"""
Patch for GStreamer's libgstwebrtc.so to allow Base64 padding '=' in ICE credentials.
WhatsApp Web sends 96-char (ufrag) and 24-char (pwd) Base64 strings ending in '==' or '=',
which GStreamer's RFC 5245 literal validator rejects by default.
"""

import os
import shutil
import sys

def main():
    system_plugin = "/usr/lib/gstreamer-1.0/libgstwebrtc.so"
    dest_dir = os.path.expanduser("~/.local/lib/gstreamer-1.0")
    dest_file = os.path.join(dest_dir, "libgstwebrtc.so")

    if not os.path.exists(system_plugin):
        print(f"Error: {system_plugin} not found.")
        sys.exit(1)

    os.makedirs(dest_dir, exist_ok=True)
    shutil.copy2(system_plugin, dest_file)
    print(f"Copied {system_plugin} -> {dest_file}")

    with open(dest_file, "rb") as f:
        data = bytearray(f.read())

    # Locate _validate_ice_attr signature
    # 48 8b 05 ?? ?? ?? ?? 48 8b 38 (loading g_ascii_table right after length checks)
    pattern = bytes.fromhex("488b05")
    match_offset = -1
    pos = 0

    while True:
        pos = data.find(pattern, pos)
        if pos == -1:
            break
        # Check if next bytes match: 48 8b 05 [4 bytes] 48 8b 38
        if data[pos+7:pos+10] == bytes.fromhex("488b38"):
            match_offset = pos
            break
        pos += 1

    if match_offset == -1:
        print("Error: Could not locate _validate_ice_attr signature in binary.")
        sys.exit(1)

    print(f"Found signature at offset {hex(match_offset)}")

    # Replace with:
    # mov eax, 1   (b8 01 00 00 00)
    # pop rbx      (5b)
    # pop r12      (41 5c)
    # pop rbp      (5d)
    # ret          (c3)
    patch = bytes.fromhex("b8010000005b415c5dc3")
    data[match_offset:match_offset + len(patch)] = patch

    with open(dest_file, "wb") as f:
        f.write(data)

    print(f"Successfully patched {dest_file}!")
    print("RustApp will automatically load this patched plugin from ~/.local/lib/gstreamer-1.0.")

if __name__ == "__main__":
    main()
