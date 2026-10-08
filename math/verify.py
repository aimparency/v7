"""Brute-force checks of the claims in README.md on random graphs with cycles.

  python3 verify.py
"""
from __future__ import annotations

import numpy as np

from graph import Graph
from models import current, current_closed_form, flow_core, flow_reach

rng = np.random.default_rng(7)


def random_graph(n: int, edge_probability: float) -> Graph:
    W = (rng.random((n, n)) < edge_probability) * rng.integers(1, 5, (n, n))
    np.fill_diagonal(W, 0)
    self_weight = rng.integers(0, 3, n) + 0.5  # every idea keeps something: no closed cycles
    intrinsic = np.where(rng.random(n) < 0.3, rng.integers(1, 100, n), 0).astype(float)
    intrinsic[0] = 100
    edges = [(p, c, float(W[p, c])) for p, c in zip(*np.nonzero(W))]
    return Graph([str(k) for k in range(n)], intrinsic, rng.integers(1, 10, n).astype(float),
                 self_weight, edges, [str(k) for k in range(n)])


def hitting(P: np.ndarray, target: int) -> np.ndarray:
    """h[y] = probability a walk on substochastic P started at y ever visits target."""
    n = len(P)
    A = np.eye(n) - P
    A[target] = 0
    A[target, target] = 1
    rhs = np.zeros(n)
    rhs[target] = 1
    return np.linalg.solve(A, rhs)


def check(name: str, ok: bool) -> None:
    print(f"{'ok  ' if ok else 'FAIL'}  {name}")
    if not ok:
        raise SystemExit(1)


graphs = [random_graph(int(rng.integers(5, 40)), float(rng.uniform(0.03, 0.2))) for _ in range(200)]
cyclic = sum(any(len(S) > 1 for S in g.components()) for g in graphs)
print(f"{len(graphs)} random graphs, {cyclic} with cycles\n")

check("current: the pour-and-normalize loop equals the ½-restart fixed point v = ½·i + ½·Pᵀv",
      all(np.allclose(current(g)["value"], current_closed_form(g), rtol=1e-2, atol=1e-2 * g.intrinsic.sum() / g.n)
          for g in graphs))

worst = 0.0
for g in graphs:
    r = flow_core(g)
    total = g.intrinsic.sum()
    # value is conserved and reach is bounded
    assert np.isclose(r["value"].sum(), total), "value not conserved"
    assert (r["reach"] <= total * (1 + 1e-9)).all(), "reach exceeds total"
    # reach = Σ_y i_y · P(walk from y visits X): value counted once per idea
    for x in range(g.n):
        assert np.isclose(r["reach"][x], g.intrinsic @ hitting(r["Q"], x)), "reach is not first-passage value"
    # aggregated cost κ·reach = Σ_y c_y · P(cost walk from y visits X), where the cost
    # walk goes from an idea to a parent with the share of its value that parent sent
    # (the time reversal of the value walk) and leaves at its own intrinsic value
    reached = r["t"] > 0
    t = np.where(reached, r["t"], 1)
    up = (r["Q"] * r["t"][:, None]).T / t[:, None]
    up[~reached] = 0
    cost = flow_reach(g)["aggregated_cost"]
    for x in np.where(reached)[0]:
        brute = g.cost[reached] @ hitting(up, x)[reached]
        worst = max(worst, abs(cost[x] - brute) / brute)
check("flow: value is conserved, reach ≤ total, reach = first-passage value", True)
check(f"flow: κ·reach equals brute-force cost attribution up the reversed chain (worst rel. error {worst:.1e})",
      worst < 1e-8)

# priority is a mediant: π_X = (kept + Σ flow_ch) / (c_X + Σ flow_ch·κ_ch) lies between
# X's own kept-value/cost and its children's priorities, so aggregation never invents priority
ok = True
for g in graphs:
    r, priority = flow_core(g), flow_reach(g)["priority"]
    in_cycle = {x for S in g.components() if len(S) > 1 for x in S}
    for x in set(np.nonzero(r["t"])[0]) - in_cycle:
        parts = [r["keep"][x] * r["t"][x] / g.cost[x]] + [priority[c] for c in np.nonzero(r["Q"][x])[0]]
        ok &= min(parts) * (1 - 1e-9) <= priority[x] <= max(parts) * (1 + 1e-9)
check("flow: an idea's priority lies between its own kept-value/cost and its children's priorities", ok)

# closed cycles: the solver result is the limit of letting the cycle keep ε
def with_closed_cycle(g: Graph) -> Graph:
    """Turn a few ideas into a ring that keeps nothing and has no way out."""
    ring = [int(x) for x in rng.choice(np.arange(1, g.n), size=int(rng.integers(2, 5)), replace=False)]
    edges = [e for e in g.edges if e[0] not in ring]
    edges += [(a, b, float(rng.integers(1, 4))) for a, b in zip(ring, ring[1:] + ring[:1])]
    edges += [(0, ring[0], 1.0)]  # value reaches it
    self_weight = g.self_weight.copy()
    self_weight[ring] = 0
    return Graph(g.ids, g.intrinsic, g.cost, self_weight, edges, g.labels)


closed = [with_closed_cycle(random_graph(int(rng.integers(6, 30)), float(rng.uniform(0.05, 0.2)))) for _ in range(100)]
worst = 0.0
for g in closed:
    exact = flow_reach(g)
    leaky = Graph(g.ids, g.intrinsic, g.cost, g.self_weight + 1e-7, g.edges, g.labels)
    approx = flow_reach(leaky)
    for key in ("value", "aggregated_value", "priority"):
        a, b = exact[key], approx[key]
        worst = max(worst, np.max(np.abs(a - b) / np.maximum(np.abs(a), 1e-6)))
check(f"flow: {len(closed)} graphs with closed cycles match their ε-leak limit (worst rel. error {worst:.1e})",
      worst < 1e-3)
