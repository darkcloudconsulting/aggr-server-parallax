#!/usr/bin/env python3
"""Render the versioned Snowgraf dashboard for the Parallax feed."""

import json
from pathlib import Path


SOURCE = {"type": "influxdb", "uid": "aggr-parallax-influxql"}
BIG = r"(?i)^(BINANCE_FUTURES:${asset}usdt|BYBIT:${asset}USDT|OKEX:${asset}-USDT-SWAP|BITGET:${asset}USDT|HYPERLIQUID:${asset})$"
LIQ = r"(?i)^(BINANCE_FUTURES:${asset}usdt|BYBIT:${asset}USDT|OKEX:${asset}-USDT-SWAP|BITGET:${asset}USDT)$"
FIVE = "aggr_5m.trades_5m"
MINUTE = "aggr_1m.trades_1m"


def target(query, alias=""):
    return {
        "datasource": SOURCE, "query": query, "rawQuery": True,
        "resultFormat": "time_series", "refId": "A", "alias": alias,
    }


def panel(number, title, kind, x, y, w, h, query, unit="short",
          description="", alias=""):
    return {
        "id": number, "title": title, "type": kind,
        "datasource": SOURCE, "targets": [target(query, alias)],
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "description": description,
        "fieldConfig": {"defaults": {"unit": unit, "decimals": 2}, "overrides": []},
        "options": {"legend": {"displayMode": "list", "placement": "bottom"},
                    "tooltip": {"mode": "multi"}} if kind == "timeseries"
        else {"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
              "orientation": "auto", "textMode": "auto", "colorMode": "value"},
    }


