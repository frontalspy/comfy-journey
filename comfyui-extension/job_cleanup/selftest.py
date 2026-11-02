"""Self-test for safe_paths. Run with plain python: `python selftest.py`. No ComfyUI needed."""

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import safe_paths as sp  # noqa: E402

failures = []


def check(name, condition):
    if not condition:
        failures.append(name)
        print("FAIL", name)


def ref(filename, subfolder="", kind="output"):
    return {"filename": filename, "subfolder": subfolder, "type": kind}


def run(files, roots):
    return sp.delete_files(files, roots)


with tempfile.TemporaryDirectory() as tmp:
    out, temp, inp, outside = (os.path.join(tmp, n) for n in ("output", "temp", "input", "outside"))
    for d in (out, temp, os.path.join(inp, "comfy"), outside, os.path.join(out, "run")):
        os.makedirs(d)
    roots = {"output": out, "temp": temp, "input": inp}

    def touch(path):
        with open(path, "wb") as handle:
            handle.write(b"x")
        return path

    # Normal deletes, idempotence, nested subfolder, temp, comfy input.
    a = touch(os.path.join(out, "a.png"))
    nested = touch(os.path.join(out, "run", "b.mp4"))
    t = touch(os.path.join(temp, "ComfyUI_temp_abcde_00001_.png"))
    uuid = "123e4567-e89b-12d3-a456-426614174000"
    i = touch(os.path.join(inp, "comfy", "comfy-%s.png" % uuid))
    res = run([ref("a.png"), ref("b.mp4", "run"), ref("ComfyUI_temp_abcde_00001_.png", "", "temp"),
               ref("comfy-%s.png" % uuid, "comfy", "input")], roots)
    check("deletes four", res == {"deleted": 4, "missing": 0, "refused": 0})
    check("files gone", not any(os.path.exists(p) for p in (a, nested, t, i)))
    check("idempotent", run([ref("a.png")], roots) == {"deleted": 0, "missing": 1, "refused": 0})
    check("missing subfolder", run([ref("a.png", "nope")], roots)["missing"] == 1)

    # Wrong types and bad shapes.
    keep = touch(os.path.join(out, "keep.png"))
    bad = [
        ref("keep.png", "", "models"), ref("keep.png", "", "input"), ref("keep.png", "", ""),
        ref("keep.png", "", "OUTPUT"), {"filename": "keep.png"}, {"filename": 1, "type": "output"},
        {"filename": "keep.png", "subfolder": None, "type": "output"}, "keep.png", None, 5,
        ref("comfy-%s.png" % uuid, "other", "input"), ref("keep.png", "comfy", "input"),
        ref("comfy-%s.png" % uuid, "", "input"),
    ]
    res = run(bad, roots)
    check("bad shapes refused", res == {"deleted": 0, "missing": 0, "refused": len(bad)})
    check("keep untouched", os.path.exists(keep))

    # Traversal and path tricks, as filename and as subfolder.
    secret = touch(os.path.join(outside, "secret.png"))
    tricks = [
        "../outside/secret.png", r"..\outside\secret.png", "..", ".", "", "/etc/passwd",
        r"C:\Windows\win.ini", "C:secret.png", "a/b.png", r"a\b.png", ".hidden", "x\x00.png",
        "keep.png\x00", "keep.png ", "keep.png.", "con", "nul.png", "a" * 300, "\u2024\u2024/x.png", "%2e%2e/x.png", "a:b",
        os.path.abspath(secret), "~", "con/../x.png", "keep.png\n",
    ]
    files = [ref(name) for name in tricks]
    files += [ref("secret.png", sub) for sub in (
        "..", "../outside", r"..\outside", "run/..", "run/../..", "/", "/outside", ".", "./run",
        "C:", "C:\\", "run//", "run/", "a" * 300, "a/" * 9 + "a", "run\x00", "%2e%2e", os.path.abspath(outside),
    )]
    res = run(files, roots)
    check("tricks all refused or missing, none deleted", res["deleted"] == 0)
    check("tricks refused", res["refused"] >= len(tricks) - 1 + 10)
    check("secret survives", os.path.exists(secret) and os.path.exists(keep))

    # Directories are never deleted.
    os.makedirs(os.path.join(out, "adir.png"))
    check("directory refused", run([ref("adir.png")], roots)["refused"] == 1)
    check("directory survives", os.path.isdir(os.path.join(out, "adir.png")))

    # Symlink / junction escapes, where the platform lets us create them.
    link_file = os.path.join(out, "link.png")
    link_dir = os.path.join(out, "linkdir")
    made_file = made_dir = False
    try:
        os.symlink(secret, link_file)
        made_file = True
    except (OSError, NotImplementedError):
        pass
    try:
        os.symlink(outside, link_dir, target_is_directory=True)
        made_dir = True
    except (OSError, NotImplementedError):
        if os.name == "nt":  # a junction needs no privilege
            import subprocess
            made_dir = subprocess.run(["cmd", "/c", "mklink", "/J", link_dir, outside],
                                      capture_output=True).returncode == 0
    if made_file:
        check("symlinked file refused", run([ref("link.png")], roots)["refused"] == 1)
    else:
        print("note: file symlink not creatable here, skipped")
    if made_dir:
        check("linked subfolder refused", run([ref("secret.png", "linkdir")], roots)["refused"] == 1)
    else:
        print("note: directory link not creatable here, skipped")
    check("secret survives links", os.path.exists(secret))

    # Oversize and malformed requests.
    for payload in ([ref("a.png")] * (sp.MAX_ENTRIES + 1), "x", None, {"files": []}, 7):
        try:
            run(payload, roots)
            check("bad request raises", False)
        except ValueError:
            pass
    check("exactly max entries ok", run([ref("a.png")] * sp.MAX_ENTRIES, roots)["missing"] == sp.MAX_ENTRIES)
    check("empty list ok", run([], roots) == {"deleted": 0, "missing": 0, "refused": 0})

    # A root that is not configured refuses rather than guessing.
    check("unknown root refused", run([ref("keep.png", "", "temp")], {"output": out})["refused"] == 1)

    # Result never carries names.
    check("counts only", set(res) == {"deleted", "missing", "refused"})

# Token comparison.
good = "t" * 24
check("token ok", sp.token_matches(good, "Bearer " + good))
check("token wrong", not sp.token_matches(good, "Bearer " + "u" * 24))
check("token missing header", not sp.token_matches(good, ""))
check("token wrong scheme", not sp.token_matches(good, "Basic " + good))
check("token no space", not sp.token_matches(good, "Bearer" + good))
check("token short secret never matches", not sp.token_matches("short", "Bearer short"))
check("token empty secret never matches", not sp.token_matches("", "Bearer "))
check("token prefix not enough", not sp.token_matches(good, "Bearer " + good[:-1]))
check("token non-ascii header", not sp.token_matches(good, "Bearer \u00e9" * 3))

if failures:
    print("%d check(s) failed" % len(failures))
    sys.exit(1)
print("job_cleanup selftest: all checks passed")
