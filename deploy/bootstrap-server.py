from pathlib import Path
import re
import secrets
import shutil
import time

config_path = Path("/home/ubuntu/docker/CLIProxyAPI/config.yaml")
config = config_path.read_text(encoding="utf-8")
managed = re.search(r'^\s*-\s*["\']?([^"\'\s#]+)["\']?\s*#\s*morning-brief-managed-key\s*$', config, re.M)

if managed:
    api_key = managed.group(1)
else:
    api_key = "mb_" + secrets.token_urlsafe(32)
    marker = re.search(r"^api-keys:\s*$", config, re.M)
    if not marker:
        raise RuntimeError("CPA api-keys block not found")
    insertion = f'\n  - "{api_key}" # morning-brief-managed-key'
    config = config[:marker.end()] + insertion + config[marker.end():]
    backup = config_path.with_name(f"config.yaml.backup-morning-brief-{int(time.time())}")
    shutil.copy2(config_path, backup)
    config_path.write_text(config, encoding="utf-8")

settings_dir = Path("/etc/morning-brief")
settings_dir.mkdir(parents=True, exist_ok=True)
env_path = settings_dir / "morning-brief.env"
existing = {}
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            existing[key] = value

values = {
    "NODE_ENV": "production",
    "TZ": "Asia/Shanghai",
    "AUTOMATION_ENABLED": existing.get("AUTOMATION_ENABLED", "true"),
    "REVIEW_GATE_ENABLED": existing.get("REVIEW_GATE_ENABLED", "false"),
    "PAUSE_ON_SEVERE_ERROR": existing.get("PAUSE_ON_SEVERE_ERROR", "true"),
    "DAILY_SCHEDULE_INSTALLED": existing.get("DAILY_SCHEDULE_INSTALLED", "true"),
    "DAILY_COLLECTION_TIME": existing.get("DAILY_COLLECTION_TIME", "06:50"),
    "DAILY_DELIVERY_TIME": existing.get("DAILY_DELIVERY_TIME", "生成完成后"),
    "DAILY_MAX_ITEMS": existing.get("DAILY_MAX_ITEMS", "15"),
    "ZARA_X_FEED_URL": "https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json",
    "ZARA_PODCASTS_FEED_URL": "https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-podcasts.json",
    "ZARA_BLOGS_FEED_URL": "https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-blogs.json",
    "GITHUB_TOKEN": existing.get("GITHUB_TOKEN", ""),
    "LLM_BASE_URL": "http://127.0.0.1:8317/v1",
    "LLM_MODEL": existing.get("LLM_MODEL") or "gpt-5.4-mini",
    "MORNING_BRIEF_LLM_API_KEY": api_key,
    "PUBLIC_URL": "https://breakfast.151014.xyz",
    "OPENCLAW_HOOK_URL": existing.get("OPENCLAW_HOOK_URL", ""),
    "OPENCLAW_HOOK_TOKEN": existing.get("OPENCLAW_HOOK_TOKEN", ""),
    "OPENCLAW_CHANNEL": existing.get("OPENCLAW_CHANNEL", ""),
    "OPENCLAW_TO": existing.get("OPENCLAW_TO", ""),
}
env_path.write_text("\n".join(f"{key}={value}" for key, value in values.items()) + "\n", encoding="utf-8")
env_path.chmod(0o600)
print("Morning Brief production environment prepared without exposing secrets")
