# React Flow node identity preserves measurements

Read this before changing node reconciliation or replacing `useNodesState` ownership.

React Flow's `adoptUserNodes` reuses an internal node only when `userNode === internals.userNode`.
Recreating an unchanged user-node object misses that branch, so React Flow rebuilds its internal node;
the new object commonly has no `measured` dimensions and its `handleBounds` must be derived again.
Edges then lose initialized endpoints while the node is measured, which causes visible flicker.
Do not simplify reconciliation to remap every node: retain object identity for nodes whose projected
data and position did not change.
