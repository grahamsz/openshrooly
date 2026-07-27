#!/usr/bin/env python3

import argparse
import hashlib
import re
from pathlib import Path


SOURCE_FILES = (
    "CMakeLists.txt",
    "pico_sdk_import.cmake",
    "src/CMakeLists.txt",
    "src/capacitive.pio",
    "src/main.c",
)


def source_digest() -> str:
    root = Path(__file__).resolve().parent
    digest = hashlib.sha256()
    for relative_path in SOURCE_FILES:
        digest.update(relative_path.encode())
        digest.update(b"\0")
        digest.update((root / relative_path).read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def render(data: bytes) -> str:
    rows = []
    for offset in range(0, len(data), 12):
        chunk = data[offset : offset + 12]
        rows.append("  " + ", ".join(f"0x{byte:02x}" for byte in chunk) + ",")

    body = "\n".join(rows)
    return f"""// Generated from coprocessor source; do not edit.
// Source SHA-256: {source_digest()}
#pragma once

#include <stdint.h>

#if defined(__cplusplus)
extern "C" {{
#endif

#if defined(__GNUC__)
__attribute__((aligned(4)))
#endif
static const uint8_t firmware_bin[] = {{
{body}
}};

static const uint32_t firmware_bin_len = sizeof(firmware_bin);

#if defined(__cplusplus)
}}
#endif
"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("binary", type=Path, nargs="?")
    parser.add_argument("header", type=Path)
    parser.add_argument("--check-source", action="store_true")
    args = parser.parse_args()

    if args.check_source:
        match = re.search(
            r"^// Source SHA-256: ([0-9a-f]{64})$",
            args.header.read_text(encoding="utf-8"),
            re.MULTILINE,
        )
        if match is None or match.group(1) != source_digest():
            raise SystemExit("Embedded coprocessor image is stale; rebuild firmware.h")
        return

    if args.binary is None:
        parser.error("binary is required unless --check-source is used")
    args.header.write_text(render(args.binary.read_bytes()), encoding="utf-8")


if __name__ == "__main__":
    main()
