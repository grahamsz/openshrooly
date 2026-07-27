#!/usr/bin/env python3
"""
Script to generate embedded static file handlers for Next.js app.
This creates the C++ code to serve all the static assets.
"""

import gzip
import os
import re
import sys
from pathlib import Path
from html.parser import HTMLParser


class AssetReferenceParser(HTMLParser):
    """Collect local stylesheet, script, and icon URLs from exported HTML."""

    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        url = attributes.get("src") if tag == "script" else attributes.get("href")
        if url and url.startswith("/") and not url.startswith("//"):
            self.urls.append(url.split("?", 1)[0].split("#", 1)[0])


def find_static_files(webapp_out_dir):
    """Find exactly the assets referenced by the exported dashboard HTML."""
    webapp_path = Path(webapp_out_dir)
    index_html = webapp_path / "index.html"
    if not index_html.is_file():
        raise FileNotFoundError(f"Exported dashboard not found: {index_html}")

    parser = AssetReferenceParser()
    parser.feed(index_html.read_text(encoding="utf-8"))

    static_files = []
    for url in dict.fromkeys(parser.urls):
        # URLs in the HTML are rooted at the device, whereas the export directory
        # stores the same paths without the leading slash.
        file_path = webapp_path / url.lstrip("/")
        if not file_path.is_file():
            raise FileNotFoundError(
                f"Dashboard references {url}, but it was not produced in {webapp_path}"
            )
        relative_path = file_path.relative_to(webapp_path)
        static_files.append(str(relative_path))
        print(f"Found asset: {relative_path}")

    return static_files


def verify_embedded_files(webapp_out_dir, input_header, input_cpp):
    """Verify that embedded gzip streams expand to the exported dashboard assets.

    The exact DEFLATE stream produced by Python's gzip module can vary with the
    linked zlib version. Comparing expanded content keeps this check portable
    while still catching stale, missing, reordered, or incorrectly mapped files.
    """
    webapp_path = Path(webapp_out_dir)
    static_files = find_static_files(webapp_out_dir)
    header_content = Path(input_header).read_text(encoding="utf-8")
    cpp_content = Path(input_cpp).read_text(encoding="utf-8")

    data_matches = {
        int(index): payload
        for index, payload in re.findall(
            r"const uint8_t STATIC_FILE_(\d+)_DATA\[\] PROGMEM = "
            r"\{([^}]*)\};",
            cpp_content,
            re.DOTALL,
        )
    }
    size_matches = {
        int(index): int(size)
        for index, size in re.findall(
            r"const size_t STATIC_FILE_(\d+)_SIZE = (\d+);", cpp_content
        )
    }
    mapping_matches = {
        int(index): (content_type, url)
        for index, content_type, url in re.findall(
            r"\{STATIC_FILE_(\d+)_DATA, STATIC_FILE_\1_SIZE, "
            r'"([^"]+)", "([^"]+)"\}',
            cpp_content,
        )
    }
    declared_data = {
        int(index)
        for index in re.findall(
            r"extern const uint8_t STATIC_FILE_(\d+)_DATA\[\];", header_content
        )
    }
    declared_sizes = {
        int(index)
        for index in re.findall(
            r"extern const size_t STATIC_FILE_(\d+)_SIZE;", header_content
        )
    }

    expected_indexes = set(range(len(static_files)))
    parsed_indexes = set(data_matches)
    errors = []
    if parsed_indexes != expected_indexes:
        errors.append(
            f"data indexes are {sorted(parsed_indexes)}, expected "
            f"{sorted(expected_indexes)}"
        )
    if set(size_matches) != expected_indexes:
        errors.append("embedded size declarations do not match the asset list")
    if set(mapping_matches) != expected_indexes:
        errors.append("embedded URL mappings do not match the asset list")
    if declared_data != expected_indexes or declared_sizes != expected_indexes:
        errors.append("header declarations do not match the asset list")

    count_match = re.search(
        r"const size_t STATIC_FILES_COUNT = (\d+);", cpp_content
    )
    if not count_match or int(count_match.group(1)) != len(static_files):
        errors.append("STATIC_FILES_COUNT does not match the asset list")

    content_types = {
        ".css": "text/css",
        ".ico": "image/x-icon",
        ".js": "application/javascript",
    }

    for index, file_path in enumerate(static_files):
        if index not in data_matches:
            continue

        tokens = re.findall(r"0x([0-9a-fA-F]{2})", data_matches[index])
        compressed = bytes(int(token, 16) for token in tokens)
        if size_matches.get(index) != len(compressed):
            errors.append(f"{file_path}: embedded size is incorrect")
            continue

        try:
            embedded_data = gzip.decompress(compressed)
        except (gzip.BadGzipFile, EOFError, OSError) as error:
            errors.append(f"{file_path}: invalid gzip stream ({error})")
            continue

        expected_data = (webapp_path / file_path).read_bytes()
        if embedded_data != expected_data:
            errors.append(f"{file_path}: embedded content is stale")

        expected_mapping = (
            content_types.get(Path(file_path).suffix, "application/octet-stream"),
            f"/{file_path}",
        )
        if mapping_matches.get(index) != expected_mapping:
            errors.append(f"{file_path}: content type or URL mapping is incorrect")

    if errors:
        raise ValueError(
            "Embedded dashboard verification failed:\n- " + "\n- ".join(errors)
        )

    print(
        f"Verified {len(static_files)} embedded dashboard assets "
        f"against {webapp_path}"
    )


