import type { Idea } from './types.js';
import { ANNUAL_DISCOUNT_RATE } from './constants.js';

export function discountValue(
  estimatedValue: number,
  durationDays: number,
  annualDiscountRate = ANNUAL_DISCOUNT_RATE
): number {
  if (!Number.isFinite(estimatedValue) || estimatedValue < 0) {
    throw new Error('Estimated value must be a finite, non-negative number');
  }
  if (!Number.isFinite(durationDays) || durationDays < 0) {
    throw new Error('Duration must be a finite number greater than or equal to 0 days');
  }
  if (!Number.isFinite(annualDiscountRate) || annualDiscountRate <= -1) {
    throw new Error('Annual discount rate must be finite and greater than -1');
  }
  return estimatedValue / Math.pow(1 + annualDiscountRate, durationDays / 365);
}

export function calculateProfitabilityIndex(
  discountedEstimatedValue: number,
  estimatedPresentCost: number
): number {
  if (!Number.isFinite(discountedEstimatedValue) || discountedEstimatedValue < 0) {
    throw new Error('Discounted estimated value must be finite and non-negative');
  }
  if (!Number.isFinite(estimatedPresentCost) || estimatedPresentCost <= 0) {
    throw new Error('Estimated present cost must be a finite number greater than 0');
  }
  return discountedEstimatedValue / estimatedPresentCost;
}

function validateEconomicInputs(ideas: Idea[]): void {
  for (const idea of ideas) {
    if (!Number.isFinite(idea.cost) || idea.cost <= 0) {
      throw new Error(`Idea "${idea.id}" has invalid cost: estimated direct cost must be a finite number greater than 0`);
    }
    const duration = idea.duration ?? 1;
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error(`Idea "${idea.id}" has invalid duration: days until return must be a finite number greater than or equal to 0`);
    }
    const intrinsicValue = idea.intrinsicValue ?? 0;
    if (!Number.isFinite(intrinsicValue) || intrinsicValue < 0) {
      throw new Error(`Idea "${idea.id}" has invalid intrinsic value: estimated direct value must be finite and non-negative`);
    }
  }
}

// Repo-level cross-repo links: a local idea's supportingRepos edge points at a
// WHOLE external repo (by repoId, no ideaId — see RepoConnectionSchema). For
// value flow we model each referenced repo as ONE zero-intrinsic LEAF SINK node
// (its id IS the repoId) and turn every repo edge into an ordinary
// supportingConnection into that node, so the existing flow machinery handles it
// on a single code path. A leaf realizes all of its inflow, so flow is EXPORTED
// out of the local graph into the sink; totalIntrinsic is unchanged (repo nodes
// carry intrinsic 0) and local ideas' realized values shrink by exactly the
// exported flow.
export function expandRepoSinkNodes(ideas: Idea[]): Idea[] {
  // Fast path: no repo edges ⇒ nothing to merge, return the array untouched.
  if (!ideas.some(a => a.supportingRepos && a.supportingRepos.length > 0)) {
    return ideas;
  }

  const localIds = new Set(ideas.map(a => a.id));
  const repoIds = new Set<string>();
  const expanded: Idea[] = [];

  for (const idea of ideas) {
    if (idea.supportingRepos && idea.supportingRepos.length > 0) {
      // Clone (don't mutate the caller's idea) and fold each repo edge into
      // supportingConnections, targeting the repo node whose id is the repoId.
      const repoConnections = idea.supportingRepos.map(r => {
        repoIds.add(r.repoId);
        return {
          ideaId: r.repoId,
          weight: r.weight ?? 1,
          relativePosition: (r.relativePosition ?? [0, 0]) as [number, number]
        };
      });
      expanded.push({
        ...idea,
        supportingConnections: [...(idea.supportingConnections ?? []), ...repoConnections]
      });
    } else {
      expanded.push(idea);
    }
  }

  // One leaf sink node per referenced repo. Skip a repoId that collides with a
  // real local idea id (already a node — don't shadow it).
  for (const repoId of repoIds) {
    if (!localIds.has(repoId)) {
      expanded.push(makeRepoSinkNode(repoId));
    }
  }

  return expanded;
}

