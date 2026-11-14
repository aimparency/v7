// What a connection dragged from one of this graph's ideas does where it is
// released. The idea the drag starts from is the one that benefits.
//   idea     → the idea under the cursor supports it (an ordinary connection)
//   graph    → a linked graph supports it: dropped on the graph's node, or
//              inside the outline of the graph opened in place
//   blocked  → an idea of a linked graph: a connection across the boundary
//              between graphs, which cannot be stored (the preview turns red);
//              also an idea whose file cannot be read
//   new      → empty space: a new supporting idea is created there

type DropNode = { id: string; isRepo?: boolean; linked?: boolean; unreadable?: string }

export type ConnectDrop =
  | { kind: 'idea'; ideaId: string }
  | { kind: 'graph'; repoId: string }
  | { kind: 'blocked' }
  | { kind: 'new' }

export function connectDrop(over: DropNode | undefined, insideGraph: string | undefined): ConnectDrop {
  if (!over) return insideGraph ? { kind: 'graph', repoId: insideGraph } : { kind: 'new' }
  if (over.linked || over.unreadable) return { kind: 'blocked' }
  if (over.isRepo) return { kind: 'graph', repoId: over.id }
  return { kind: 'idea', ideaId: over.id }
}
