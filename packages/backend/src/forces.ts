import type Database from 'better-sqlite3';
import { decodeVector, getCacheMeta, getDb, setCacheMeta, vectorsVersion } from './db.js';
import { EMBEDDING_DIMENSION, onVectorsChanged, type VectorChange } from './embeddings.js';
import { normalizeProjectPath } from './project-path.js';

// Semantic neighbours: for every idea its nearest and furthest ideas by
// embedding (cosine distance, 0 = same meaning, 2 = opposite).
//
// Exact, so every pair has to be compared once: a full build is n²/2 dot
// products of unit vectors (n·log K bookkeeping, no sorting of whole rows).
// After that, one changed embedding costs one row (n dot products) plus a
// refill of the few lists that lost it. The lists are persisted in the cache
// database together with the vectors version they reflect; a different
// version (another process, a restart after missed updates) rebuilds.

interface SemanticLink {
  source: string;
  target: string;
  distance: number;
  type: 'nearest' | 'furthest';
}

interface SemanticGraph {
  links: SemanticLink[];
  averageDistance: number;
  lastUpdated: number;
}

// Nearest neighbours feed the autolayout's semantic attraction; more of them
// give it a steadier picture. Cost stays linear in the number of ideas.
export const NEAREST_NEIGHBOURS = 12;
export const FURTHEST_NEIGHBOURS = 3;
const LIST_CONFIG = `${NEAREST_NEIGHBOURS}/${FURTHEST_NEIGHBOURS}`;

type Neighbour = { id: string, distance: number };

interface SemanticIndex {
  version: number; // vectors version the lists reflect
  vectors: Map<string, Float64Array>; // unit length
  nearest: Map<string, Neighbour[]>; // ascending distance
  furthest: Map<string, Neighbour[]>; // descending distance
  graph: SemanticGraph | null; // response built from the lists, until they change
}

const indexes = new Map<string, SemanticIndex>();

