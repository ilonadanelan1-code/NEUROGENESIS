# Unequal-profile path-credit stress test

## Scope

A deterministic WASM-candidate stress fixture supplements the basic path-aware
prototype test. It contains three paths to one selected output and two paths
to distinct competing outputs. Every route shares the same first edge, while
branch weights, eligibility traces, hidden-node activity, and output activity
differ.

## Acceptance checks

- All three target routes receive positive edge updates.
- Both competing routes receive negative edge updates.
- The common first edge has zero net credit and is preserved.
- A disconnected edge is not included in the proposal.
- Actual candidate weights match the proposed weights; all weights remain
  bounded; source snapshot and edge counts are unchanged.
- Reversing synapse insertion order leaves the per-edge deltas unchanged.
- A path-count cap below the five active routes fails closed without a proposal.

This fixture is a deterministic profile stress test over a supplied snapshot.
It does not simulate online learning, and it does not establish convergence on
arbitrary graphs.
