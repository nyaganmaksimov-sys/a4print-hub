#!/usr/bin/env python3
"""Fail closed when a 3D-ARTPRINT PR includes forbidden cross-system edits.

Usage: python3 scripts/check_3d_artprint_scope.py [changed paths...]
If no args, read changed paths (newline separated) on stdin.
"""
import sys

MODULE_PREFIXES = ("admin/3d-artprint", "admin/assets/3d-artprint/", "docs/3D_ARTPRINT")
FORBIDDEN_PREFIXES = ("kassa/", "desktop-kassa/", "api/", "shared/", "database/migrations/", "supabase/migrations/")
FORBIDDEN_EXACT = {
    "admin/guard.js", "admin/config.js", "admin/navigation.js",
    "admin/mobile-shell.js", "admin/human-light-ui.css",
    "admin/index.html", "admin/app.js",
}

def classify(paths):
    changed = [p.strip() for p in paths if p.strip()]
    is_3d_change = any(p.startswith(MODULE_PREFIXES) for p in changed)
    if not is_3d_change:
        return []
    return [p for p in changed if p.startswith(FORBIDDEN_PREFIXES) or p in FORBIDDEN_EXACT]

def main():
    paths = sys.argv[1:] if len(sys.argv) > 1 else sys.stdin.read().splitlines()
    forbidden = classify(paths)
    if forbidden:
        print("BLOCKED: 3D-ARTPRINT change includes protected shared/cashier paths:")
        for path in forbidden:
            print(f"  - {path}")
        print("Split infrastructure/cashier changes into a separately reviewed PR.")
        return 1
    print("OK: 3D-ARTPRINT scope guard passed")
    return 0

if __name__ == "__main__":
    sys.exit(main())
