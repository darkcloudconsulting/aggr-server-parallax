import json, urllib.request, urllib.parse, collections
def q(s):
    return json.load(urllib.request.urlopen("http://127.0.0.1:18086/query?"+urllib.parse.urlencode({"db":"aggr_parallax","q":s,"epoch":"s"}),timeout=120))['results'][0]
POD='2026-10-30T07:37:00Z'; A='2026-10-31T00:00:00Z'; B='2026-11-01T09:30:00Z'
mks=[v[1] for v in q('SHOW TAG VALUES FROM aggr_10s.trades_10s WITH KEY = "market"')['series'][0]['values']]
data={}
for mk in mks:
    r=q(f"SELECT sum(cbuy)+sum(csell) FROM aggr_1m.trades_1m WHERE market='{mk}' AND time >= '{POD}' AND time < '{B}'")
    life=(r['series'][0]['values'][0][1] or 0)/((47*60+53)) if 'series' in r else 0   # minutes 10-30 07:37 -> 11-01 09:30
    r=q(f"SELECT cbuy+csell FROM aggr_10s.trades_10s WHERE market='{mk}' AND time >= '{A}' AND time < '{B}'")
    ts=[v[0] for v in r['series'][0]['values']] if 'series' in r else []
    data[mk]=(life, ts)
api=lambda mk: mk.split(':')[0]
for k,floor in ((120,120),(240,180),(480,300),(900,300)):
    per=collections.Counter(); tot=0
    for mk,(avg,ts) in data.items():
        thr=min(3600,max(floor,k*60/max(avg,0.5)))
        n=sum(1 for a,b in zip(ts,ts[1:]) if b-a-10 > thr+60); per[api(mk)]+=n; tot+=n
    thr_btc={m:int(min(3600,max(floor,k*60/max(data[m][0],0.5)))) for m in ("BITGET:BTCUSDT","BYBIT:BTCUSDT-SPOT","HYPERLIQUID:BTC","BINANCE:btcusdt")}
    print(f"k={k:3d} floor {floor:3d}s: {tot:3d} reconnects in 33.5 quiet hours  by venue {dict(per.most_common(6))}\n      thresholds {thr_btc}")
