# NEUROGENESIS — five-route order-isolation benchmark

## Purpose

Separate three order variables that were previously coupled under a single forward/reverse switch:

1. Initial single-feature learning traversal (feature and negative-output order).
2. The sequence of composition-learning tasks.
3. Replay traversal order (feature and negative-output order).

Fresh-association learning is held in the forward direction in every condition. This prevents its order from becoming a fourth confound while comparing retention.

## Protocol v1

- Five inputs, six outputs, five deterministic seeds.
- Three stress profiles: equal-medium (2/2/2/2/2), ascending (1/2/3/4/5), descending (5/4/3/2/1).
- Cleanup budget fixed at 56 one-edge corrections.
- Full 2×2×2 factorial across the three order variables: eight conditions per profile and seed, 120 disposable WASM brains total.
- Every scenario records 18 intermediate checkpoints: after composition training and after replay for each of three tasks in each of three cycles.
- Each checkpoint evaluates all five held-out four-of-five feature combinations across all 24 permutations.
- Each cleanup correction must weaken exactly one selected edge and consume eligibility traces.
- Every network is disposed after its scenario.

## Interpretation

The purpose is to identify which order variable first introduces held-out interference and whether order variables interact. It is not an attempt to increase the cleanup budget or change the live learning rule.

A protocol pass confirms completion and integrity, not scientific acceptance. Retention, plasticity headroom, fresh association learning and old-map retention after fresh learning remain separate measured outcomes.

The benchmark is disposable and does not modify the production network or user saves.
