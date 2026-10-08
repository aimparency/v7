"""Idea graph as plain arrays, shared by every model in this directory.

Edges point from an idea to the ideas it builds on ("parent -> child"): value
flows along them top down, cost is aggregated against them bottom up.
"""
from __future__ import annotations

import glob
import json
import os
from dataclasses import dataclass

import networkx as nx
import numpy as np


@dataclass
class Graph:
    ids: list[str]
    intrinsic: np.ndarray    # value poured in from outside ("the root is worth 1000")
    cost: np.ndarray         # direct cost of realizing the idea itself
    self_weight: np.ndarray  # loopWeight: how much of its value the idea realizes itself
    edges: list[tuple[int, int, float]]  # (parent, child, weight)
    labels: list[str]

    @property
    def n(self) -> int:
        return len(self.ids)

    def index(self, name: str) -> int:
        return self.ids.index(name)

    def weights(self) -> np.ndarray:
        """W[p, c] = connection weight; self edges count as self weight."""
        W = np.zeros((self.n, self.n))
        for parent, child, weight in self.edges:
            if parent != child:
                W[parent, child] += weight
        return W

    def transitions(self) -> tuple[np.ndarray, np.ndarray]:
        """Q[x, y]: share of the value reaching x that x passes on to child y.
        keep[x]: share x keeps (realizes itself). Rows of Q plus keep sum to 1.
        An idea without children and without self weight keeps everything (a leaf)."""
        W = self.weights()
        self_w = self.self_weight.copy()
        for parent, child, weight in self.edges:
            if parent == child:
                self_w[parent] += weight
        total = W.sum(1) + self_w
        safe = np.where(total > 0, total, 1.0)
        keep = np.where(total > 0, self_w / safe, 1.0)
        return W / safe[:, None], keep

    def components(self) -> list[list[int]]:
        """Strongly connected components in topological order, parents first."""
        G = nx.DiGraph()
        G.add_nodes_from(range(self.n))
        G.add_edges_from((p, c) for p, c, w in self.edges if p != c and w > 0)
        condensed = nx.condensation(G)
        return [sorted(condensed.nodes[k]["members"]) for k in nx.topological_sort(condensed)]


def build(nodes: dict[str, dict], edges: list[tuple]) -> Graph:
    """nodes: {"A": {"i": 2, "c": 1, "s": 5}}; edges: [("A", "B", 5)] (weight defaults to 1).
    Defaults: intrinsic 0, cost 1, self weight 0."""
    ids = list(nodes)
    at = {name: k for k, name in enumerate(ids)}
    return Graph(
        ids=ids,
        intrinsic=np.array([float(nodes[k].get("i", 0)) for k in ids]),
        cost=np.array([float(nodes[k].get("c", 1)) for k in ids]),
        self_weight=np.array([float(nodes[k].get("s", 0)) for k in ids]),
        edges=[(at[e[0]], at[e[1]], float(e[2]) if len(e) > 2 else 1.0) for e in edges],
        labels=ids,
    )


def load_bowman(project: str) -> Graph:
    """Load a project's .bowman ideas the way the app does (archived ideas skipped,
    weight 0 read as 1 like `conn.weight || 1`, missing cost read as 1)."""
    raw = []
    for path in glob.glob(os.path.join(project, ".bowman", "ideas", "*.json")):
        with open(path) as f:
            idea = json.load(f)
        if not idea.get("archived"):
            raw.append(idea)
    at = {idea["id"]: k for k, idea in enumerate(raw)}
    edges = [
        (at[idea["id"]], at[conn["ideaId"]], float(conn.get("weight") or 1))
        for idea in raw
        for conn in idea.get("supportingConnections", [])
        if conn.get("ideaId") in at
    ]
    return Graph(
        ids=[idea["id"] for idea in raw],
        intrinsic=np.array([float(idea.get("intrinsicValue") or 0) for idea in raw]),
        cost=np.array([float(idea.get("cost") or 1) for idea in raw]),
        self_weight=np.array([float(idea.get("loopWeight") or 0) for idea in raw]),
        edges=edges,
        labels=[idea.get("text", "")[:50].replace("\n", " ") for idea in raw],
    )
