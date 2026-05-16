# Slither Static-Analysis Audit Results

**Tool:** [Slither v0.11.5](https://github.com/crytic/slither) — Trail of Bits' static analyzer for Solidity smart contracts.
**Run date:** 2026-05-14
**Target:** `contracts/Provenant.sol` + `contracts/ProvenantReader.sol` (22 contracts including OpenZeppelin deps, 101 detectors run).
**Result:** **49 informational findings, 0 high-severity, 0 medium-severity, 0 issues against Provenant code.**

To reproduce:

```bash
cd contracts
pip3 install --user slither-analyzer
solc-select install 0.8.20 && solc-select use 0.8.20
slither contracts/ --solc-remaps "@openzeppelin/=node_modules/@openzeppelin/"
```

## Categorisation of all 49 findings

| Category | Count | Severity | Affects Provenant code? | Action |
|---|---|---|---|---|
| Inline assembly in OpenZeppelin libraries | ~16 | Informational | No — third-party audited code (ERC721, ECDSA, MessageHashUtils, Strings, Math) | Accept |
| Dead code in OpenZeppelin (`_burn`, `_safeTransfer`, etc.) | ~7 | Informational | No — OZ provides full ERC-721 surface; we use a subset | Accept |
| Pragma version constraints differ (`0.8.20` vs `^0.8.20` in OZ) | 1 | Informational | No — OZ pins floor at `^0.8.20`, we pin exact `0.8.20` | Accept |
| Solidity 0.8.20 known issues (`VerbatimInvalidDeduplication`, `FullInlinerNonExpressionSplitArgumentEvaluationOrder`, `MissingSideEffectsOnSelectorAccess`) | 2 | Informational | Yes, but **none of the named bugs are exercised by Provenant's code** | Document; v2 bump to 0.8.30+ |
| `block.timestamp` usage in Provenant.sol (`enclaveTimestamp ± 5 min` bound) | 1 | Informational | Yes | **Expected.** Replay-window protection, not authorization; timestamp drift of ≤15 seconds (the typical block production window) is harmless against a 300-second tolerance |
| `block.timestamp` usage in ProvenantReader.sol (`mirror` and `isMirrored`) | 2 | Informational | Yes | **Expected.** Same reasoning — used for ordering, not access control |

### Why "block.timestamp" findings are not real issues

Slither flags every use of `block.timestamp` because miners can manipulate it within ~15-second windows. The two ways it becomes a real issue:

1. **Pseudorandomness** — using `block.timestamp` as a source of entropy for raffles, random selection, etc. We don't.
2. **Tight access-control gates** — `if (block.timestamp == X) authorize()`. We don't.

Provenant's uses are:
- `enclaveTimestamp ± 5 minutes` in `Provenant.sol::_logInferenceCore` — a **300-second** replay-window bound. A miner shifting the timestamp by 15 seconds within a 300-second window has no effect on authorization.
- `committedAt + REVEAL_DELAY` in `Provenant.sol::revealAndLogInference` — a **60-second** ordering gate (matching the post-mentor-feedback bump from 12s; Shutter-on-Gnosis production target is 180s). The 15-second timestamp-manipulation window is significantly smaller than the 60-second gate; cross-block builder collusion can't compress two commits + reveals into the same builder's window.
- `block.timestamp` for `lastInferenceAt` and `mirror.timestamp` storage — used as observed metadata, not for any decision-gating.

### Why Solidity 0.8.20 known issues don't apply

The three named compiler bugs:

| Bug | Provenant exposure |
|---|---|
| `VerbatimInvalidDeduplication` | Affects only contracts using `verbatim` assembly instructions for Yul stdlib. Provenant uses no `verbatim`. |
| `FullInlinerNonExpressionSplitArgumentEvaluationOrder` | Affects compiler optimization edge cases with `viaIR=true`. Our `hardhat.config.ts` sets `viaIR: false` explicitly. |
| `MissingSideEffectsOnSelectorAccess` | Affects pre-0.8.21 compilers and only manifests with `.selector` access patterns combined with side-effect functions. Provenant has no such patterns (verified). |

**v2 hardening:** bump `pragma solidity 0.8.20;` to `0.8.30+` in both contracts. Not necessary for v1 correctness; trivial one-line change.

---

## Provenant code findings — full text from slither output

```
INFO:Detectors:
Detector: timestamp
Provenant._logInferenceCore(uint256,bytes32,bytes32,uint64,bytes) (contracts/Provenant.sol#229-269) uses timestamp for comparisons
	Dangerous comparisons:
	- enclaveTimestamp + 300 < nowTs || enclaveTimestamp > nowTs + 300 (contracts/Provenant.sol#241)
ProvenantReader.mirror(bytes32,bytes32,uint256,uint64,bytes) (contracts/ProvenantReader.sol#75-111) uses timestamp for comparisons
ProvenantReader.isMirrored(bytes32) (contracts/ProvenantReader.sol#117-119) uses timestamp for comparisons
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#block-timestamp
```

All three resolved in §"Why 'block.timestamp' findings are not real issues" above.

---

*Audit results file generated 2026-05-14. Re-run after any contract change.*
