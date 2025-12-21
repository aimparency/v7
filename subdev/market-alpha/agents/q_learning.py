import random

class QLearningAgent:
    def __init__(self, actions=[0, 1, 2], alpha=0.2, gamma=0.95):
        self.q_table = {}
        self.actions = actions
        self.alpha = alpha
        self.gamma = gamma
        self.history = []
        self.sma_window = 5 # Shorter window for faster reaction

    def calculate_rsi(self, prices, window=14):
        if len(prices) < window + 1: return 50
        
        # Calculate changes
        deltas = []
        for i in range(len(prices) - window, len(prices)):
            deltas.append(prices[i] - prices[i-1])
            
        gains = [d for d in deltas if d > 0]
        losses = [-d for d in deltas if d < 0]
        
        if not gains: return 0
        if not losses: return 100
        
        avg_gain = sum(gains) / window
        avg_loss = sum(losses) / window
        
        rs = avg_gain / avg_loss
        return 100 - (100 / (1 + rs))

    def get_state(self, obs):
        price = obs['price']
        
        # 1. Trend (SMA)
        if len(self.history) < self.sma_window:
            trend = 0
        else:
            sma = sum(self.history[-self.sma_window:]) / self.sma_window
            # Trend bins: -1 (below SMA), 1 (above SMA)
            trend = 1 if price > sma else -1
            
        # 2. RSI
        rsi = self.calculate_rsi(self.history)
        if rsi < 30: rsi_bin = 0 # Oversold
        elif rsi > 70: rsi_bin = 2 # Overbought
        else: rsi_bin = 1
            
        # 3. Holding bins
        total = obs['portfolio_value']
        held = obs['shares'] * price
        ratio = held / total if total > 0 else 0
        
        if ratio < 0.1: h = 0
        elif ratio < 0.9: h = 1
        else: h = 2
        
        return (trend, rsi_bin, h)

    def act(self, obs, epsilon=0.0):
        # Note: history update must be handled by caller before act()
        
        state = self.get_state(obs)
        
        if random.random() < epsilon:
            return random.choice(self.actions)
            
        qs = [self.q_table.get((state, a), 0.0) for a in self.actions]
        max_q = max(qs)
        # Random tie-breaking
        best_actions = [a for a, q in zip(self.actions, qs) if q == max_q]
        return random.choice(best_actions)

    def update_history(self, price):
        self.history.append(price)

    def learn(self, obs, action, reward, next_obs):
        state = self.get_state(obs)
        
        # For next state, we need to peek at history with next price
        self.history.append(next_obs['price'])
        next_state = self.get_state(next_obs)
        self.history.pop() 
        
        cur_q = self.q_table.get((state, action), 0.0)
        max_next_q = max([self.q_table.get((next_state, a), 0.0) for a in self.actions])
        
        new_q = cur_q + self.alpha * (reward + self.gamma * max_next_q - cur_q)
        self.q_table[(state, action)] = new_q
        
    def reset(self):
        self.history = []