function makeRepoSinkNode(repoId: string): Idea {
  return {
    id: repoId,
    text: `repo:${repoId}`,
    intrinsicValue: 0, // carries no intrinsic ⇒ keeps totalIntrinsic = local intrinsics
    cost: 0,           // the external repo's cost is not ours to aggregate
    duration: 1,
    costVariance: 0,
    valueVariance: 0,
    status: { state: 'open', comment: '', date: 0 },
    supportingConnections: [], // leaf ⇒ retains all inflow (the sink)
    supportingRepos: [],
    supportedIdeas: [],
    committedIn: [],
    tags: [],
    selfWeight: 0,
    archived: false
  } as Idea;
}


/**
 * Value flows top down, cost per unit of value is aggregated bottom up, both
 * along the same shares (derivation and checks: math/README.md).
 *
 * Every idea hands `weight / (selfWeight + Σ weights)` of the value reaching it
 * to each idea it builds on and realizes the rest, its self share, itself. A
 * leaf realizes everything. Intrinsic value is poured in where it is set.
 *
 *   top down    t = intrinsic + Σ_parents share · t_parent   value passing through
 *   bottom up   κ = cost / t + Σ_children share · κ_child     cost per unit of it
 *
 * values      aggregated value: what is at stake in an idea (t, with value that
 *             circles a cycle counted once). Normalized by totalIntrinsic.
 * realizedValues  self share · t: realized at the idea; sums to 1.
 * costs       aggregated cost κ · aggregated value: the idea's own cost plus
 *             its share of what it builds on, split by the value each parent sends.
 * priorities  aggregated value / aggregated cost = 1/κ (discounted by duration).
 *
 * Cycles are solved as one block. A closed cycle (nobody in it keeps anything,
 * no connection leaves it) holds whatever enters it, spread by its stationary
 * distribution, and acts as a single leaf. Ideas no value reaches get their
 * costs from the same calculation with value poured into their topmost ideas.
 */
