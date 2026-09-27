export type Point = { x: number; y: number };
type NodeChangeLike = { type: string; id?: string; position?: Point; dragging?: boolean };

// A drag reports every frame with `dragging: true`; the settled position arrives with `dragging: false`,
// once at drag end and once per arrow-key step, for every node that moved, not only the one grabbed.
export function settledMoves(changes: readonly NodeChangeLike[]): { id: string; position: Point }[] {
  return changes.flatMap(change => change.type === 'position' && change.dragging === false && change.id && change.position ? [{ id: change.id, position: { x: change.position.x, y: change.position.y } }] : []);
}

// Holding an arrow key settles a position per step. One request per node at a time, always carrying the
// newest position, keeps a slow earlier step from landing last and leaving the server behind the screen.
// `unconfirmed` is the canvas's record of positions the server has not echoed yet; it is read at call time.
export function latestMoveSender(send: (id: string, position: Point) => Promise<boolean>, unconfirmed: { readonly current: Map<string, Point> }) {
  const sending = new Set<string>();
  return async (id: string, position: Point) => {
    unconfirmed.current.set(id, position);
    if (sending.has(id)) return;
    sending.add(id);
    try {
      for (let next = position; ;) {
        if (!await send(id, next)) { unconfirmed.current.delete(id); return; }
        const newest = unconfirmed.current.get(id);
        if (!newest || newest === next) return;
        next = newest;
      }
    } finally { sending.delete(id); }
  };
}
