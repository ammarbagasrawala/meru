/**
 * Provenant.sol + ProvenantReader.sol — offline Hardhat tests.
 * These do NOT require 0G mainnet access. They run on the local Hardhat network.
 *
 * Run:
 *   npx hardhat test
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Provenant, ProvenantReader } from "../typechain-types";

const FIVE_MINUTES = 5 * 60;

describe("Provenant", () => {
  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let teeSigner: HardhatEthersSigner; // simulated enclave wallet
  let contract: Provenant;

  beforeEach(async () => {
    [owner, user, teeSigner] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("Provenant");
    contract = (await factory.deploy()) as unknown as Provenant;
    await contract.waitForDeployment();
  });

  async function signInferenceDigest(
    signer: HardhatEthersSigner,
    contractAddress: string,
    tokenId: bigint,
    questionHash: string,
    bundleHash: string,
    enclaveTimestamp: number,
    chainId: bigint
  ): Promise<string> {
    const innerBytes = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes32", "bytes32", "uint64", "uint256", "address"],
      [tokenId, questionHash, bundleHash, enclaveTimestamp, chainId, contractAddress]
    );
    const digest = ethers.keccak256(innerBytes);
    // EIP-191 prefix is applied by signMessage(bytes); matches toEthSignedMessageHash in the contract
    return signer.signMessage(ethers.getBytes(digest));
  }

  function rand32(): string {
    return ethers.hexlify(ethers.randomBytes(32));
  }

  it("mints a corpus and stores the rootBlobHash + teeAttestationSigner", async () => {
    const rootBlobHash = rand32();
    const tx = await contract.connect(user).mint(rootBlobHash, teeSigner.address);
    await expect(tx).to.emit(contract, "CorpusMinted");
    const corpus = await contract.corpusOf(1n);
    expect(corpus.rootBlobHash).to.equal(rootBlobHash);
    expect(corpus.teeAttestationSigner).to.equal(teeSigner.address);
    expect(await contract.ownerOf(1n)).to.equal(user.address);
  });

  it("rejects zero rootBlobHash or zero signer", async () => {
    await expect(
      contract.connect(user).mint(ethers.ZeroHash, teeSigner.address)
    ).to.be.revertedWithCustomError(contract, "InvalidInput");
    await expect(
      contract.connect(user).mint(rand32(), ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(contract, "InvalidInput");
  });

  it("logs a TEE-signed inference event", async () => {
    const rootBlobHash = rand32();
    await contract.connect(user).mint(rootBlobHash, teeSigner.address);

    const tokenId = 1n;
    const questionHash = rand32();
    const bundleHash = rand32();
    const block = await ethers.provider.getBlock("latest");
    const enclaveTs = Number(block!.timestamp);
    const { chainId } = await ethers.provider.getNetwork();
    const contractAddress = await contract.getAddress();

    const sig = await signInferenceDigest(
      teeSigner,
      contractAddress,
      tokenId,
      questionHash,
      bundleHash,
      enclaveTs,
      chainId
    );

    await expect(
      contract.logInference(tokenId, questionHash, bundleHash, enclaveTs, sig)
    ).to.emit(contract, "InferenceLogged");

    expect(await contract.inferenceCountOf(tokenId)).to.equal(1n);
  });

  it("rejects a forged signature from the wrong signer", async () => {
    const rootBlobHash = rand32();
    await contract.connect(user).mint(rootBlobHash, teeSigner.address);

    const tokenId = 1n;
    const questionHash = rand32();
    const bundleHash = rand32();
    const block = await ethers.provider.getBlock("latest");
    const enclaveTs = Number(block!.timestamp);
    const { chainId } = await ethers.provider.getNetwork();
    const contractAddress = await contract.getAddress();

    // Sign with `user` (not the registered teeSigner) — must revert
    const forged = await signInferenceDigest(
      user,
      contractAddress,
      tokenId,
      questionHash,
      bundleHash,
      enclaveTs,
      chainId
    );

    await expect(
      contract.logInference(tokenId, questionHash, bundleHash, enclaveTs, forged)
    ).to.be.revertedWithCustomError(contract, "InvalidSignature");
  });

  it("inferenceAt returns each logged event in order", async () => {
    const rootBlobHash = rand32();
    await contract.connect(user).mint(rootBlobHash, teeSigner.address);

    const tokenId = 1n;
    const block = await ethers.provider.getBlock("latest");
    const baseTs = Number(block!.timestamp);
    const { chainId } = await ethers.provider.getNetwork();
    const contractAddress = await contract.getAddress();

    const inferences = [];
    for (let i = 0; i < 3; i++) {
      const qh = rand32();
      const bh = rand32();
      const ts = baseTs + i;
      const sig = await signInferenceDigest(teeSigner, contractAddress, tokenId, qh, bh, ts, chainId);
      await contract.logInference(tokenId, qh, bh, ts, sig);
      inferences.push({ qh, bh });
    }

    expect(await contract.inferenceCountOf(tokenId)).to.equal(3n);
    for (let i = 0; i < 3; i++) {
      const entry = await contract.inferenceAt(tokenId, i);
      expect(entry.questionHash).to.equal(inferences[i]!.qh);
      expect(entry.bundleHash).to.equal(inferences[i]!.bh);
    }
  });

  it("supports ERC-721 transfer of a corpus iNFT", async () => {
    const rootBlobHash = rand32();
    await contract.connect(user).mint(rootBlobHash, teeSigner.address);
    const tokenId = 1n;

    // user → owner via safeTransferFrom
    await contract.connect(user)["safeTransferFrom(address,address,uint256)"](
      user.address,
      owner.address,
      tokenId
    );
    expect(await contract.ownerOf(tokenId)).to.equal(owner.address);

    // The corpus' rootBlobHash + signer survives the transfer (the new owner inherits the agent)
    const corpus = await contract.corpusOf(tokenId);
    expect(corpus.rootBlobHash).to.equal(rootBlobHash);
    expect(corpus.teeAttestationSigner).to.equal(teeSigner.address);
  });

  it("rejects an out-of-range enclave timestamp", async () => {
    const rootBlobHash = rand32();
    await contract.connect(user).mint(rootBlobHash, teeSigner.address);

    const tokenId = 1n;
    const questionHash = rand32();
    const bundleHash = rand32();
    const block = await ethers.provider.getBlock("latest");
    const farFutureTs = Number(block!.timestamp) + FIVE_MINUTES + 60;
    const { chainId } = await ethers.provider.getNetwork();
    const contractAddress = await contract.getAddress();

    const sig = await signInferenceDigest(
      teeSigner,
      contractAddress,
      tokenId,
      questionHash,
      bundleHash,
      farFutureTs,
      chainId
    );

    await expect(
      contract.logInference(tokenId, questionHash, bundleHash, farFutureTs, sig)
    ).to.be.revertedWithCustomError(contract, "EnclaveTimestampOutOfRange");
  });

  // ────────────────────────────────────────────────────────────────────
  // Commit-reveal (on-chain MEV-resistance hooks)
  // ────────────────────────────────────────────────────────────────────

  async function setupCorpusAndSignedBundle() {
    const rootBlobHash = rand32();
    await contract.connect(user).mint(rootBlobHash, teeSigner.address);
    const tokenId = 1n;
    const questionHash = rand32();
    const bundleHash = rand32();
    const block = await ethers.provider.getBlock("latest");
    const enclaveTs = Number(block!.timestamp);
    const { chainId } = await ethers.provider.getNetwork();
    const contractAddress = await contract.getAddress();
    const sig = await signInferenceDigest(
      teeSigner,
      contractAddress,
      tokenId,
      questionHash,
      bundleHash,
      enclaveTs,
      chainId
    );
    return { tokenId, questionHash, bundleHash, enclaveTs, sig };
  }

  it("commitInference registers a hash and emits InferenceCommitted", async () => {
    const commitHash = rand32();
    await expect(contract.connect(user).commitInference(commitHash))
      .to.emit(contract, "InferenceCommitted")
      .withArgs(commitHash, (ts: bigint) => ts > 0n);
    expect(await contract.commitRegisteredAt(commitHash)).to.be.greaterThan(0n);
  });

  it("commitInference rejects the zero hash and double registration", async () => {
    await expect(
      contract.connect(user).commitInference(ethers.ZeroHash)
    ).to.be.revertedWithCustomError(contract, "InvalidInput");

    const commitHash = rand32();
    await contract.connect(user).commitInference(commitHash);
    await expect(
      contract.connect(user).commitInference(commitHash)
    ).to.be.revertedWithCustomError(contract, "CommitAlreadyRegistered");
  });

  it("revealAndLogInference rejects reveal without a prior commit", async () => {
    const { tokenId, questionHash, bundleHash, enclaveTs, sig } =
      await setupCorpusAndSignedBundle();
    const phantomCommit = rand32();
    await expect(
      contract.revealAndLogInference(
        phantomCommit,
        tokenId,
        questionHash,
        bundleHash,
        enclaveTs,
        sig
      )
    ).to.be.revertedWithCustomError(contract, "CommitNotFound");
  });

  it("revealAndLogInference rejects reveal before REVEAL_DELAY elapses", async () => {
    const commitHash = rand32();
    await contract.connect(user).commitInference(commitHash);
    const { tokenId, questionHash, bundleHash, enclaveTs, sig } =
      await setupCorpusAndSignedBundle();
    // Immediate reveal — no time has passed, should fail.
    await expect(
      contract.revealAndLogInference(
        commitHash,
        tokenId,
        questionHash,
        bundleHash,
        enclaveTs,
        sig
      )
    ).to.be.revertedWithCustomError(contract, "RevealTooEarly");
  });

  it("advertises ERC-7857 + ERC-721 + ERC-165 via supportsInterface", async () => {
    // ERC-165 itself
    expect(await contract.supportsInterface("0x01ffc9a7")).to.equal(true);
    // ERC-721
    expect(await contract.supportsInterface("0x80ac58cd")).to.equal(true);
    // ERC-7857 placeholder (matches the constant in Provenant.sol)
    expect(await contract.supportsInterface("0x78570001")).to.equal(true);
    // Random interface id should be rejected
    expect(await contract.supportsInterface("0xffffffff")).to.equal(false);
  });

  it("revealAndLogInference succeeds after REVEAL_DELAY, logs, and consumes the commit", async () => {
    const commitHash = rand32();
    await contract.connect(user).commitInference(commitHash);

    // Advance the hardhat clock past REVEAL_DELAY (constant = 60 seconds in the contract).
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine", []);

    const { tokenId, questionHash, bundleHash, enclaveTs, sig } =
      await setupCorpusAndSignedBundle();
    // Re-sign with a fresh enclave timestamp matching the new "now" after the time bump.
    const block = await ethers.provider.getBlock("latest");
    const freshTs = Number(block!.timestamp);
    const { chainId } = await ethers.provider.getNetwork();
    const contractAddress = await contract.getAddress();
    const freshSig = await signInferenceDigest(
      teeSigner,
      contractAddress,
      tokenId,
      questionHash,
      bundleHash,
      freshTs,
      chainId
    );

    await expect(
      contract.revealAndLogInference(
        commitHash,
        tokenId,
        questionHash,
        bundleHash,
        freshTs,
        freshSig
      )
    )
      .to.emit(contract, "InferenceLogged")
      .and.to.emit(contract, "InferenceRevealed")
      .withArgs(commitHash, tokenId, bundleHash);

    // Commit slot was consumed (single-use).
    expect(await contract.commitRegisteredAt(commitHash)).to.equal(0n);
    expect(await contract.inferenceCountOf(tokenId)).to.equal(1n);

    // Second reveal with the same commit must fail.
    await expect(
      contract.revealAndLogInference(
        commitHash,
        tokenId,
        questionHash,
        bundleHash,
        freshTs,
        freshSig
      )
    ).to.be.revertedWithCustomError(contract, "CommitNotFound");
    // Use unused-vars (chainId/contractAddress) — silence TS.
    void enclaveTs;
    void sig;
  });
});

describe("ProvenantReader", () => {
  let owner: HardhatEthersSigner;
  let teeSigner: HardhatEthersSigner;
  let reader: ProvenantReader;

  beforeEach(async () => {
    [owner, teeSigner] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("ProvenantReader");
    reader = (await factory.deploy(teeSigner.address)) as unknown as ProvenantReader;
    await reader.waitForDeployment();
  });

  function rand32(): string {
    return ethers.hexlify(ethers.randomBytes(32));
  }

  async function signMirrorDigest(
    signer: HardhatEthersSigner,
    contractAddress: string,
    bundleHash: string,
    originTxHash: string,
    originChainId: bigint,
    enclaveTs: number,
    chainId: bigint
  ): Promise<string> {
    const innerBytes = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32", "uint256", "uint64", "uint256", "address"],
      [bundleHash, originTxHash, originChainId, enclaveTs, chainId, contractAddress]
    );
    const digest = ethers.keccak256(innerBytes);
    return signer.signMessage(ethers.getBytes(digest));
  }

  it("accepts a valid TEE-signed mirror", async () => {
    const bundleHash = rand32();
    const originTxHash = rand32();
    const originChainId = 16661n; // Aristotle
    const block = await ethers.provider.getBlock("latest");
    const enclaveTs = Number(block!.timestamp);
    const { chainId } = await ethers.provider.getNetwork();
    const contractAddress = await reader.getAddress();

    const sig = await signMirrorDigest(
      teeSigner,
      contractAddress,
      bundleHash,
      originTxHash,
      originChainId,
      enclaveTs,
      chainId
    );

    await expect(
      reader.mirror(bundleHash, originTxHash, originChainId, enclaveTs, sig)
    ).to.emit(reader, "Mirrored");

    expect(await reader.isMirrored(bundleHash)).to.equal(true);
  });

  it("rejects double-mirror of the same bundle", async () => {
    const bundleHash = rand32();
    const originTxHash = rand32();
    const originChainId = 16661n;
    const block = await ethers.provider.getBlock("latest");
    const enclaveTs = Number(block!.timestamp);
    const { chainId } = await ethers.provider.getNetwork();
    const contractAddress = await reader.getAddress();
    const sig = await signMirrorDigest(
      teeSigner,
      contractAddress,
      bundleHash,
      originTxHash,
      originChainId,
      enclaveTs,
      chainId
    );

    await reader.mirror(bundleHash, originTxHash, originChainId, enclaveTs, sig);
    await expect(
      reader.mirror(bundleHash, originTxHash, originChainId, enclaveTs, sig)
    ).to.be.revertedWithCustomError(reader, "AlreadyMirrored");
  });
});