export function calculateIdeaValues(inputIdeas: Idea[]): {
  values: Map<string, number>,
  realizedValues: Map<string, number>,
  totalIntrinsic: number,
  flowShares: Map<string, number>,
  flowValues: Map<string, number>,
  attributionShares: Map<string, number>,
  costs: Map<string, number>,
  doneCosts: Map<string, number>,
  priorities: Map<string, number>
} {
  validateEconomicInputs(inputIdeas);
  // Merge repo-link edges into zero-intrinsic leaf sink nodes before any
  // topology is built, so cross-repo flow runs on the same single code path.
  const ideas = expandRepoSinkNodes(inputIdeas);
  const graph = buildFlowGraph(ideas);
  const intrinsic = ideas.map(idea => idea.intrinsicValue ?? 0);
  const totalIntrinsic = intrinsic.reduce((sum, value) => sum + value, 0);
  const cost = ideas.map(idea => idea.cost ?? 0);
  const implemented = ideas.map(idea => idea.status.state === 'implemented');

  const flow = solveValueFlow(graph, intrinsic);
  const unitCost = solveUnitCosts(graph, flow, cost);
  const doneUnitCost = solveUnitCosts(graph, flow, cost, implemented, unitCost);

  // Unreached ideas carry no value to share costs by: pour value into the
  // topmost of them and share by connection weights alone.
  const unreached = flow.reach.map(reach => reach <= 0);
  let structural = { flow, unitCost, doneUnitCost };
  if (unreached.some(Boolean)) {
    const hasParent = graph.components.map(() => false);
    graph.children.forEach((edges, parent) => edges.forEach(({ child }) => {
      if (graph.componentOf[child] !== graph.componentOf[parent]) hasParent[graph.componentOf[child]!] = true;
    }));
    const poured = ideas.map((_, x) => unreached[x] && !hasParent[graph.componentOf[x]!] ? 1 : 0);
    const structuralFlow = solveValueFlow(graph, poured);
    const structuralUnitCost = solveUnitCosts(graph, structuralFlow, cost);
    structural = {
      flow: structuralFlow,
      unitCost: structuralUnitCost,
      doneUnitCost: solveUnitCosts(graph, structuralFlow, cost, implemented, structuralUnitCost)
    };
  }

  const normalize = (value: number) => totalIntrinsic > 0 ? value / totalIntrinsic : 0;
  const values = new Map<string, number>();
  const realizedValues = new Map<string, number>();
  const costs = new Map<string, number>();
  const doneCosts = new Map<string, number>();
  const priorities = new Map<string, number>();
  const flowShares = new Map<string, number>();
  const flowValues = new Map<string, number>();
  ideas.forEach((idea, x) => {
    values.set(idea.id, normalize(flow.reach[x]!));
    realizedValues.set(idea.id, normalize(flow.realized[x]!));
    const basis = unreached[x] ? structural : { flow, unitCost, doneUnitCost };
    const reach = basis.flow.reach[x]!;
    costs.set(idea.id, reach > 0 ? basis.unitCost[x]! * reach : cost[x]!);
    doneCosts.set(idea.id, reach > 0 ? basis.doneUnitCost[x]! * reach : implemented[x] ? cost[x]! : 0);
    // Synthetic repo sinks have zero cost and no meaningful ratio.
    priorities.set(idea.id, unreached[x] || unitCost[x]! <= 0
      ? 0
      : calculateProfitabilityIndex(discountValue(flow.reach[x]!, idea.duration ?? 1), costs.get(idea.id)!));
    graph.children[x]!.forEach(({ child, share }, k) => {
      const key = `${idea.id}->${ideas[child]!.id}`;
      flowShares.set(key, share);
      flowValues.set(key, normalize(flow.edgeFlows[x]![k]!));
    });
  });

  const attributionShares = calculateAttributionShares(ideas, graph, flow, structural.flow);
  return { values, realizedValues, totalIntrinsic, flowShares, flowValues, attributionShares, costs, doneCosts, priorities };
}

interface FlowGraph {
  /** Ideas each idea builds on, with the share of its value it hands them. */
  children: { child: number, share: number }[][];
  /** Share of the value reaching an idea that it realizes itself. */
  keep: number[];
  /** Strongly connected components, sinks first (Tarjan order). */
  components: number[][];
  componentOf: number[];
  /** Components that nobody in them leaves: value entering stays forever. */
  closed: boolean[];
}

function buildFlowGraph(ideas: Idea[]): FlowGraph {
  const indexOf = new Map(ideas.map((idea, x) => [idea.id, x]));
  const children: FlowGraph['children'] = [];
  const keep: number[] = [];
  for (const idea of ideas) {
    let selfWeight = idea.selfWeight ?? 0;
    const weights = new Map<number, number>();
    for (const connection of idea.supportingConnections ?? []) {
      const child = indexOf.get(connection.ideaId);
      if (child === undefined) continue;
      if (child === indexOf.get(idea.id)) selfWeight += connection.weight || 1;
      else weights.set(child, (weights.get(child) ?? 0) + (connection.weight || 1));
    }
    const total = selfWeight + [...weights.values()].reduce((sum, weight) => sum + weight, 0);
    keep.push(total > 0 ? selfWeight / total : 1);
    children.push([...weights].map(([child, weight]) => ({ child, share: weight / total })));
  }
  const components = stronglyConnectedComponents(children.map(edges => edges.map(edge => edge.child)));
  const componentOf: number[] = [];
  components.forEach((members, k) => members.forEach(x => { componentOf[x] = k; }));
  const closed = components.map((members, k) => members.length > 1 && members.every(x =>
    keep[x] === 0 && children[x]!.every(({ child }) => componentOf[child] === k)));
  return { children, keep, components, componentOf, closed };
}

interface ValueFlow {
  /** Value passing through each idea, per pass (finite stand-in in closed cycles). */
  through: number[];
  /** Value passing through each idea at least once: the aggregated value. */
  reach: number[];
  realized: number[];
  /** Value passed along each graph.children edge. */
  edgeFlows: number[][];
  /** Value entering each closed component. */
  closedMass: Map<number, number>;
}

