import random
import os
import json
from env.trading_env import TradingEnv

def run_step():
    wallet_path = os.path.join(os.path.dirname(__filename__ if "__filename__" in locals() else "."), "wallet.json")
    env = TradingEnv(initial_balance=10000.0, length=1000, wallet_path=wallet_path) # Longer length for simulation
    
    # Environment automatically loads state in __init__ -> reset -> load_wallet
    
    # Take one step
    # Simple Logic: Random Buy/Sell/Hold
    action = random.choice([0, 1, 2])
    
    obs, reward, done, info = env.step(action)
    
    print(f"Step: {env.current_step} | Action: {info['action']} | Price: {obs['price']:.2f} | Value: {obs['portfolio_value']:.2f}")
    
    if done:
        print("Market cycle complete.")

if __name__ == "__main__":
    run_step()
