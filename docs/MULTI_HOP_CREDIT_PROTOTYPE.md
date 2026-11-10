# Path-aware multi-hop credit prototype

## Purpose

A research-only, target-conditioned credit assignment prototype. It consumes a
detached snapshot and changes weights only on a temporary WASM candidate. It
does not modify the production core, live JavaScript graph, or local saves.

## Candidate rule

1. Enumerate simple input-to-output paths up to a configured depth and path
   count. A per-path visited-node set excludes cycles.
2. Keep paths whose every edge has a positive eligibility trace.
3. Score each path using the geometric mean of its edge traces multiplied by
   terminal output activation.
4. Normalize scores separately for the selected output and competing outputs.
5. Aggregate per-edge positive and competing credit. Their difference is the
   signed edge credit. A shared prefix used equally by both classes receives
   zero net credit and remains unchanged.
6. Apply bounded positive or negative deltas on a temporary WASM copy and
   return a manual-review-only proposal.

If path enumeration reaches its limit, the prototype fails closed and produces
no proposal from an incomplete route set.

## Test fixture

Two three-edge routes share their first edge. The test evaluates both label
orientations: whichever output is selected, its branch must strengthen, the
other branch must weaken, and the shared trunk must remain unchanged. It also
checks cycle avoidance, the path-count guard, weight bounds, and source
snapshot immutability.

## Limits

This is a heuristic prototype, not backpropagation and not a validated general
learning rule. Multiple overlapping routes, unequal route multiplicity,
deep graphs, noisy traces, saturation, and online credit assignment still
require broader stress testing. The module is not loaded into the application
UI and cannot automatically apply its proposals.

## Reproduction

The GitHub Actions workflow runs:
node tests/multi-hop-credit-prototype.test.mjs