def generate_embedded_files(webapp_out_dir, output_header, output_cpp):
    """Generate header and cpp files with embedded static assets."""

    webapp_path = Path(webapp_out_dir)

    # Auto-discover files
    STATIC_FILES = find_static_files(webapp_out_dir)

    # Generate header file
    header_content = """// Auto-generated file - do not edit
#pragma once

#include <cstdint>
#include <cstddef>

namespace esphome {
namespace web_server {

// Static file data structures
struct StaticFile {
    const uint8_t* data;
    size_t size;
    const char* content_type;
    const char* url;
};

"""

    # Generate cpp file
    cpp_content = """// Auto-generated file - do not edit
#include "static_files.h"
#include <Arduino.h>

namespace esphome {
namespace web_server {

"""

    all_files = []
    file_index = 0

    content_types = {
        ".css": "text/css",
        ".ico": "image/x-icon",
        ".js": "application/javascript",
    }

    for file_path in STATIC_FILES:
        full_path = webapp_path / file_path
        content_type = content_types.get(full_path.suffix, "application/octet-stream")

        # Read and compress file
        with open(full_path, 'rb') as f:
            data = f.read()
        compressed = gzip.compress(data, mtime=0)

        # Generate variable name
        var_name = f"STATIC_FILE_{file_index}"
        url = f"/{file_path}"

        # Add to header
        header_content += f"extern const uint8_t {var_name}_DATA[];\n"
        header_content += f"extern const size_t {var_name}_SIZE;\n"

        # Add to cpp with PROGMEM attribute to store in flash not RAM
        bytes_str = ", ".join(f"0x{b:02x}" for b in compressed)
        cpp_content += f"const uint8_t {var_name}_DATA[] PROGMEM = {{{bytes_str}}};\n"
        cpp_content += f"const size_t {var_name}_SIZE = {len(compressed)};\n\n"

        all_files.append((var_name, content_type, url))
        file_index += 1

        print(f"Embedded: {file_path} ({len(data)} -> {len(compressed)} bytes)")

    # Add array of all files
    header_content += f"\nextern const StaticFile STATIC_FILES[];\n"
    header_content += f"extern const size_t STATIC_FILES_COUNT;\n"
    header_content += "\n}  // namespace web_server\n}  // namespace esphome\n"

    cpp_content += "const StaticFile STATIC_FILES[] PROGMEM = {\n"
    for var_name, content_type, url in all_files:
        cpp_content += f'    {{{var_name}_DATA, {var_name}_SIZE, "{content_type}", "{url}"}},\n'
    cpp_content += "};\n\n"
    cpp_content += f"const size_t STATIC_FILES_COUNT = {len(all_files)};\n\n"
    cpp_content += "}  // namespace web_server\n}  // namespace esphome\n"

    # Write files
    with open(output_header, 'w') as f:
        f.write(header_content)

    with open(output_cpp, 'w') as f:
        f.write(cpp_content)

    print(f"\nGenerated {output_header} and {output_cpp}")
    print(f"Total files: {len(all_files)}")
    total_size = sum(os.path.getsize(webapp_path / f) for f in STATIC_FILES)
    print(f"Total uncompressed size: {total_size:,} bytes")


if __name__ == "__main__":
    if len(sys.argv) == 5 and sys.argv[1] == "--check":
        verify_embedded_files(sys.argv[2], sys.argv[3], sys.argv[4])
    elif len(sys.argv) == 4:
        generate_embedded_files(sys.argv[1], sys.argv[2], sys.argv[3])
    else:
        print(
            "Usage: embed_static_files.py [--check] "
            "<webapp_out_dir> <output.h> <output.cpp>"
        )
        sys.exit(1)
