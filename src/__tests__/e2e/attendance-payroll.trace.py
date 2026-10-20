"""Keep browser actions/snapshots while excluding authenticated HTTP traffic.

Playwright network archives can contain session cookies and auth response bodies.
The acceptance report records sanitized assertions separately, so raw network
traffic is unnecessary. All non-image resource bodies are excluded as well.
"""
import json
from pathlib import Path
import sys
from zipfile import ZipFile, ZIP_DEFLATED

raw_trace = Path(sys.argv[1])
target = Path(sys.argv[2]) if len(sys.argv) > 2 else raw_trace
sensitive = {"cookie", "set-cookie", "authorization", "password", "token", "secret", "sessiontoken", "session_token"}

def scrub(value):
    if isinstance(value, list):
        return [scrub(item) for item in value]
    if isinstance(value, dict):
        if str(value.get("name", "")).lower() in sensitive:
            return {**value, "value": "[redacted]"}
        return {key: "[redacted]" if key.lower() in sensitive else scrub(item) for key, item in value.items()}
    return value

temporary = target.with_suffix(".sanitized.zip")
with ZipFile(raw_trace) as original, ZipFile(temporary, "w", compression=ZIP_DEFLATED) as sanitized:
    for entry in original.infolist():
        if entry.filename.endswith(".network"):
            continue
        data = original.read(entry)
        if entry.filename.startswith("resources/"):
            if not (data.startswith(b"\x89PNG") or data.startswith(b"\xff\xd8\xff") or data.startswith(b"RIFF")):
                continue
        if entry.filename.endswith(".trace"):
            data = ("\n".join(json.dumps(scrub(json.loads(line))) for line in data.decode().splitlines()) + "\n").encode()
        sanitized.writestr(entry, data)
temporary.replace(target)