function solveValueFlow(graph: FlowGraph, intrinsic: number[]): ValueFlow {
  const n = graph.keep.length;
  const inflow = [...intrinsic];
  const through = new Array<number>(n).fill(0);
  const reach = new Array<number>(n).fill(0);
  const realized = new Array<number>(n).fill(0);
  const closedMass = new Map<number, number>();
  // Parents before children: reverse Tarjan order.
  for (let k = graph.components.length - 1; k >= 0; k--) {
    const members = graph.components[k]!;
    if (members.length === 1) {
      const x = members[0]!;
      through[x] = reach[x] = inflow[x]!;
      realized[x] = graph.keep[x]! * inflow[x]!;
    } else if (graph.closed[k]) {
      const mass = members.reduce((sum, x) => sum + inflow[x]!, 0);
      const stationary = stationaryDistribution(graph, members);
      closedMass.set(k, mass);
      members.forEach((x, m) => {
        reach[x] = mass;
        realized[x] = through[x] = mass * stationary[m]!;
      });
    } else {
      // N = (I − Q)⁻¹ counts visits inside the cycle; reach divides out returns.
      const visits = invert(identityMinus(graph, members));
      members.forEach((x, j) => {
        through[x] = members.reduce((sum, y, i) => sum + inflow[y]! * visits[i]![j]!, 0);
        reach[x] = through[x]! / visits[j]![j]!;
        realized[x] = graph.keep[x]! * through[x]!;
      });
    }
    for (const x of members) {
      for (const { child, share } of graph.children[x]!) {
        if (graph.componentOf[child] !== k) inflow[child] = inflow[child]! + through[x]! * share;
      }
    }
  }
  const edgeFlows = graph.children.map((edges, x) => edges.map(({ share }) => through[x]! * share));
  return { through, reach, realized, edgeFlows, closedMass };
}

/**
 * κ = basis / t + Σ share · κ_child, children first. With `fixed`, the marked
 * ideas take `fixedValue` instead (done cost: an implemented idea counts its
 * whole aggregated cost as done). Unreached ideas get Infinity.
 */
function solveUnitCosts(
  graph: FlowGraph,
  flow: ValueFlow,
  cost: number[],
  fixed?: boolean[],
  fixedValue?: number[]
): number[] {
  const unit = new Array<number>(graph.keep.length).fill(Infinity);
  const basisOf = (x: number) => fixed ? 0 : cost[x]!;
  graph.components.forEach((members, k) => {
    if (graph.closed[k]) {
      const mass = flow.closedMass.get(k)!;
      const total = members.reduce((sum, x) => sum + (fixed?.[x] ? cost[x]! : basisOf(x)), 0);
      members.forEach(x => { unit[x] = mass > 0 ? total / mass : Infinity; });
      return;
    }
    if (flow.through[members[0]!]! <= 0) return;
    const outside = (x: number) => graph.children[x]!.reduce((sum, { child, share }) =>
      graph.componentOf[child] === k || !Number.isFinite(unit[child]!) ? sum : sum + share * unit[child]!, 0);
    const matrix = identityMinus(graph, members);
    const rhs = members.map((x, i) => {
      if (fixed?.[x]) {
        matrix[i] = members.map((_, j) => (i === j ? 1 : 0));
        return fixedValue![x]!;
      }
      return basisOf(x) / flow.through[x]! + outside(x);
    });
    solve(matrix, rhs).forEach((value, i) => { unit[members[i]!] = value; });
  });
  return unit;
}

/**
 * Share of each child's value that comes from each parent, keyed `${parentId}->${childId}`:
 * the parent's flow over everything entering the child (intrinsic value and all
 * parents' flows). Shares of all parents sum to 1, minus the part the child's own
 * intrinsic value accounts for. Unreached children are shared by connection weights.
 */
