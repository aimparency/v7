"""Small graphs with hand-computed expectations. Each model in models.py is held
against all of them:  python3 examples.py

Node fields: i = intrinsic value, c = direct cost (default 1), s = self weight
(selfWeight, default 0). Edges: (idea, idea it builds on, weight = 1).

Expected quantities (see models.py): value, aggregated_value, aggregated_cost,
priority. An example only lists what it pins down.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from graph import build
from models import MODELS


@dataclass
class Example:
    name: str
    why: str
    nodes: dict
    edges: list
    expect: dict  # quantity -> {node: number}


EXAMPLES = [
    Example(
        "self weight splits value",
        "Felix's example. A (worth 2) does half the work itself (self weight 5) and "
        "hands the other half to B (weight 5).",
        {"A": dict(i=2, s=5), "B": {}},
        [("A", "B", 5)],
        dict(value=dict(A=1, B=1), aggregated_value=dict(A=2, B=1),
             aggregated_cost=dict(A=2, B=1), priority=dict(A=1, B=1)),
    ),
    Example(
        "pass-through chain",
        "R only exists through A, A only through B: all value is realized at B, "
        "but all three have the whole value at stake.",
        {"R": dict(i=1), "A": {}, "B": {}},
        [("R", "A"), ("A", "B")],
        dict(value=dict(R=0, A=0, B=1), aggregated_value=dict(R=1, A=1, B=1),
             aggregated_cost=dict(R=3, A=2, B=1), priority=dict(R=1 / 3, A=1 / 2, B=1)),
    ),
    Example(
        "weights split value",
        "R worth 3 builds on A (weight 1) and B (weight 2).",
        {"R": dict(i=3), "A": {}, "B": {}},
        [("R", "A", 1), ("R", "B", 2)],
        dict(value=dict(R=0, A=1, B=2), aggregated_value=dict(R=3, A=1, B=2),
             aggregated_cost=dict(R=3, A=1, B=1), priority=dict(R=1, A=1, B=2)),
    ),
    Example(
        "scale free",
        "Same as 'self weight splits value' with every weight ×10 and value ×1000: "
        "values scale by 1000, costs do not move.",
        {"A": dict(i=2000, s=50), "B": {}},
        [("A", "B", 50)],
        dict(value=dict(A=1000, B=1000), aggregated_value=dict(A=2000, B=1000),
             aggregated_cost=dict(A=2, B=1), priority=dict(A=1000, B=1000)),
    ),
    Example(
        "diamond shares its base",
        "C is needed by A and by B, which get equal value: each carries half of C's cost.",
        {"R": dict(i=4), "A": {}, "B": {}, "C": {}},
        [("R", "A"), ("R", "B"), ("A", "C"), ("B", "C")],
        dict(value=dict(R=0, A=0, B=0, C=4), aggregated_value=dict(R=4, A=2, B=2, C=4),
             aggregated_cost=dict(R=4, A=1.5, B=1.5, C=1), priority=dict(R=1, A=4 / 3, C=4)),
    ),
    Example(
        "unequal parents share by value",
        "C serves R1 (worth 3) and R2 (worth 1): R1 carries ¾ of C's cost "
        "(the Kunst case: shares follow value received, not connection count).",
        {"R1": dict(i=3), "R2": dict(i=1), "C": {}},
        [("R1", "C"), ("R2", "C")],
        dict(value=dict(C=4), aggregated_value=dict(R1=3, R2=1, C=4),
             aggregated_cost=dict(R1=1.75, R2=1.25, C=1), priority=dict(R1=3 / 1.75, R2=1 / 1.25, C=4)),
    ),
    Example(
        "intrinsic value below",
        "C is worth 2 by itself and gets 2 more from R: R carries half of C's cost.",
        {"R": dict(i=2), "C": dict(i=2)},
        [("R", "C")],
        dict(value=dict(R=0, C=4), aggregated_value=dict(R=2, C=4),
             aggregated_cost=dict(R=1.5, C=1), priority=dict(R=2 / 1.5, C=4)),
    ),
    Example(
        "leaky cycle",
        "A and B build on each other; B keeps half and hands half back to A. "
        "Value is realized once (at B) and nothing is counted twice. Half of A's "
        "value arrives via B, so B carries half of A's cost.",
        {"R": dict(i=1), "A": {}, "B": dict(s=1)},
        [("R", "A"), ("A", "B"), ("B", "A")],
        dict(value=dict(R=0, A=0, B=1), aggregated_value=dict(R=1, A=1, B=1),
             aggregated_cost=dict(R=3, A=2, B=1.5), priority=dict(R=1 / 3, A=1 / 2, B=2 / 3)),
    ),
    Example(
        "closed cycle",
        "A and B only build on each other and keep nothing: value entering never "
        "leaves. It must stay finite (shared by the cycle) and the pair acts as one idea.",
        {"R": dict(i=1), "A": {}, "B": {}},
        [("R", "A"), ("A", "B"), ("B", "A")],
        dict(value=dict(R=0, A=0.5, B=0.5), aggregated_value=dict(R=1, A=1, B=1),
             aggregated_cost=dict(R=3, A=2, B=2), priority=dict(R=1 / 3, A=1 / 2, B=1 / 2)),
    ),
    Example(
        "root with self weight",
        "R worth 3 does a third itself and passes a third each to A and B.",
        {"R": dict(i=3, s=1), "A": {}, "B": {}},
        [("R", "A"), ("R", "B")],
        dict(value=dict(R=1, A=1, B=1), aggregated_value=dict(R=3, A=1, B=1),
             aggregated_cost=dict(R=3, A=1, B=1), priority=dict(R=1, A=1, B=1)),
    ),
    Example(
        "cost aggregates as a mediant",
        "Expensive A and cheap B under R: R's priority lies between theirs.",
        {"R": dict(i=2, c=0.0001), "A": dict(c=9), "B": dict(c=1)},
        [("R", "A"), ("R", "B")],
        dict(aggregated_cost=dict(R=10.0001, A=9, B=1), priority=dict(R=2 / 10.0001, A=1 / 9, B=1)),
    ),
    Example(
        "unconnected idea",
        "No value reaches X: value and priority 0, cost is its own.",
        {"R": dict(i=1), "X": {}},
        [],
        dict(value=dict(R=1, X=0), aggregated_value=dict(X=0), aggregated_cost=dict(X=1), priority=dict(X=0)),
    ),
]


def check(model, example: Example) -> list[str]:
    g = build(example.nodes, example.edges)
    try:
        with np.errstate(all="ignore"):
            result = model(g)
    except Exception as error:  # a model may not handle a case at all
        return [f"crash: {type(error).__name__}: {error}"]
    failures = []
    for quantity, expected in example.expect.items():
        for node, want in expected.items():
            got = result[quantity][g.index(node)]
            if not np.isclose(got, want, rtol=1e-6, atol=1e-9):
                failures.append(f"{quantity}[{node}] = {got:.4g}, expected {want:.4g}")
    return failures


if __name__ == "__main__":
    width = max(len(e.name) for e in EXAMPLES)
    print(" " * width + "  " + "  ".join(f"{name:>15}" for name in MODELS))
    details = []
    for example in EXAMPLES:
        cells = []
        for name, model in MODELS.items():
            failures = check(model, example)
            cells.append(f"{'ok' if not failures else f'FAIL {len(failures)}':>15}")
            details += [f"{name:>15} | {example.name}: {f}" for f in failures]
        print(f"{example.name:<{width}}  " + "  ".join(cells))
    print()
    print("\n".join(details))
