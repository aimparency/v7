import type Database from 'better-sqlite3';
import { decodeVector, getCacheMeta, getDb, setCacheMeta, vectorsVersion } from './db.js';
import { EMBEDDING_DIMENSION, onVectorsChanged, type VectorChange } from './embeddings.js';
import { normalizeProjectPath } from './project-path.js';

// Semantic neighbours: for every idea its nearest ideas by embedding (cosine
// distance, 0 = same meaning). The autolayout draws them toward each other.
//
// Exact, so every pair has to be compared once: a full build is n²/2 dot
// products of unit vectors (n·log K bookkeeping, no sorting of whole rows).
// After that, one changed embedding costs one row (n dot products) plus a
// refill of the few lists that lost it. The lists are persisted in the cache
// database together with the vectors version they reflect; a different
// version (another process, a restart after missed updates) rebuilds.

export interface SemanticNeighbour {
  source: string;
  target: string;
  distance: number;
}

// More neighbours give the autolayout a steadier picture; cost stays linear.
export const NEAREST_NEIGHBOURS = 12;

type Neighbour = { id: string, distance: number };

interface SemanticIndex {
  version: number; // vectors version the lists reflect
  vectors: Map<string, Float64Array>; // unit length
  lists: Map<string, Neighbour[]>; // ascending distance, at most NEAREST_NEIGHBOURS
  links: SemanticNeighbour[] | null; // response built from the lists, until they change
}

const indexes = new Map<string, SemanticIndex>();

export async function getSemanticNeighbours(rawProjectPath: string): Promise<{ links: SemanticNeighbour[] }> {
  const index = loadIndex(normalizeProjectPath(rawProjectPath));
  index.links ??= [...index.lists].flatMap(([source, list]) => list.map(({ id, distance }) => ({ source, target: id, distance })));
  return { links: index.links };
}

// Vector writes of this process arrive here and update the lists in place.
onVectorsChanged(applyChange);

function loadIndex(projectPath: string): SemanticIndex {
  const db = getDb(projectPath);
  const version = vectorsVersion(db);
  const loaded = indexes.get(projectPath);
  if (loaded?.version === version) return loaded;

  const vectors = new Map<string, Float64Array>();
  for (const { id, vector } of db.prepare('SELECT id, vector FROM vectors').all() as { id: string, vector: Buffer }[]) {
    const unit = toUnit(decodeVector(vector));
    if (unit) vectors.set(id, unit);
  }
  const index: SemanticIndex = { version, vectors, lists: new Map(), links: null };
  if (!readLists(db, index)) {
    // Most pairs are rejected: compare against each idea's current worst
    // entry first and only touch its list for the rest.
    const ids = [...vectors.keys()];
    const rows = ids.map(id => vectors.get(id)!);
    const lists = ids.map(id => {
      const list: Neighbour[] = [];
      index.lists.set(id, list);
      return list;
    });
    const limit = new Float64Array(ids.length).fill(Infinity);
    const consider = (source: number, target: number, distance: number) => {
      if (distance >= limit[source]!) return;
      const list = lists[source]!;
      insertBounded(list, { id: ids[target]!, distance });
      if (list.length === NEAREST_NEIGHBOURS) limit[source] = list[NEAREST_NEIGHBOURS - 1]!.distance;
    };
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      for (let j = i + 1; j < rows.length; j++) {
        const distance = cosineDistance(row, rows[j]!);
        consider(i, j, distance);
        consider(j, i, distance);
      }
    }
    writeLists(db, index, vectors.keys(), true);
  }
  indexes.set(projectPath, index);
  return index;
}

