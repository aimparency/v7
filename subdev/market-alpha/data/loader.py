import yfinance as yf
import pandas as pd
import os

CACHE_DIR = os.path.join(os.path.dirname(__file__), 'cache')
os.makedirs(CACHE_DIR, exist_ok=True)

def load_data(ticker="BTC-USD", period="1y", interval="1d"):
    cache_file = os.path.join(CACHE_DIR, f"{ticker}_{period}_{interval}.csv")
    
    if os.path.exists(cache_file):
        print(f"Loading {ticker} from cache...")
        df = pd.read_csv(cache_file)
        return df['Close'].values.tolist()
    
    print(f"Fetching {ticker} from Yahoo Finance...")
    ticker_obj = yf.Ticker(ticker)
    df = ticker_obj.history(period=period, interval=interval)
    
    if df.empty:
        raise ValueError(f"No data found for {ticker}")
        
    df.to_csv(cache_file)
    return df['Close'].values.tolist()

if __name__ == "__main__":
    prices = load_data()
    print(f"Loaded {len(prices)} prices. Last: {prices[-1]}")
