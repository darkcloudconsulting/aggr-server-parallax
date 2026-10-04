#!/usr/bin/env python3
"""Create or update the versioned Aggr Parallax feed dashboard in Snowgraf."""

import base64
import json
import subprocess
import urllib.error
import urllib.request
from pathlib import Path


GRAFANA = "http://192.168.10.208:32161"
FOLDER_UID = "aggr-parallax-feed"
DASHBOARD = json.loads(Path(__file__).with_name("grafana-feed-dashboard.json").read_text())


def authorization():
    raw = subprocess.check_output([
        "kubectl", "-n", "monitor", "get", "secret", "snowgraf-grafana", "-o", "json"
    ])
    secret = json.loads(raw)["data"]
    user = base64.b64decode(secret["admin-user"])
    password = base64.b64decode(secret["admin-password"])
    return "Basic " + base64.b64encode(user + b":" + password).decode()


AUTH = authorization()


def request(path, method="GET", payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    headers = {"Authorization": AUTH}
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(GRAFANA + path, data=body, headers=headers,
                                 method=method)
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)


def maybe(path):
    try:
        return request(path)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def main():
    folder = maybe("/api/folders/" + FOLDER_UID)
    if folder is None:
        folder = request("/api/folders", "POST", {
            "uid": FOLDER_UID, "title": "Aggr Parallax Feed"
        })
    assert folder["uid"] == FOLDER_UID

    uid = DASHBOARD["uid"]
    existing = maybe("/api/dashboards/uid/" + uid)
    model = dict(DASHBOARD)
    if existing:
        if existing["dashboard"]["title"] != model["title"]:
            raise SystemExit(f"Unexpected dashboard already uses UID {uid}")
        model["id"] = existing["dashboard"]["id"]
        model["version"] = existing["dashboard"]["version"]
    result = request("/api/dashboards/db", "POST", {
        "dashboard": model, "folderUid": FOLDER_UID,
        "overwrite": bool(existing), "message": "Versioned Parallax feed dashboard",
    })
    live = request("/api/dashboards/uid/" + uid)
    assert live["dashboard"]["uid"] == uid
    assert len(live["dashboard"]["panels"]) == len(model["panels"])
    assert live["meta"]["folderUid"] == FOLDER_UID
    print(GRAFANA + result["url"], len(model["panels"]), "panels")


if __name__ == "__main__":
    main()
