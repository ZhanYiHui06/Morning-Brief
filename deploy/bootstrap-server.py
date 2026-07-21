from pathlib import Path
import base64
import os
import re
import secrets
import shutil
import subprocess
import time

config_path_value = os.environ.get("MORNING_BRIEF_PROXY_CONFIG")
if not config_path_value:
    raise RuntimeError("Set MORNING_BRIEF_PROXY_CONFIG to the compatible proxy config path")

config_path = Path(config_path_value)
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

admin_user = existing.get("ADMIN_BASIC_AUTH_USER") or "admin"
if not re.fullmatch(r"[A-Za-z0-9._-]+", admin_user):
    raise RuntimeError("ADMIN_BASIC_AUTH_USER may contain only letters, digits, dot, underscore, and hyphen")
admin_password = existing.get("ADMIN_BASIC_AUTH_PASSWORD") or secrets.token_urlsafe(32)
admin_password_hash = existing.get("ADMIN_BASIC_AUTH_PASSWORD_HASH", "")
if not admin_password_hash:
    try:
        admin_password_hash = subprocess.run(
            ["caddy", "hash-password", "--plaintext", admin_password],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (FileNotFoundError, subprocess.CalledProcessError) as error:
        raise RuntimeError("Caddy is required to generate the admin Basic Auth password hash") from error
if not re.fullmatch(r"\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}", admin_password_hash):
    raise RuntimeError("ADMIN_BASIC_AUTH_PASSWORD_HASH is not a valid bcrypt hash")

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
    "LLM_BASE_URL": existing.get("LLM_BASE_URL") or os.environ.get("LLM_BASE_URL", ""),
    "LLM_MODEL": existing.get("LLM_MODEL", ""),
    "MORNING_BRIEF_LLM_API_KEY": api_key,
    "MORNING_BRIEF_MASTER_KEY": existing.get("MORNING_BRIEF_MASTER_KEY") or base64.b64encode(secrets.token_bytes(32)).decode("ascii"),
    "ADMIN_BASIC_AUTH_USER": admin_user,
    "ADMIN_BASIC_AUTH_PASSWORD": admin_password,
    "PUBLIC_URL": existing.get("PUBLIC_URL") or os.environ.get("PUBLIC_URL", ""),
    "OPENCLAW_HOOK_URL": existing.get("OPENCLAW_HOOK_URL", ""),
    "OPENCLAW_HOOK_TOKEN": existing.get("OPENCLAW_HOOK_TOKEN", ""),
    "OPENCLAW_CHANNEL": existing.get("OPENCLAW_CHANNEL", ""),
    "OPENCLAW_TO": existing.get("OPENCLAW_TO", ""),
}
env_path.write_text("\n".join(f"{key}={value}" for key, value in values.items()) + "\n", encoding="utf-8")
env_path.chmod(0o600)

# The host Caddy service does not load the application EnvironmentFile. Give it a
# separate least-privilege file containing only the public username and password hash.
caddy_env_path = settings_dir / "caddy-admin.env"
caddy_env_path.write_text(
    f"ADMIN_BASIC_AUTH_USER={admin_user}\n"
    f"ADMIN_BASIC_AUTH_PASSWORD_HASH={admin_password_hash}\n",
    encoding="utf-8",
)
caddy_env_path.chmod(0o600)
caddy_dropin_dir = Path("/etc/systemd/system/caddy.service.d")
caddy_dropin_dir.mkdir(parents=True, exist_ok=True)
caddy_dropin_path = caddy_dropin_dir / "morning-brief-admin-auth.conf"
caddy_dropin_path.write_text(
    "[Service]\nEnvironmentFile=/etc/morning-brief/caddy-admin.env\n",
    encoding="utf-8",
)
caddy_dropin_path.chmod(0o644)
subprocess.run(["systemctl", "daemon-reload"], check=True)
subprocess.run(["systemctl", "try-restart", "caddy"], check=True)
print("Morning Brief production environment prepared without exposing secrets")
