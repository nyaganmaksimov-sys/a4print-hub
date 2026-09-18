#!/usr/bin/env python3
import pathlib
import re
import sys

FILES = [pathlib.Path(x) for x in sys.argv[1:]]
errors = []

SAFE_SCOPE_MARKERS = (
    "private.assert_",
    "current_user_organization_id(",
    "current_partner_id(",
    "equipment_payment_contract_tenant_org(",
    "equipment_condition_claim_financial_tenant_org(",
)

def normalized(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower()).strip()

def find_function_blocks(text: str):
    start_re = re.compile(
        r"create\s+or\s+replace\s+function\s+public\.([a-zA-Z0-9_]+)\s*\(",
        re.IGNORECASE,
    )
    for match in start_re.finditer(text):
        name = match.group(1)
        if "equipment" not in name.lower() and "production" not in name.lower():
            continue
        tail = text[match.start():]
        as_match = re.search(r"\bas\s+(\$[a-zA-Z0-9_]*\$)", tail, re.IGNORECASE)
        if not as_match:
            errors.append(f"{name}: cannot locate function body delimiter")
            continue
        tag = as_match.group(1)
        body_start = as_match.end()
        body_end = tail.find(tag, body_start)
        if body_end < 0:
            errors.append(f"{name}: cannot locate closing function body delimiter")
            continue
        end = body_end + len(tag)
        yield name, tail[:end]

for path in FILES:
    if not path.exists() or path.suffix.lower() != ".sql":
        continue
    text = path.read_text(encoding="utf-8")
    low = normalized(text)

    # Explicit regressions are forbidden even when not part of a CREATE FUNCTION block.
    unsafe_path_patterns = (
        r"alter function public\.[a-z0-9_]*(?:equipment|production)[a-z0-9_]*\([^;]*?\) set search_path (?:to|=) 'public'",
        r"set search_path (?:to|=) 'public'",
    )
    for pat in unsafe_path_patterns:
        if re.search(pat, low, re.IGNORECASE):
            errors.append(f"{path}: unsafe search_path=public detected")
            break

    if re.search(
        r"grant execute on function public\.[a-z0-9_]*(?:equipment|production)[a-z0-9_]*\([^;]*?\) to [^;]*\banon\b",
        low,
        re.IGNORECASE,
    ):
        errors.append(f"{path}: anon EXECUTE grant detected for equipment/production function")

    for name, block in find_function_blocks(text):
        block_low = normalized(block)
        if "security definer" not in block_low:
            continue

        if not re.search(r"set search_path\s*(?:to|=)\s*''", block_low, re.IGNORECASE):
            errors.append(f"{path}: public.{name} SECURITY DEFINER must use empty search_path")

        is_internal = (
            re.search(r"returns\s+trigger\b", block_low) is not None
            or name.lower().endswith("_internal")
            or name.lower().endswith("_trigger")
        )

        revoked_from_clients = re.search(
            rf"revoke all on function public\.{re.escape(name.lower())}\s*\(",
            low,
            re.IGNORECASE,
        ) is not None and "from public,anon,authenticated" in low

        if is_internal or revoked_from_clients:
            continue

        if not any(marker in block_low for marker in SAFE_SCOPE_MARKERS):
            errors.append(
                f"{path}: public.{name} SECURITY DEFINER has no recognized tenant/partner scope guard"
            )

if errors:
    print("Production Farm security baseline failed:")
    for error in errors:
        print(f" - {error}")
    sys.exit(1)

print(f"Production Farm security baseline OK ({len(FILES)} changed SQL file(s) checked)")
