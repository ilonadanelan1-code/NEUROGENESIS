# Connectivity-based neuron community layout

## Purpose
Group neurons by the structure of their synapse graph rather than merely
pushing nearby nodes apart. The operation changes display coordinates only.
Neuron IDs, directed synapses, weights, memory traces, and learning state stay
unchanged.

## Algorithm
1. Build a weighted undirected adjacency view from directed synapses. Either
   endpoint counts as a visual neighbor; original direction is preserved.
2. Detect communities with deterministic weighted modularity local moves.
   Dense internal ties count more than weak bridges.
3. Lay out each community separately. Internal edges attract endpoints while
   collision repulsion keeps nodes apart.
4. Place whole communities on a variable-radius ring. Radius is calculated
   from each group's actual extent; communities do not overlap. Groups with
   stronger links to already placed groups are ordered beside each other.
   Nodes themselves are not arranged in a grid.
5. Report group sizes, modularity, overlap count, and mean internal versus
   cross-community edge lengths.

## Expected behavior
- Dense subgraphs become compact visible groups.
- A few weak bridges do not collapse dense groups into one carpet.
- A strongly connected triangle remains one group. Each community receives a subtle color halo in the canvas, and the community membership is restored when the app reloads.
- Isolated neurons remain separate singleton groups.
- Repeated runs on the same graph produce identical coordinates.

## Limits
Community detection is a visual heuristic, not semantic understanding. A
highly interconnected graph may legitimately form one large community.


## Desktop and mobile viewport fitting

The canvas derives its transform from actual width and height. The shared viewport-fitting helper uses a 1.5% minimum zoom instead of the previous 12% floor and is tested against wide desktop, short desktop, and portrait phone viewports. When a grouped graph's canvas changes size, the view is fitted again without moving neurons.
