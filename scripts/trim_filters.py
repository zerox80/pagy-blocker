#!/usr/bin/env python3
import sys
from datetime import datetime

def is_comment(line: str) -> bool:
    return line.startswith('!') or line.startswith('#')

def is_rule(line: str) -> bool:
    if not line.strip():
        return False
    return not is_comment(line)

def main():
    if len(sys.argv) < 2:
        print("Usage: trim_filters.py <path-to-filter-list> [max_rules]", file=sys.stderr)
        sys.exit(1)
    path = sys.argv[1]
    try:
        max_rules = int(sys.argv[2]) if len(sys.argv) > 2 else 800
    except ValueError:
        print("max_rules must be an integer", file=sys.stderr)
        sys.exit(1)

    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        lines = f.read().splitlines()

    # Preserve only the initial leading comment block as header (if present)
    header = []
    body_start = 0
    for i, line in enumerate(lines):
        if is_comment(line) or not line.strip():
            header.append(line)
        else:
            body_start = i
            break
    else:
        # File had no rules; just keep header
        body_start = len(lines)

    rules = [line for line in lines[body_start:] if is_rule(line)]

    trimmed = rules[:max_rules]

    out_lines = []
    # Keep the leading header block if it existed
    if header:
        out_lines.extend(header)
    # Add a note about trimming
    out_lines.append(f"! Trimmed to {max_rules} rules on {datetime.utcnow().isoformat()}Z")
    out_lines.extend(trimmed)

    with open(path, 'w', encoding='utf-8') as f:
        f.write("\n".join(out_lines) + "\n")

if __name__ == '__main__':
    main()

