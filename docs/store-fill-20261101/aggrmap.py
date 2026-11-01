MAP={}
for ex,mk,sfx in (("BITGET","futures",""),("BITGET","spot","-SPOT"),("BYBIT","futures",""),("BYBIT","spot","-SPOT")):
    for a in ("BTC","ETH","SOL"): MAP[f"{ex}:{a}USDT{sfx}"]=(ex.lower(),mk,f"{a}USDT")
for a in ("BTC","ETH","SOL"):
    MAP[f"HYPERLIQUID:{a}"]=("hyperliquid","futures",f"{a}USD")
    MAP[f"BINANCE:{a.lower()}usdt"]=("binance","spot",f"{a}USDT")
    MAP[f"COINBASE:{a}-USD"]=("coinbase","spot",f"{a}USD")
    MAP[f"KRAKEN:{'XBT' if a=='BTC' else a}/USD"]=("kraken","spot",f"{a}USD")
    MAP[f"KRAKEN:PF_{'XBT' if a=='BTC' else a}USD"]=("kraken","futures",f"{a}USD")
