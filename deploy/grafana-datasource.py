#!/usr/bin/env python3
"""Idempotently register Parallax's InfluxQL datasource in Snowgraf."""

import base64
import json
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


GRAFANA = "http://192.168.10.208:32161"
CONFIG = json.loads(Path(__file__).with_name("grafana-datasource.json").read_text())


def admin_header():
    raw = subprocess.check_output([
        "kubectl", "-n", "monitor", "get", "secret", "snowgraf-grafana", "-o", "json"
    ])
    secret = json.loads(raw)["data"]
    user = base64.b64decode(secret["admin-user"])
    password = base64.b64decode(secret["admin-password"])
    return "Basic " + base64.b64encode(user + b":" + password).decode()


AUTH = admin_header()


def request(path, method="GET", payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    headers = {"Authorization": AUTH}
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(GRAFANA + path, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)


def main():
    uid = CONFIG["uid"]
    path = "/api/datasources/uid/" + urllib.parse.quote(uid)
    try:
        existing = request(path)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        existing = None
    if existing is None:
        request("/api/datasources", "POST", CONFIG)
        print("created", uid)
    else:
        for key in ("name", "type", "access", "url", "database", "isDefault", "jsonData"):
            if existing.get(key) != CONFIG[key]:
                raise SystemExit(f"Existing datasource {uid} differs at {key}; inspect before changing it")
        print("unchanged", uid)

    live = request(path)
    assert live["uid"] == uid and live["jsonData"]["dbName"] == "aggr_parallax"
    query = urllib.parse.urlencode({"db": "aggr_parallax", "q": "SHOW RETENTION POLICIES ON aggr_parallax"})
    result = request(f"/api/datasources/proxy/uid/{uid}/query?{query}")
    policies = result["results"][0]["series"][0]["values"]
    assert len(policies) == 13, f"Expected 12 project policies plus autogen; got {len(policies)}"
    print("proxy_query_ok", len(policies), "retention_policies")
    bars = urllib.parse.urlencode({
        "db": "aggr_parallax",
        "q": "SELECT LAST(cbuy) FROM aggr_1m.trades_1m WHERE market='BINANCE:btcusdt'",
    })
    latest = request(f"/api/datasources/proxy/uid/{uid}/query?{bars}")
    assert latest["results"][0].get("series"), "No Parallax BTC bars through Grafana"
    print("proxy_bar_query_ok", "BINANCE:btcusdt", "aggr_1m")


if __name__ == "__main__":
    main()
