"""Path-safety and deletion logic for the job_cleanup ComfyUI extension.

Pure standard library: nothing here imports ComfyUI, so selftest.py can run it with plain python.
Nothing returned or raised by this module ever contains a file name or path.
"""

import hmac
import os
import re
from typing import Any, Dict, List, Mapping

MAX_ENTRIES = 64
MIN_TOKEN_LENGTH = 16

# The only subfolder of ComfyUI's input directory Comfy stages reference images into,
# and the only file names it uses there (comfy-<uuid>.<ext>).
INPUT_SUBFOLDER = "comfy"
INPUT_NAME = re.compile(r"comfy-[0-9a-fA-F-]{36}\.(png|jpe?g|webp|gif)")

# One path segment: starts with a letter, digit or underscore (so never "." or ".."), then a
# conservative set. No slash, backslash, colon, NUL or other control characters.
SEGMENT = re.compile(r"(?:[A-Za-z0-9_](?:[A-Za-z0-9_.() +,=@-]{0,198}[A-Za-z0-9_)])?)")
MAX_SUBFOLDER_DEPTH = 8
MAX_SUBFOLDER_LENGTH = 200

ALLOWED_TYPES = ("output", "temp", "input")


def token_matches(configured: str, header: str) -> bool:
    """Constant-time check of an `Authorization: Bearer <token>` header against the secret."""
    if len(configured) < MIN_TOKEN_LENGTH:
        return False
    prefix = "Bearer "
    if not header.startswith(prefix):
        return False
    given = header[len(prefix):].strip()
    return hmac.compare_digest(given.encode("utf-8"), configured.encode("utf-8"))


def _subfolder_parts(subfolder: str) -> List[str]:
    """The subfolder's segments, or raise ValueError. An empty subfolder is the root."""
    if subfolder == "":
        return []
    if len(subfolder) > MAX_SUBFOLDER_LENGTH:
        raise ValueError("subfolder too long")
    parts = subfolder.split("/")
    if len(parts) > MAX_SUBFOLDER_DEPTH or not all(SEGMENT.fullmatch(part) for part in parts):
        raise ValueError("bad subfolder")
    return parts


def _inside(base: str, target: str) -> bool:
    """Whether the already-resolved `target` lies strictly inside the resolved `base`."""
    base_n, target_n = os.path.normcase(base), os.path.normcase(target)
    try:
        common = os.path.commonpath([base_n, target_n])
    except ValueError:  # different drives
        return False
    return common == base_n and target_n != base_n


def _delete_one(entry: Any, roots: Mapping[str, str]) -> str:
    """Returns "deleted", "missing" or "refused" for one requested file."""
    if not isinstance(entry, dict):
        return "refused"
    filename, subfolder, kind = entry.get("filename"), entry.get("subfolder", ""), entry.get("type")
    if not (isinstance(filename, str) and isinstance(subfolder, str) and isinstance(kind, str)):
        return "refused"
    if kind not in ALLOWED_TYPES or kind not in roots:
        return "refused"
    if not SEGMENT.fullmatch(filename):
        return "refused"
    if kind == "input" and (subfolder != INPUT_SUBFOLDER or not INPUT_NAME.fullmatch(filename)):
        return "refused"
    try:
        parts = _subfolder_parts(subfolder)
    except ValueError:
        return "refused"

    base = os.path.realpath(roots[kind])
    candidate = os.path.join(base, *parts, filename)
    resolved = os.path.realpath(candidate)
    # realpath follows symlinks and Windows junctions in every segment, so an escape through a
    # linked subfolder (or a link as the file itself) lands outside `base` and is refused here.
    if not _inside(base, resolved):
        return "refused"
    if not os.path.lexists(candidate):
        return "missing"
    if os.path.islink(candidate) or not os.path.isfile(resolved):
        return "refused"
    try:
        os.remove(resolved)
    except FileNotFoundError:
        return "missing"
    except OSError:
        return "refused"
    return "deleted"


def delete_files(files: Any, roots: Mapping[str, str]) -> Dict[str, int]:
    """Deletes the listed files and returns only counts. Raises ValueError for a bad request."""
    if not isinstance(files, list):
        raise ValueError("files must be a list")
    if len(files) > MAX_ENTRIES:
        raise ValueError("too many files")
    counts = {"deleted": 0, "missing": 0, "refused": 0}
    for entry in files:
        counts[_delete_one(entry, roots)] += 1
    return counts
