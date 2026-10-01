"""Pine ストラテジーの日足ロジックを概算で再現する検証用スクリプト。"""

import json
import math
import argparse
from datetime import datetime, timezone


def ema(values, length):
    output = []
    previous = None
    alpha = 2 / (length + 1)
    for value in values:
        previous = value if previous is None else alpha * value + (1 - alpha) * previous
        output.append(previous)
    return output


def sma(values, length):
    return [None if i + 1 < length else sum(values[i + 1 - length : i + 1]) / length for i in range(len(values))]


def rma(values, length):
    output = []
    previous = None
    for i, value in enumerate(values):
        if value is None:
            output.append(None)
            continue
        if previous is None:
            window = values[max(0, i - length + 1) : i + 1]
            if len(window) < length or any(item is None for item in window):
                output.append(None)
                continue
            previous = sum(window) / length
        else:
            previous = (previous * (length - 1) + value) / length
        output.append(previous)
    return output


def rsi(closes, length):
    changes = [None] + [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = rma([None if x is None else max(x, 0) for x in changes], length)
    losses = rma([None if x is None else max(-x, 0) for x in changes], length)
    return [None if g is None else 100 if loss == 0 else 100 - 100 / (1 + g / loss) for g, loss in zip(gains, losses)]


def load_bars(path):
    with open(path, encoding="utf-8") as source:
        result = json.load(source)["chart"]["result"][0]
    quote = result["indicators"]["quote"][0]
    bars = []
    for i, stamp in enumerate(result["timestamp"]):
        fields = [quote[key][i] for key in ("open", "high", "low", "close", "volume")]
        if any(value is None for value in fields):
            continue
        bars.append((datetime.fromtimestamp(stamp, timezone.utc).date().isoformat(), *fields))
    return bars


def simulate(bars, min_price=10.0, min_average_volume=1000000.0):
    closes = [bar[4] for bar in bars]
    fast, medium, trend = ema(closes, 20), ema(closes, 50), ema(closes, 200)
    relative_strength = rsi(closes, 2)
    volumes = sma([bar[5] for bar in bars], 20)
    true_ranges = []
    for i, bar in enumerate(bars):
        high, low = bar[2], bar[3]
        previous_close = closes[i - 1] if i else closes[i]
        true_ranges.append(max(high - low, abs(high - previous_close), abs(low - previous_close)))
    atr = rma(true_ranges, 14)

    equity = 100000.0
    position = None
    pending = None
    trades = []
    for i, bar in enumerate(bars):
        date, open_price, high, low, close, _ = bar
        if pending is not None:
            if pending["side"] == "buy":
                fill = open_price + 0.01
                shares = math.floor(equity * 0.1 / bars[i - 1][4])
                if shares:
                    position = {"date": date, "bar": i, "entry": fill, "shares": shares, "stop": pending["stop"]}
                    equity -= shares * fill * 0.0005
            elif position is not None:
                fill = open_price - 0.01
                pnl = position["shares"] * (fill - position["entry"])
                fee = position["shares"] * fill * 0.0005
                equity += pnl - fee
                trades.append((position["date"], date, pnl - fee - position["shares"] * position["entry"] * 0.0005))
                position = None
            pending = None

        if position is not None and low <= position["stop"]:
            fill = max(0.01, min(open_price, position["stop"]) - 0.01)
            pnl = position["shares"] * (fill - position["entry"])
            fee = position["shares"] * fill * 0.0005
            equity += pnl - fee
            trades.append((position["date"], date, pnl - fee - position["shares"] * position["entry"] * 0.0005))
            position = None

        if i < 220 or relative_strength[i] is None or relative_strength[i - 1] is None or atr[i] is None:
            continue
        if position is None:
            uptrend = close > trend[i] and trend[i] > trend[i - 20] and fast[i] > medium[i]
            liquid = close >= min_price and volumes[i] is not None and volumes[i] >= min_average_volume
            pullback = close < fast[i] and relative_strength[i] <= 10 and relative_strength[i - 1] > 10
            if uptrend and liquid and pullback:
                pending = {"side": "buy", "stop": close - 2 * atr[i]}
        else:
            recovery = relative_strength[i] >= 70 or close >= fast[i]
            timed_out = i - position["bar"] >= 10
            broken_trend = close < trend[i]
            if recovery or timed_out or broken_trend:
                pending = {"side": "sell"}
    return trades


def report(trades, label):
    pnl = [trade[2] for trade in trades]
    wins = [value for value in pnl if value > 0]
    losses = [value for value in pnl if value < 0]
    gross_profit, gross_loss = sum(wins), -sum(losses)
    factor = gross_profit / gross_loss if gross_loss else float("inf")
    print(f"{label}: trades={len(pnl)} win_rate={len(wins) / len(pnl):.1%} net_pnl=${sum(pnl):,.2f} profit_factor={factor:.2f}" if pnl else f"{label}: trades=0")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data", help="Yahoo Finance chart API のJSONファイル")
    parser.add_argument("--min-price", type=float, default=10.0)
    parser.add_argument("--min-volume", type=float, default=1000000.0)
    args = parser.parse_args()
    bars = load_bars(args.data)
    trades = simulate(bars, args.min_price, args.min_volume)
    print(f"data={bars[0][0]}..{bars[-1][0]} bars={len(bars)}")
    print(f"filters: min_price=${args.min_price:g}, min_20d_average_volume={args.min_volume:g}")
    report(trades, "all")
    report([trade for trade in trades if trade[0] < "2024-01-01"], "entry before 2024")
    report([trade for trade in trades if trade[0] >= "2024-01-01"], "entry from 2024")
