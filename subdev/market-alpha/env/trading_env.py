import json
import os
import random
import math

class TradingEnv:
    def __init__(self, initial_balance=10000.0, length=100, data=None, wallet_path=None):
        self.initial_balance = initial_balance
        self.wallet_path = wallet_path
        
        if data:
            self.prices = data
            self.length = len(data) - 1
        else:
            self.length = length
            # Fixed seed for reproducibility across restarts
            random.seed(42)
            self.prices = []
            base_price = 100.0
            for t in range(length * 2):
                trend = t * 0.1
                seasonality = 10 * math.sin(t * 0.2)
                noise = random.uniform(-2, 2)
                self.prices.append(base_price + trend + seasonality + noise)

        self.reset()

    def reset(self):
        self.balance = self.initial_balance
        self.shares = 0
        self.current_step = 0
        
        if self.wallet_path:
            self.load_wallet()

        self.max_steps = self.length
        
        return self._get_obs()

    def load_wallet(self):
        if self.wallet_path and os.path.exists(self.wallet_path):
            try:
                with open(self.wallet_path, 'r') as f:
                    data = json.load(f)
                    self.balance = data.get('balance', self.initial_balance)
                    self.shares = data.get('shares', 0)
                    self.current_step = data.get('last_update', 0)
            except Exception as e:
                print(f"Error loading wallet: {e}")

    def save_wallet(self):
        if self.wallet_path:
            try:
                with open(self.wallet_path, 'w') as f:
                    json.dump({
                        'balance': self.balance,
                        'shares': self.shares,
                        'last_update': self.current_step
                    }, f, indent=2)
            except Exception as e:
                print(f"Error saving wallet: {e}")

    def _get_obs(self):
        current_price = self.prices[self.current_step]
        return {
            "price": current_price,
            "balance": self.balance,
            "shares": self.shares,
            "portfolio_value": self.balance + (self.shares * current_price)
        }

    def step(self, action):
        current_price = self.prices[self.current_step]
        prev_portfolio_value = self.balance + (self.shares * current_price)
        
        info = {"action": ["Hold", "Buy", "Sell"][action]}

        if action == 1: # Buy
            if self.balance >= current_price:
                self.balance -= current_price
                self.shares += 1
            else:
                info["msg"] = "Insufficient funds"
        
        elif action == 2: # Sell
            if self.shares > 0:
                self.balance += current_price
                self.shares -= 1
            else:
                info["msg"] = "No shares to sell"

        self.current_step += 1
        done = self.current_step >= self.max_steps
        
        # Next state
        next_price = self.prices[self.current_step] if not done else current_price
        new_portfolio_value = self.balance + (self.shares * next_price)
        
        reward = new_portfolio_value - prev_portfolio_value
        
        if self.wallet_path:
            self.save_wallet()

        return self._get_obs(), reward, done, info

    def render(self):
        obs = self._get_obs()
        print(f"\033[H\033[J") # Clear screen
        print(f"Step: {self.current_step} | Price: {obs['price']:.2f} | Value: {obs['portfolio_value']:.2f} | Cash: {obs['balance']:.2f} | Shares: {obs['shares']}")
        
        # Render Chart
        window = 60
        start = max(0, self.current_step - window)
        history = self.prices[start:self.current_step+1]
        
        if not history: return

        min_p = min(history)
        max_p = max(history)
        height = 10
        
        # Avoid division by zero
        if max_p == min_p: max_p += 1
        
        print("-" * (len(history) + 2))
        for h in range(height, -1, -1):
            line = "|"
            for p in history:
                # Normalized position 0..height
                pos = int(((p - min_p) / (max_p - min_p)) * height)
                line += "•" if pos == h else " "
            print(line + "|")
        print("-" * (len(history) + 2))
