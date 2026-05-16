# Contributing to Provenant

Thanks for stopping by. Provenant was built solo in 6 days for the 0G APAC Hackathon, but it's MIT-licensed and contributions are welcome.

## Ground rules

1. **Read `../00-GROUNDING.md`** in the parent folder first. It locks what Meru is (audit substrate for confidential AI inference) and what it isn't (not an identity product, not a decisioning engine).
2. **Follow the locked vocabulary** in `../00-GROUNDING.md` §8. No "cross-chain bridge" for the mirror, no "Sovereign AI" framing, no "trustless" overclaim.
3. **Pinned versions are not negotiable** — Solidity 0.8.20, OpenZeppelin 5.0.2 exact, ethers 5.7.2 exact in the backend 0G-SDK island only, npm not pnpm/bun.
4. **Security primitives are non-negotiable** — AES-256-GCM with CSPRNG IVs, ECDSA via OpenZeppelin, no hand-rolled crypto, no `Math.random()` for any security-sensitive value.

## Local setup

```bash
# Three independent packages — install each
cd contracts && npm install
cd ../backend && npm install
cd ../frontend && npm install
```

## Project structure

- `contracts/` — Hardhat workspace, Solidity 0.8.20, OpenZeppelin v5
- `backend/` — Express on Node 22, isolated `ethers@5.7.2` island for the 0G SDK
- `frontend/` — Next.js 16 + Tailwind 4 + viem + wagmi v2

## Pull-request checklist

- [ ] Read `../00-GROUNDING.md` §3 (what Provenant is NOT)
- [ ] No new dependency without pinning + integrity hash in `package-lock.json`
- [ ] No hardcoded secrets (env vars only)
- [ ] Solidity changes have Hardhat tests passing
- [ ] No `Math.random()`, no MD5/SHA-1/DES/ECB, no `eval`
- [ ] Inputs validated through Zod with `.strict()` on the backend
- [ ] Frontend never receives plaintext secrets

## Code style

- TypeScript strict mode throughout
- Prefer named exports
- Solidity: custom errors over revert strings
- Format with Prettier defaults; no bikeshedding

## Reporting security issues

Email the maintainer rather than opening a public issue.