function calculateAttributionShares(
  ideas: Idea[],
  graph: FlowGraph,
  flow: ValueFlow,
  structuralFlow: ValueFlow
): Map<string, number> {
  const entering = ideas.map(idea => idea.intrinsicValue ?? 0);
  const structuralEntering = new Array<number>(ideas.length).fill(0);
  graph.children.forEach((edges, x) => edges.forEach(({ child }, k) => {
    entering[child] = entering[child]! + flow.edgeFlows[x]![k]!;
    structuralEntering[child] = structuralEntering[child]! + structuralFlow.edgeFlows[x]![k]!;
  }));
  const shares = new Map<string, number>();
  graph.children.forEach((edges, x) => edges.forEach(({ child }, k) => {
    const share = entering[child]! > 0
      ? flow.edgeFlows[x]![k]! / entering[child]!
      : structuralEntering[child]! > 0 ? structuralFlow.edgeFlows[x]![k]! / structuralEntering[child]! : 0;
    shares.set(`${ideas[x]!.id}->${ideas[child]!.id}`, share);
  }));
  return shares;
}

function stationaryDistribution(graph: FlowGraph, members: number[]): number[] {
  // πᵀ(I − Q) = 0 with Σπ = 1: transpose, and swap one equation for the sum.
  const matrix = identityMinus(graph, members);
  const transposed = members.map((_, i) => members.map((_, j) => matrix[j]![i]!));
  transposed[0] = members.map(() => 1);
  return solve(transposed, members.map((_, i) => (i === 0 ? 1 : 0)));
}

function identityMinus(graph: FlowGraph, members: number[]): number[][] {
  const position = new Map(members.map((x, i) => [x, i]));
  return members.map((x, i) => {
    const row = members.map((_, j): number => (i === j ? 1 : 0));
    for (const { child, share } of graph.children[x]!) {
      const j = position.get(child);
      if (j !== undefined) row[j] = row[j]! - share;
    }
    return row;
  });
}

/** Gaussian elimination with partial pivoting. Cycles are small, so dense is fine. */
function solve(matrix: number[][], rhs: number[]): number[] {
  const m = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < m; col++) {
    let pivot = col;
    for (let row = col + 1; row < m; row++) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    for (let row = col + 1; row < m; row++) {
      const factor = a[row]![col]! / a[col]![col]!;
      for (let k = col; k <= m; k++) a[row]![k] = a[row]![k]! - factor * a[col]![k]!;
    }
  }
  const x = new Array<number>(m).fill(0);
  for (let row = m - 1; row >= 0; row--) {
    let sum = a[row]![m]!;
    for (let k = row + 1; k < m; k++) sum -= a[row]![k]! * x[k]!;
    x[row] = sum / a[row]![row]!;
  }
  return x;
}

function invert(matrix: number[][]): number[][] {
  const columns = matrix.map((_, j) => solve(matrix, matrix.map((_, i) => (i === j ? 1 : 0))));
  return matrix.map((_, i) => columns.map(column => column[i]!));
}

/** Tarjan: components come out sinks first (a component after everything it reaches). */
function stronglyConnectedComponents(adjacency: number[][]): number[][] {
  let nextIndex = 0;
  const index: number[] = [];
  const lowLink: number[] = [];
  const stack: number[] = [];
  const onStack: boolean[] = [];
  const components: number[][] = [];
  const visit = (x: number): void => {
    index[x] = lowLink[x] = nextIndex++;
    stack.push(x);
    onStack[x] = true;
    for (const y of adjacency[x]!) {
      if (index[y] === undefined) {
        visit(y);
        lowLink[x] = Math.min(lowLink[x]!, lowLink[y]!);
      } else if (onStack[y]) {
        lowLink[x] = Math.min(lowLink[x]!, index[y]!);
      }
    }
    if (lowLink[x] !== index[x]) return;
    const component: number[] = [];
    let member: number;
    do {
      member = stack.pop()!;
      onStack[member] = false;
      component.push(member);
    } while (member !== x);
    components.push(component);
  };
  adjacency.forEach((_, x) => { if (index[x] === undefined) visit(x); });
  return components;
}