function applyChange({ projectPath, changed, removed, version }: VectorChange) {
  const index = indexes.get(projectPath);
  if (!index) return; // nothing loaded: the next load sees the new version
  if (index.version !== version - 1) {
    indexes.delete(projectPath); // missed a change: rebuild on next load
    return;
  }

  const gone = new Set(removed);
  for (const [id, vector] of changed) {
    const unit = toUnit(vector);
    if (unit) index.vectors.set(id, unit);
    else gone.add(id);
  }
  for (const id of gone) {
    index.vectors.delete(id);
    index.lists.delete(id);
  }

  // Lists that held a changed or removed idea may now miss their true K-th
  // entry: recompute those rows whole, like the changed ideas' own rows.
  const touched = new Set([...changed.keys(), ...gone]);
  const refill = new Set<string>();
  for (const [source, list] of index.lists) {
    if (list.some(neighbour => touched.has(neighbour.id))) refill.add(source);
  }
  for (const id of changed.keys()) if (index.vectors.has(id)) refill.add(id);
  for (const source of refill) {
    const list: Neighbour[] = [];
    index.lists.set(source, list);
    const vector = index.vectors.get(source)!;
    for (const [other, otherVector] of index.vectors) {
      if (other !== source) insertBounded(list, { id: other, distance: cosineDistance(vector, otherVector) });
    }
  }
  // Every other list only needs an offer: a changed idea may now belong there.
  const rewrite = new Set([...refill, ...gone]);
  for (const id of changed.keys()) {
    const vector = index.vectors.get(id);
    if (!vector) continue;
    for (const [other, otherVector] of index.vectors) {
      if (other === id || refill.has(other)) continue;
      if (insertBounded(index.lists.get(other)!, { id, distance: cosineDistance(vector, otherVector) })) rewrite.add(other);
    }
  }

  index.version = version;
  index.links = null;
  writeLists(getDb(projectPath), index, rewrite, false);
}

// Keeps the list sorted and at most NEAREST_NEIGHBOURS long; true if it took the entry.
function insertBounded(list: Neighbour[], neighbour: Neighbour): boolean {
  if (list.length === NEAREST_NEIGHBOURS && neighbour.distance >= list[NEAREST_NEIGHBOURS - 1]!.distance) return false;
  let at = list.length;
  while (at > 0 && neighbour.distance < list[at - 1]!.distance) at--;
  list.splice(at, 0, neighbour);
  if (list.length > NEAREST_NEIGHBOURS) list.pop();
  return true;
}

// The hot loop of a full build. Four accumulators: ~15% faster in V8 than one,
// and EMBEDDING_DIMENSION is a multiple of four.
function cosineDistance(a: Float64Array, b: Float64Array): number {
  let dot0 = 0;
  let dot1 = 0;
  let dot2 = 0;
  let dot3 = 0;
  for (let i = 0; i < a.length; i += 4) {
    dot0 += a[i]! * b[i]!;
    dot1 += a[i + 1]! * b[i + 1]!;
    dot2 += a[i + 2]! * b[i + 2]!;
    dot3 += a[i + 3]! * b[i + 3]!;
  }
  return 1 - Math.max(-1, Math.min(1, dot0 + dot1 + dot2 + dot3));
}

// Other dimensions are leftovers of an older embedder, replaced by the backfill.
function toUnit(vector: Float32Array): Float64Array | null {
  if (vector.length !== EMBEDDING_DIMENSION) return null;
  let norm = 0;
  for (let i = 0; i < vector.length; i++) norm += vector[i]! * vector[i]!;
  if (norm === 0) return null;
  const scale = 1 / Math.sqrt(norm);
  const unit = new Float64Array(vector.length); // a plain loop: TypedArray.from with a map callback is ~10x slower
  for (let i = 0; i < vector.length; i++) unit[i] = vector[i]! * scale;
  return unit;
}

function readLists(db: Database.Database, index: SemanticIndex): boolean {
  if (getCacheMeta(db, 'neighbours_version') !== String(index.version) || getCacheMeta(db, 'neighbours_count') !== String(NEAREST_NEIGHBOURS)) return false;
  const rows = db.prepare('SELECT source, neighbours FROM semantic_neighbours').all() as { source: string, neighbours: string }[];
  if (rows.length !== index.vectors.size) return false;
  for (const { source, neighbours } of rows) {
    if (!index.vectors.has(source)) return false;
    index.lists.set(source, (JSON.parse(neighbours) as [string, number][]).map(([id, distance]) => ({ id, distance })));
  }
  return true;
}

function writeLists(db: Database.Database, index: SemanticIndex, sources: Iterable<string>, replaceAll: boolean) {
  const remove = db.prepare('DELETE FROM semantic_neighbours WHERE source = ?');
  const upsert = db.prepare('INSERT OR REPLACE INTO semantic_neighbours (source, neighbours) VALUES (?, ?)');
  db.transaction(() => {
    if (replaceAll) db.prepare('DELETE FROM semantic_neighbours').run();
    for (const source of sources) {
      const list = index.lists.get(source);
      if (list) upsert.run(source, JSON.stringify(list.map(({ id, distance }) => [id, distance])));
      else remove.run(source);
    }
    setCacheMeta(db, 'neighbours_version', String(index.version));
    setCacheMeta(db, 'neighbours_count', String(NEAREST_NEIGHBOURS));
  })();
}
