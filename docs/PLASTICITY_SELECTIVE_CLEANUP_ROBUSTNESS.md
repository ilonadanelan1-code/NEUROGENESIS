# NEUROGENESIS — selective cleanup seed robustness

**Protocol:** version 1  
**Candidate under test:** one replay sweep plus at most two event-triggered cross-route corrections  
**Runtime:** disposable C++/WebAssembly brains only  
**Production JavaScript network:** unchanged  
**User saves/live state:** never loaded or modified

## 1. Research question

The first selective-cleanup experiment passed all four original seed/order scenarios with a maximum budget of two corrections per brain. This follow-up asks whether the same fixed strategy generalizes to a wider set of initial feature-to-output mappings.

## 2. Fixed protocol

The benchmark reuses the same network topology, training schedule, homeostatic composition update, one bounded-asymmetric replay sweep, leakage-ranking procedure, and zero-positive / full-negative correction update. It does not tune rates or thresholds.

Ten deterministic seeds are used: 7, 17, 29, 43, 59, 73, 97, 127, 101, and 211. Each seed runs in both existing task orders (forward and reverse), for 20 independent disposable WASM brains.

The cleanup budget remains fixed at two episodes per brain. All 11 held-out combinations and all 60 input-stimulation permutations are measured. The same output activation, headroom, weight-bounds, fresh-feature-transfer, and old-after-fresh criteria remain in force.

## 3. Measurements and safeguards

The machine-readable report records every seed/order scenario, initial and final leakage, expected activation, selected cross-route edges, before/after weights, cleanup count, fresh-feature transfer, and total episode count.

The CI test requires all 20 scenarios to complete; both task orders to be represented for every seed; no brain to exceed the two-episode budget; each correction to change exactly one selected edge; all eligibility traces to be consumed; all weights to remain finite and bounded; and all 20 brains to be disposed.

The report separately records how many scenarios meet the full retention and transfer acceptance criteria. A scientifically unsuccessful candidate is reported as a measured failure rather than hidden by relaxed thresholds.

## 4. Status

Results are pending the first successful workflow run. The original four-scenario suite remains the mandatory regression gate. No production network or user save data is changed by either benchmark.
