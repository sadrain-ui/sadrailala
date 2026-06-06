#!/usr/bin/env python3
"""Fetch and print the current Bitcoin price from a public API."""

import json
import urllib.request

API_URL = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"


def fetch_bitcoin_price() -> float:
    with urllib.request.urlopen(API_URL, timeout=10) as response:
        data = json.loads(response.read().decode())
    return data["bitcoin"]["usd"]


def main() -> None:
    price = fetch_bitcoin_price()
    print(f"Bitcoin (BTC): ${price:,.2f} USD")


if __name__ == "__main__":
    main()
