"""Current vs proposed model on real projects.

  python3 real_data.py [project ...]   (default: this repo, ~/ideas, ~/projects/an-der-rax)
"""
from __future__ import annotations

import os
import sys
import time

import numpy as np
from scipy.stats import spearmanr

from graph import load_bowman
from models import current, flow_core, flow_reach

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PROJECTS = [os.path.dirname(HERE), os.path.expanduser("~/ideas"), os.path.expanduser("~/projects/an-der-rax")]


def report(project: str) -> None:
    g = load_bowman(project)
    if g.intrinsic.sum() == 0:
        print(f"{project}: no intrinsic value, skipped\n")
        return
    started = time.perf_counter()
    proposed = flow_reach(g)
    seconds = time.perf_counter() - started
    old = current(g)
    core = flow_core(g)
    components = g.components()
    cycles = [S for S in components if len(S) > 1]
    closed = [S for S in cycles if np.allclose(core["Q"][np.ix_(S, S)].sum(1), 1)]
    reached = proposed["aggregated_value"] > 0
    print(f"── {project}")
    print(f"{g.n} ideas, {len(g.edges)} connections, {int((g.intrinsic > 0).sum())} with intrinsic value, "
          f"{int((g.self_weight > 0).sum())} with self weight; {len(cycles)} cycles "
          f"(largest {max(map(len, cycles), default=0)}), {len(closed)} closed; "
          f"value reaches {int(reached.sum())}; proposed model {seconds * 1000:.0f} ms")
    rho = spearmanr(old["priority"][reached], proposed["priority"][reached]).statistic
    print(f"priority rank correlation current vs proposed (reached ideas): {rho:.2f}")
    share_current = old["value"].max() / g.intrinsic.sum()
    print(f"largest share of total value realized at one idea: current {share_current:.0%}, "
          f"proposed {proposed['value'].max() / g.intrinsic.sum():.0%}")

    rank_old = np.argsort(np.argsort(-old["priority"]))
    rank_new = np.argsort(np.argsort(-proposed["priority"]))
    print(f"\n{'top 12 by proposed priority':<52} {'prio':>8} {'value':>8} {'at stake':>8} {'cost':>6} {'old rank':>8}")
    for x in np.argsort(-proposed["priority"])[:12]:
        print(f"{g.labels[x]:<52} {proposed['priority'][x]:8.3g} {proposed['value'][x]:8.3g} "
              f"{proposed['aggregated_value'][x]:8.3g} {proposed['aggregated_cost'][x]:6.3g} {rank_old[x] + 1:8d}")
    print(f"\n{'top 8 by current priority':<52} {'new rank':>8}")
    for x in np.argsort(-old["priority"])[:8]:
        print(f"{g.labels[x]:<52} {rank_new[x] + 1:8d}")
    print()


if __name__ == "__main__":
    for project in sys.argv[1:] or DEFAULT_PROJECTS:
        report(project)
