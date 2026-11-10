# Multi-hop hidden-route credit-assignment diagnostic

## Purpose

This diagnostic measures the current WebAssembly core on two parallel, two-edge
routes that share one sensory input:

- input -> target hidden node -> target output
- input -> competing hidden node -> competing output

The experiment uses disposable WASM brains created from a fixed snapshot. It
does not use the live application graph, change local saves, or alter the
production learning policy.

## What it measures

1. Whether local pairwise eligibility traces accumulate on both edges of both
   active routes.
2. Whether the current asymmetric contrastive API can update a two-hop route
   when no direct input-to-output edge exists.
3. Whether the generic reward API updates all eligible edges, including the
   competing route.
4. Whether reward events consume traces, weights remain finite and bounded,
   and every temporary WASM brain is disposed.

## Expected interpretation

The current core computes edge eligibility from local co-activation of the
source and target neurons. That is enough to retain traces along an active
multi-hop route. However, the current asymmetric contrastive API identifies
only two direct edges: input -> positive output and input -> negative output.
In a graph where both routes contain a hidden node, it therefore changes no
weights.

The generic reward API has the opposite limitation: it applies the same
reward sign to every eligible edge. When both routes are active, it strengthens
both routes for a positive reward. It cannot, by itself, assign credit only to
the route ending at the selected output.

This diagnostic intentionally records that limitation as a passing result.
It does not claim that multi-hop supervised credit assignment has been solved.

## Next engineering step

Prototype a target-conditioned, path-aware credit assignment rule on disposable
WASM candidates. The candidate must identify a bounded set of simple paths,
distribute credit to edges on the selected route, counter-credit competing
routes, and prove that unrelated edges and the authoritative JS graph remain
unchanged. Cycles, overlapping paths, route-depth limits, and eligibility
consumption require explicit tests before any UI or production integration.

## Reproduction

The GitHub Actions workflow runs:

node tests/multi-hop-credit-diagnostic.test.mjs

The JSON report is uploaded as the
neurogenesis-multi-hop-credit-diagnostic-v1 workflow artifact.
