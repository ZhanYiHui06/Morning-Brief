from pathlib import Path
import json
import urllib.request

env = {}
for line in Path("/etc/morning-brief/morning-brief.env").read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        key, value = line.split("=", 1)
        env[key] = value

request = urllib.request.Request(
    env["LLM_BASE_URL"].rstrip("/") + "/models",
    headers={"Authorization": "Bearer " + env["MORNING_BRIEF_LLM_API_KEY"]},
)
with urllib.request.urlopen(request, timeout=15) as response:
    payload = json.load(response)

for model in payload.get("data", []):
    identifier = model.get("id")
    if identifier:
        print(identifier)
