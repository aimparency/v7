class MovingAverageAgent:
    def __init__(self, short_window=5, long_window=15):
        self.short_window = short_window
        self.long_window = long_window
        self.history = []

    def act(self, obs):
        price = obs['price']
        self.history.append(price)
        
        if len(self.history) < self.long_window:
            return 0

        short_avg = sum(self.history[-self.short_window:]) / self.short_window
        long_avg = sum(self.history[-self.long_window:]) / self.long_window
        
        # Trend following
        if short_avg > long_avg:
            # Uptrend -> Buy if we have cash
            if obs['balance'] >= price:
                return 1
        elif short_avg < long_avg:
            # Downtrend -> Sell if we have shares
            if obs['shares'] > 0:
                return 2
                
        return 0
