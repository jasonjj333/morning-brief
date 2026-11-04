"""Morning Brief scheduler: starts each routine at the times set in the app (Settings → Routines).

Runs every few minutes from GitHub Actions. For each vault repo it reads Feedback/routines.json, works out
which scheduled time slots are due (America/Chicago), and dispatches that vault's "Run routine" workflow with
the routine, the model picked for that slot, and a slot id. The vault's workflow fires the routine with its
own token and records the slot in Feedback/runs.json, so a slot never runs twice.

Prints only routine keys and outcomes: this repository's Action logs are public.
"""
import base64, json, os, sys, urllib.error, urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Chicago")
WINDOW = timedelta(minutes=90)  # catch up on a slot this long after its time (GitHub can delay scheduled runs)
TOKEN = (os.environ.get("SCHEDULER_TOKEN") or "").strip()
VAULTS = (os.environ.get("VAULTS") or "").split()
DRY = os.environ.get("DRY_RUN") == "true"
NOW = datetime.now(TZ) if not os.environ.get("NOW") else datetime.fromisoformat(os.environ["NOW"]).astimezone(TZ)


def api(path, body=None):
    req = urllib.request.Request(f"https://api.github.com{path}", data=json.dumps(body).encode() if body is not None else None,
                                 method="POST" if body is not None else "GET",
                                 headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json",
                                          "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "morning-brief-scheduler"})
    with urllib.request.urlopen(req, timeout=30) as res:
        raw = res.read()
        return json.loads(raw) if raw else {}


def read_json(repo, path, default):
    try:
        f = api(f"/repos/{repo}/contents/{path}?ref=main")
        return json.loads(base64.b64decode(f["content"]))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return default
        raise


def minutes(hhmm):
    h, m = str(hhmm or "0:0").split(":")[:2]
    return int(h) * 60 + int(m)


def times_of_day(s):
    """Minutes after midnight when schedule `s` fires on one of its days."""
    if s.get("type") == "every":
        step = max(15, int(s.get("every") or 60))
        start, end = minutes(s.get("from") or "00:00"), minutes(s.get("to") or "23:59")
        return list(range(start, end + 1, step))
    return [minutes(s.get("time"))]


def latest_slot(s, now):
    """The most recent time at or before now when `s` was due (today or yesterday), or None."""
    days = set(s.get("days") or [])
    for back in (0, 1):
        d = (now - timedelta(days=back)).date()
        if (d.weekday() + 1) % 7 not in days:  # 0 = Sunday, like the app
            continue
        for m in sorted(times_of_day(s), reverse=True):
            t = datetime(d.year, d.month, d.day, m // 60, m % 60, tzinfo=TZ)
            if t <= now:
                return t
    return None


def due(doc, runs, reqs):
    """Slots due now for one vault, oldest first: (routine key, model, slot id, time)."""
    since = doc.get("schedules_updated")
    since = datetime.fromisoformat(since.replace("Z", "+00:00")) if since else None
    seen = {r.get("request") for r in runs.get("runs", [])} | {q.get("id") for q in reqs.get("requests", [])}
    out = {}
    for r in doc.get("routines", []):
        for s in r.get("schedules") or []:
            if s.get("paused"):
                continue
            t = latest_slot(s, NOW)
            if not t or NOW - t > WINDOW or (since and t < since):
                continue
            slot = f"sched:{r['key']}:{t.strftime('%Y-%m-%dT%H:%M')}"
            if slot in seen or slot in out:
                continue
            out[slot] = (r["key"], s.get("model") or "sonnet", slot, t)
    return sorted(out.values(), key=lambda x: x[3])


def main():
    if not TOKEN or not VAULTS:
        print("Scheduler is not set up (needs the SCHEDULER_TOKEN secret and VAULTS).")
        return 0
    failed = False
    for i, repo in enumerate(VAULTS, 1):
        try:
            doc = read_json(repo, "Feedback/routines.json", None)
            if not doc or doc.get("scheduler") != "on":
                print(f"vault {i}: scheduler off")
                continue
            slots = due(doc, read_json(repo, "Feedback/runs.json", {}), read_json(repo, "Feedback/run-requests.json", {}))
            if not slots:
                print(f"vault {i}: nothing due")
                continue
            # One dispatch per vault per check: the vault's workflow runs one job at a time and would drop a third
            # queued job, so the next slot waits for the next check.
            key, model, slot, _ = slots[0]
            if DRY:
                print(f"vault {i}: would start {key} ({model}); {len(slots) - 1} more waiting")
                continue
            api(f"/repos/{repo}/actions/workflows/run-routine.yml/dispatches",
                {"ref": "main", "inputs": {"routine": key, "model": model, "slot": slot}})
            print(f"vault {i}: started {key} ({model})" + (f"; {len(slots) - 1} more next check" if len(slots) > 1 else ""))
        except urllib.error.HTTPError as e:
            failed = True
            print(f"vault {i}: GitHub said {e.code}")
        except Exception as e:  # keep going for the other vaults
            failed = True
            print(f"vault {i}: {type(e).__name__}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