def main():
    perp = f"market =~ /{BIG}/"
    liq = f"market =~ /{LIQ}/"
    panels = [{
        "id": 1, "title": "Scope and freshness", "type": "text",
        "gridPos": {"x": 0, "y": 0, "w": 24, "h": 4},
        "options": {"mode": "markdown", "content":
            "**New Parallax history.** Choose BTC, ETH, or SOL above. Open interest is sampled every five minutes for Binance USDⓈ-M, Bybit linear, OKX USDT swap, and Hyperliquid. The USD-equivalent sum assumes USDT and USDC near $1; it is one-sided open interest, not long plus short. Trade panels use the five large linear perpetual markets, including Bitget. Liquidation panels use the four venues that publish liquidation events; they show *observed stream notional*, which can undercount exchange activity. Empty bars are not proof of an outage. [Data catalog](http://192.168.10.208:30084/) has market identities and retention."}
    }]
    panels.extend([
        panel(2, "Open interest · four venues", "stat", 0, 4, 6, 5,
              "SELECT notional_usd FROM aggr_5m.open_interest_total WHERE asset='${asset}' AND time > now() - 15m ORDER BY time DESC LIMIT 1",
              "currencyUSD", "Sum appears only when all four venue snapshots pass validation. Nominal USD-equivalent with stablecoins treated near $1."),
        *[panel(3 + i, f"Trade volume · last {window}", "stat", 6 * (i + 1), 4, 6, 5,
                f"SELECT SUM(vbuy)+SUM(vsell) FROM {MINUTE} WHERE {perp} AND time > now() - {window}",
                "currencyUSD", "Quote notional across five selected linear perpetual venues; no extrapolation before feed launch.")
          for i, window in enumerate(("5m", "1h", "24h"))],
        panel(6, "Open interest by venue · 5m", "timeseries", 0, 9, 12, 9,
              "SELECT LAST(notional_usd) FROM aggr_5m.open_interest WHERE asset='${asset}' AND $timeFilter GROUP BY time(5m),venue fill(null)",
              "currencyUSD", "Native open interest normalized to nominal USD equivalent at the venue mark or reported value.", "$tag_venue"),
        panel(7, "Open interest total · complete four-venue samples", "timeseries", 12, 9, 12, 9,
              "SELECT notional_usd FROM aggr_5m.open_interest_total WHERE asset='${asset}' AND $timeFilter",
              "currencyUSD", "No point is written when any selected venue is missing or stale."),
        panel(8, "Trade volume · 5m across five large perps", "timeseries", 0, 18, 12, 9,
              f"SELECT SUM(vbuy)+SUM(vsell) FROM {FIVE} WHERE {perp} AND $timeFilter GROUP BY time(5m) fill(null)",
              "currencyUSD", "Sum of taker buy and sell quote notional across Binance, Bybit, OKX, Bitget, and Hyperliquid."),
        panel(9, "Trade volume by venue · 5m", "timeseries", 12, 18, 12, 9,
              f"SELECT SUM(vbuy)+SUM(vsell) FROM {FIVE} WHERE {perp} AND $timeFilter GROUP BY time(5m),market fill(null)",
              "currencyUSD", "Same five perps, split by exact market ID.", "$tag_market"),
        panel(10, "Mean reported liquidation notional per venue · 5m", "timeseries", 0, 27, 12, 9,
              f"SELECT (SUM(lbuy)+SUM(lsell))/4 FROM {FIVE} WHERE {liq} AND $timeFilter GROUP BY time(5m) fill(0)",
              "currencyUSD", "Observed liquidation stream notional divided by four configured reporting venues. Missing venue bars can understate it; inspect coverage."),
        panel(11, "Observed liquidation per $1m traded · 5m", "timeseries", 12, 27, 12, 9,
              f"SELECT 1000000*(SUM(lbuy)+SUM(lsell))/(SUM(vbuy)+SUM(vsell)) FROM {FIVE} WHERE {liq} AND $timeFilter GROUP BY time(5m) fill(0)",
              "currencyUSD", "Ratio uses the same four reporting venues in numerator and denominator; it is a reported-stream intensity signal."),
        panel(12, "Liquidation venue bar coverage · expected 4", "timeseries", 0, 36, 8, 7,
              f"SELECT COUNT(close) FROM {FIVE} WHERE {liq} AND $timeFilter GROUP BY time(5m) fill(0)",
              "short", "A value below four means at least one configured reporting venue has no trade bar in this window."),
        panel(13, "Taker buy share · volume weighted", "timeseries", 8, 36, 8, 7,
              f"SELECT 100*SUM(vbuy)/(SUM(vbuy)+SUM(vsell)) FROM {FIVE} WHERE {perp} AND $timeFilter GROUP BY time(5m) fill(null)",
              "percent", "Buy-side quote notional divided by all trade notional across five large perps; this is naturally weighted by turnover."),
        panel(14, "Composite close proxy · volume weighted", "timeseries", 16, 36, 8, 7,
              f"SELECT SUM(pxv)/SUM(vol) FROM (SELECT close*(vbuy+vsell) AS pxv, vbuy+vsell AS vol FROM {FIVE} WHERE {perp} AND $timeFilter) GROUP BY time(5m) fill(none)",
              "currencyUSD", "Five-minute venue closes weighted by their five-minute quote turnover. This is a close proxy, not execution VWAP."),
        {"id": 15, "title": "Next analyses", "type": "text",
         "gridPos": {"x": 0, "y": 43, "w": 24, "h": 5},
         "options": {"mode": "markdown", "content":
             "**Useful once history accumulates:** (1) compare changes in four-venue open interest with the composite close proxy to distinguish new-position buildup from closing; (2) compare liquidation intensity with taker buy share, keeping venue coverage visible; (3) watch the spread between each venue close and the volume-weighted close proxy as an execution-quality signal. These are exploratory signals, not certified trade-level VWAP or complete liquidation totals."}},
    ])
    dashboard = {
        "uid": "aggr-parallax-feed", "title": "Aggr Parallax — BTC / ETH / SOL feed",
        "tags": ["aggr-server", "parallax", "market-data"],
        "description": "Parallel BTC, ETH, SOL feed; trade, liquidation and four-venue open interest views.",
        "timezone": "browser", "refresh": "1m", "schemaVersion": 42,
        "time": {"from": "now-6h", "to": "now"},
        "templating": {"list": [{"name": "asset", "label": "Asset", "type": "custom",
                                  "query": "BTC,ETH,SOL", "current": {"text": "BTC", "value": "BTC"},
                                  "options": [{"text": x, "value": x, "selected": x == "BTC"}
                                              for x in ("BTC", "ETH", "SOL")],
                                  "multi": False, "includeAll": False}]},
        "panels": panels,
    }
    path = Path(__file__).with_name("grafana-feed-dashboard.json")
    path.write_text(json.dumps(dashboard, indent=2, ensure_ascii=False) + "\n")
    print(path)


if __name__ == "__main__":
    main()
