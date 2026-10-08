"""Candidate value / cost / priority models.

Every model returns the same four per-idea quantities, so examples.py can hold
them all against the same expectations:

  value            value realized *at* the idea (conserved: sums to total intrinsic)
  aggregated_value value at stake in the idea: everything that is realized through it
  aggregated_cost  cost of realizing the idea, its share of what it builds on included
  priority         aggregated_value / aggregated_cost
"""
from __future__ import annotations

import networkx as nx
import numpy as np

from graph import Graph

Result = dict[str, np.ndarray]


# ── current: the TypeScript implementation (packages/shared/src/value-calculation.ts) ──

def current(g: Graph) -> Result:
    """Pour intrinsic each step, pass everything along (self weight as a self loop,
    leaves loop onto themselves), normalize. Replicates the TS loop, including its
    convergence threshold and its attribution-share cost roll-up."""
    Q, keep = g.transitions()
    P = Q + np.diag(keep)
    total = g.intrinsic.sum()
    poured = g.intrinsic / total
    v = poured.copy()
    for _ in range(100):
        nxt = poured + P.T @ v
        nxt /= nxt.sum()
        done = np.abs(nxt - v).max() < 0.001 / g.n
        v = nxt
        if done:
            break
    flows = v[:, None] * Q  # pre-normalization scale, as the TS records them
    inputs = poured + flows.sum(0)
    shares = np.where(inputs > 1e-12, flows / np.where(inputs > 1e-12, inputs, 1), 0)
    for child in np.where(inputs <= 1e-12)[0]:  # no value signal: parents share equally
        parents = Q[:, child] > 0
        if parents.any():
            shares[parents, child] = 1 / parents.sum()
    cost = _collapsed_cost(g, shares)
    value = v * total
    return dict(value=value, aggregated_value=value, aggregated_cost=cost, priority=value / cost)


def current_closed_form(g: Graph) -> np.ndarray:
    """Normalizing after pouring 100% is exactly a ½ restart: Σ(poured + Pᵀv) = 2, so
    the fixed point is v = ½·poured + ½·Pᵀv  (personalized PageRank, damping ½)."""
    Q, keep = g.transitions()
    P = Q + np.diag(keep)
    poured = g.intrinsic / g.intrinsic.sum()
    return np.linalg.solve(np.eye(g.n) - 0.5 * P.T, 0.5 * poured) * g.intrinsic.sum()


def _collapsed_cost(g: Graph, shares: np.ndarray) -> np.ndarray:
    """TS distributeCostsStable: cycles collapsed to one node, its total split by direct cost."""
    components = _components_of(shares > 0)
    of = {m: k for k, members in enumerate(components) for m in members}
    total = np.zeros(len(components))
    for k in reversed(range(len(components))):  # children first
        members = components[k]
        total[k] = g.cost[members].sum()
        for p in members:
            for c in np.where(shares[p] > 0)[0]:
                if of[c] != k:
                    total[k] += shares[p, c] * total[of[c]]
    out = np.zeros(g.n)
    for k, members in enumerate(components):
        basis = g.cost[members]
        out[members] = total[k] * (basis / basis.sum() if basis.sum() > 0 else 1 / len(members))
    return out


def _components_of(adjacency: np.ndarray) -> list[list[int]]:
    G = nx.DiGraph(adjacency.astype(int))
    condensed = nx.condensation(G)
    return [sorted(condensed.nodes[k]["members"]) for k in nx.topological_sort(condensed)]


# ── flow: value as an absorbing Markov chain, cost per unit value as its dual ──

