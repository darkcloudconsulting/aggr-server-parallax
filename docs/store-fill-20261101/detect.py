import json, urllib.request, urllib.parse, collections, datetime, time
from aggrmap import MAP
st=collections.defaultdict(dict)
for l in open('store_1m.txt'):
    e,m,s,t,c,q=l.strip().split('|'); st[(e,m,s)][int(t)]=(int(c),float(q))
end=max(max(v) for v in st.values())
res={}
for mk,key in MAP.items():
    q=f"SELECT sum(cbuy)+sum(csell) AS c, sum(vbuy)+sum(vsell) AS v FROM aggr_1m.trades_1m WHERE market='{mk}' AND time >= '2026-10-14T00:00:00Z' AND time <= {end}s GROUP BY time(1m)"
    u="http://127.0.0.1:18086/query?"+urllib.parse.urlencode({"db":"aggr_parallax","q":q,"epoch":"s"})
    d=json.load(urllib.request.urlopen(u,timeout=120))['results'][0]
    ag={int(t):(c or 0,v or 0) for t,c,v in d['series'][0]['values']} if 'series' in d else {}
    s=st[key]; short=[]; tot_s=tot_a=0; vs=va=0
    for t,(c,qq) in s.items():
        a=ag.get(t,(0,0)); tot_s+=c; tot_a+=a[0]; vs+=qq; va+=a[1]
        if c-a[0] > max(3, 0.02*c): short.append((t,c-a[0]))
    res[mk]=short
    print(f"{mk:22s} store={tot_s:10d} aggr={tot_a:10d} ratio={tot_a/max(tot_s,1):.5f} vol_ratio={va/max(vs,1):.5f} short_minutes={len(short):4d} short_trades={sum(x[1] for x in short):8d}")
json.dump(res, open('short.json','w'))