export async function getSemanticGraph(rawProjectPath: string): Promise<SemanticGraph> {
  const index = loadIndex(normalizeProjectPath(rawProjectPath));
  index.graph ??= toGraph(index);
  return index.graph;
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
  const index: SemanticIndex = { version, vectors, nearest: new Map(), furthest: new Map(), graph: null };
  if (!readLists(db, index)) {
    for (const id of vectors.keys()) {
      index.nearest.set(id, []);
      index.furthest.set(id, []);
    }
    // Most pairs are rejected by both lists: compare against each idea's
    // current worst entries first and only touch the lists for the rest.
    const ids = [...vectors.keys()];
    const rows = ids.map(id => vectors.get(id)!);
    const nearestLimit = new Float64Array(ids.length).fill(Infinity);
    const furthestLimit = new Float64Array(ids.length).fill(-Infinity);
    const consider = (source: number, target: number, distance: number) => {
      if (distance >= nearestLimit[source]! && distance <= furthestLimit[source]!) return;
      const id = ids[source]!;
      offer(index, id, ids[target]!, distance);
      const nearest = index.nearest.get(id)!;
      const furthest = index.furthest.get(id)!;
      if (nearest.length === NEAREST_NEIGHBOURS) nearestLimit[source] = nearest[NEAREST_NEIGHBOURS - 1]!.distance;
      if (furthest.length === FURTHEST_NEIGHBOURS) furthestLimit[source] = furthest[FURTHEST_NEIGHBOURS - 1]!.distance;
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
    index.nearest.delete(id);
    index.furthest.delete(id);
  }

  // Lists that held a changed or removed idea may now miss their true K-th
  // entry: recompute those rows whole, like the changed ideas' own rows.
  const touched = new Set([...changed.keys(), ...gone]);
  const refill = new Set<string>();
  for (const lists of [index.nearest, index.furthest]) {
    for (const [source, list] of lists) {
      if (list.some(neighbour => touched.has(neighbour.id))) refill.add(source);
    }
  }
  for (const id of changed.keys()) if (index.vectors.has(id)) refill.add(id);
  for (const source of refill) {
    index.nearest.set(source, []);
    index.furthest.set(source, []);
    const vector = index.vectors.get(source)!;
    for (const [other, otherVector] of index.vectors) {
      if (other !== source) offer(index, source, other, cosineDistance(vector, otherVector));
    }
  }
  // Every other list only needs an offer: a changed idea may now belong there.
  const rewrite = new Set([...refill, ...gone]);
  for (const id of changed.keys()) {
    const vector = index.vectors.get(id);
    if (!vector) continue;
    for (const [other, otherVector] of index.vectors) {
      if (other === id || refill.has(other)) continue;
      if (offer(index, other, id, cosineDistance(vector, otherVector))) rewrite.add(other);
    }
  }

  index.version = version;
  index.graph = null;
  writeLists(getDb(projectPath), index, rewrite, false);
}

// Inserts into a source's bounded, sorted lists; true if either list took it.
function offer(index: SemanticIndex, source: string, target: string, distance: number): boolean {
  const near = insertBounded(index.nearest.get(source)!, NEAREST_NEIGHBOURS, { id: target, distance }, (a, b) => a < b);
  const far = insertBounded(index.furthest.get(source)!, FURTHEST_NEIGHBOURS, { id: target, distance }, (a, b) => a > b);
  return near || far;
}

function insertBounded(list: Neighbour[], capacity: number, neighbour: Neighbour, better: (a: number, b: number) => boolean): boolean {
  if (list.length === capacity && !better(neighbour.distance, list[capacity - 1]!.distance)) return false;
  let at = list.length;
  while (at > 0 && better(neighbour.distance, list[at - 1]!.distance)) at--;
  list.splice(at, 0, neighbour);
  if (list.length > capacity) list.pop();
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
  if (getCacheMeta(db, 'neighbours_version') !== String(index.version) || getCacheMeta(db, 'neighbours_config') !== LIST_CONFIG) return false;
  const rows = db.prepare('SELECT source, nearest, furthest FROM semantic_neighbours').all() as { source: string, nearest: string, furthest: string }[];
  if (rows.length !== index.vectors.size) return false;
  const parse = (json: string): Neighbour[] => (JSON.parse(json) as [string, number][]).map(([id, distance]) => ({ id, distance }));
  for (const { source, nearest, furthest } of rows) {
    if (!index.vectors.has(source)) return false;
    index.nearest.set(source, parse(nearest));
    index.furthest.set(source, parse(furthest));
  }
  return true;
}

function writeLists(db: Database.Database, index: SemanticIndex, sources: Iterable<string>, replaceAll: boolean) {
  const remove = db.prepare('DELETE FROM semantic_neighbours WHERE source = ?');
  const upsert = db.prepare('INSERT OR REPLACE INTO semantic_neighbours (source, nearest, furthest) VALUES (?, ?, ?)');
  const serialize = (list: Neighbour[]) => JSON.stringify(list.map(({ id, distance }) => [id, distance]));
  db.transaction(() => {
    if (replaceAll) db.prepare('DELETE FROM semantic_neighbours').run();
    for (const source of sources) {
      const nearest = index.nearest.get(source);
      if (nearest) upsert.run(source, serialize(nearest), serialize(index.furthest.get(source)!));
      else remove.run(source);
    }
    setCacheMeta(db, 'neighbours_version', String(index.version));
    setCacheMeta(db, 'neighbours_config', LIST_CONFIG);
  })();
}

function toGraph(index: SemanticIndex): SemanticGraph {
  const links: SemanticLink[] = [];
  for (const [source, list] of index.nearest) {
    for (const { id, distance } of list) links.push({ source, target: id, distance, type: 'nearest' });
  }
  for (const [source, list] of index.furthest) {
    for (const { id, distance } of list) links.push({ source, target: id, distance, type: 'furthest' });
  }
  const averageDistance = links.length > 0 ? links.reduce((sum, link) => sum + link.distance, 0) / links.length : 0;
  return { links, averageDistance, lastUpdated: Date.now() };
}