def flow_core(g: Graph) -> Result:
    """Two linear passes over the same matrix Q, solved component by component.

    Top down (value):        t = i + Qᵀ t      t = value passing through each idea
    Bottom up (unit cost):   κ = c / t + Q κ   κ = cost per unit of that value

    Self weight is absorption: the share an idea keeps is realized there and
    leaves the chain (value = keep · t). A *closed* cycle (no member keeps
    anything, no edge leaves it) is an absorbing class: whatever enters it stays,
    spread by the cycle's stationary distribution, and it behaves as one leaf.
    """
    Q, keep = g.transitions()
    n = g.n
    t = np.zeros(n)           # throughput (∞ inside closed cycles)
    reach = np.zeros(n)       # value that passes the idea at least once
    value = np.zeros(n)
    inflow = g.intrinsic.copy()
    components = g.components()
    closed_mass: dict[int, float] = {}
    for k, S in enumerate(components):
        QS = Q[np.ix_(S, S)]
        b = inflow[S]
        outside = np.setdiff1d(np.arange(n), S)
        if len(S) > 1 and np.allclose(QS.sum(1), 1):
            mass = b.sum()
            closed_mass[k] = mass
            t[S] = np.inf if mass > 0 else 0
            reach[S] = mass
            value[S] = mass * _stationary(QS)
            continue
        N = np.linalg.inv(np.eye(len(S)) - QS)  # expected visits inside the component
        tS = N.T @ b
        t[S] = tS
        reach[S] = tS / np.diag(N)  # visits / visits-per-first-visit
        value[S] = keep[S] * tS
        inflow[outside] += Q[np.ix_(S, outside)].T @ tS

    kappa = np.zeros(n)
    for k in reversed(range(len(components))):
        S = components[k]
        outside = np.setdiff1d(np.arange(n), S)
        if k in closed_mass:
            kappa[S] = g.cost[S].sum() / closed_mass[k] if closed_mass[k] > 0 else np.inf
            continue
        below = Q[np.ix_(S, outside)] @ np.where(np.isfinite(kappa[outside]), kappa[outside], 0)
        with np.errstate(divide="ignore"):
            unit = np.where(t[S] > 0, g.cost[S] / np.where(t[S] > 0, t[S], 1), np.inf)
        kS = np.linalg.solve(np.eye(len(S)) - Q[np.ix_(S, S)], np.where(np.isfinite(unit), unit, 0) + below)
        kappa[S] = np.where(t[S] > 0, kS, np.inf)
    return dict(t=t, reach=reach, value=value, kappa=kappa, Q=Q, keep=keep)


def _stationary(QS: np.ndarray) -> np.ndarray:
    m = len(QS)
    A = np.vstack([QS.T - np.eye(m), np.ones(m)])
    return np.linalg.lstsq(A, np.r_[np.zeros(m), 1], rcond=None)[0]


def flow_reach(g: Graph) -> Result:
    """Proposed. Aggregated value = reach (bounded by total intrinsic, cycles counted
    once); aggregated cost = κ · reach; priority = 1/κ (cycle correction cancels)."""
    r = flow_core(g)
    with np.errstate(invalid="ignore"):
        cost = np.where(r["reach"] > 0, r["kappa"] * r["reach"], full_requirement_cost(g))
    return dict(value=r["value"], aggregated_value=r["reach"], aggregated_cost=cost,
                priority=np.where(np.isfinite(r["kappa"]), 1 / r["kappa"], 0))


def flow_throughput(g: Graph) -> Result:
    """Same chain without the cycle correction: aggregated value = throughput t,
    which counts value circling a cycle every time it passes."""
    r = flow_core(g)
    with np.errstate(invalid="ignore"):
        cost = np.where(r["t"] > 0, r["kappa"] * r["t"], full_requirement_cost(g))
    return dict(value=r["value"], aggregated_value=r["t"], aggregated_cost=cost,
                priority=np.where(np.isfinite(r["kappa"]), 1 / r["kappa"], 0))


def flow_full_requirement(g: Graph) -> Result:
    """Same value as flow_reach, but cost = everything reachable below, counted in
    full for every idea that builds on it (no sharing of common sub-ideas)."""
    r = flow_core(g)
    cost = full_requirement_cost(g)
    return dict(value=r["value"], aggregated_value=r["reach"], aggregated_cost=cost,
                priority=r["reach"] / cost)


def full_requirement_cost(g: Graph) -> np.ndarray:
    """Own cost plus the cost of everything reachable below, nothing shared.
    Also the cost of ideas no value reaches (there is nothing to share by)."""
    G = nx.DiGraph((g.weights() > 0).astype(int))
    return np.array([g.cost[list(nx.descendants(G, x) | {x})].sum() for x in range(g.n)])


MODELS = {
    "current": current,
    "flow+reach": flow_reach,
    "flow+throughput": flow_throughput,
    "flow+full-cost": flow_full_requirement,
}
