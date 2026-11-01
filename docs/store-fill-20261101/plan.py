import json, urllib.request, urllib.parse, collections, sys
rows=[l.strip().split('|') for l in open('fill.out') if l.count('|')==9]
store=collections.defaultdict(dict)
for mk,b,o,h,l,c,cb,cs,vb,vs in rows:
    store[mk][int(b)]=dict(open=float(o),high=float(h),low=float(l),close=float(c),cbuy=float(cb),csell=float(cs),vbuy=float(vb),vsell=float(vs))
pre={}; lines=[]; stats=collections.Counter(); added=collections.Counter()
for mk,bk in store.items():
    lo,hi=min(bk),max(bk)
    q=f"SELECT * FROM aggr_10s.trades_10s WHERE market='{mk}' AND time >= {lo}ms AND time <= {hi}ms"
    u="http://127.0.0.1:18086/query?"+urllib.parse.urlencode({"db":"aggr_parallax","q":q,"epoch":"ms"})
    d=json.load(urllib.request.urlopen(u,timeout=120))['results'][0]
    ag={}
    if 'series' in d:
        cols=d['series'][0]['columns']
        for v in d['series'][0]['values']:
            r=dict(zip(cols,v)); ag[r['time']]=r
    for b,s in bk.items():
        a=ag.get(b); ac=((a.get('cbuy') or 0)+(a.get('csell') or 0)) if a else 0; sc=s['cbuy']+s['csell']
        if sc < ac: stats['skip_store_fewer']+=1; continue
        if sc == ac: stats['skip_equal']+=1; continue
        stats['write']+=1; added[mk]+=sc-ac
        pre[f"{mk}|{b}"]=a
        f=",".join(f"{k}={v!r}" for k,v in s.items())
        tag=mk.replace(' ','\\ ').replace(',','\\,')
        lines.append("trades_10s,market=%s %s %d" % (tag, f, b))
print(dict(stats)); print("trades added:", sum(added.values())); 
for k,v in sorted(added.items()): print(f"  {k:22s} +{int(v)}")
json.dump(pre,open('preimage-aggr-10s.json','w')); open('fill.lp','w').write("\n".join(lines)+"\n")
