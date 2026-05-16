// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title  Provenant — confidential AI inference audit substrate (Track 5 core contract)
/// @notice One iNFT per encrypted corpus. Each token records:
///         - the 0G Storage root hash of the encrypted blob bundle
///         - the address derived from the Sealed Inference enclave's attestation key
///         - an append-only history of inference events, each signed by the enclave
/// @dev    Deploys to 0G Aristotle mainnet (chain id 16661).
///         Pairs with ProvenantReader.sol on Sepolia for cross-chain auditor readability.
///
///         ERC-7857 compatibility: this contract is structurally aligned with 0G's
///         ERC-7857 iNFT standard. The `teeAttestationSigner` field maps onto
///         ERC-7857's encrypted-metadata oracle (the signer who verifies the off-chain
///         encrypted bundle's authenticity). Full ERC-7857 inheritance is a v2 storage-
///         layout change; for v1 we advertise interface support via
///         `supportsInterface(0x78570001)` so downstream tooling that expects an iNFT
///         can recognise this token. The interface ID 0x78570001 is the placeholder
///         allocated in the 0G reference implementation; rebind to the canonical ID
///         once ERC-7857 is finalised in EIPs.
contract Provenant is ERC721 {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ──────────────────────────────────────────────────────────────────
    // Types
    // ──────────────────────────────────────────────────────────────────

    struct Corpus {
        bytes32 rootBlobHash;          // 0G Storage root CID for the ciphertext bundle
        address teeAttestationSigner;  // address derived from the enclave's pubkey
        uint64  issuedAt;
        uint64  lastInferenceAt;
    }

    struct Inference {
        bytes32 questionHash;          // commitment to the (encrypted) question
        bytes32 bundleHash;            // commitment to (answer + chunk hashes + model id + ts)
        uint64  timestamp;
    }

    // ──────────────────────────────────────────────────────────────────
    // Storage
    // ──────────────────────────────────────────────────────────────────

    mapping(uint256 => Corpus) private _corpora;
    mapping(uint256 => Inference[]) private _inferences;
    uint256 private _nextId;

    // Commit-reveal registry: maps an off-chain-computed commit hash to the block
    // timestamp at which it was registered. The commit hash domain is defined by
    // backend/src/mev/shutter.ts (chain-bound + protocol-tagged); the contract does
    // NOT recompute the preimage — it only enforces (a) prior registration and
    // (b) a minimum reveal delay. Decryption-correctness stays in the off-chain
    // keyper layer; the chain enforces ordering and the inclusion of the commit.
    mapping(bytes32 => uint64) private _commits;

    /// @notice Minimum seconds between commit and reveal. Production target is
    ///         180 seconds matching Shutter-on-Gnosis precedent; we use 60 seconds
    ///         here as a demo-tuned floor that still survives multi-block builder
    ///         strategising on every major EVM L1 (Ethereum mainnet block time 12s
    ///         → 5 slots of separation; most L2s 1-2s → 30-60 blocks of separation).
    ///         The 12s value used in earlier scaffolds was insufficient — a block
    ///         builder can collude across two consecutive blocks. 60s is the
    ///         minimum value where commit and reveal cannot land in the same
    ///         builder's window across any major chain.
    uint64 public constant REVEAL_DELAY = 60 seconds;

    // ──────────────────────────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────────────────────────

    error InvalidInput();
    error InvalidSignature();
    error TokenDoesNotExist();
    error EnclaveTimestampOutOfRange();
    error CommitAlreadyRegistered();
    error CommitNotFound();
    error RevealTooEarly();

    // ──────────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────────

    event CorpusMinted(
        uint256 indexed tokenId,
        address indexed owner,
        bytes32 rootBlobHash,
        address teeAttestationSigner
    );

    event InferenceLogged(
        uint256 indexed tokenId,
        bytes32 indexed bundleHash,
        bytes32 questionHash,
        uint64 timestamp
    );

    /// @notice Emitted when an opaque commit hash is registered on-chain. An
    ///         observer in the mempool sees only this hash; the underlying
    ///         (tokenId, questionHash, bundleHash, ...) tuple is not learnable
    ///         until the corresponding reveal+log transaction lands after the
    ///         REVEAL_DELAY window.
    event InferenceCommitted(bytes32 indexed commitHash, uint64 timestamp);

    /// @notice Emitted when a previously-registered commit is consumed by a
    ///         successful reveal+log. The commit slot is cleared (single-use).
    event InferenceRevealed(
        bytes32 indexed commitHash,
        uint256 indexed tokenId,
        bytes32 bundleHash
    );

    // ──────────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────────

    constructor() ERC721("Provenant", "PVN") {}

    // ──────────────────────────────────────────────────────────────────
    // Mint
    // ──────────────────────────────────────────────────────────────────

    /// @notice Mint a new corpus iNFT bound to an encrypted blob on 0G Storage.
    /// @param  rootBlobHash 0G Storage root hash of the encrypted blob bundle.
    /// @param  teeAttestationSigner Address derived from the Sealed Inference enclave's pubkey.
    function mint(bytes32 rootBlobHash, address teeAttestationSigner)
        external
        returns (uint256 tokenId)
    {
        if (rootBlobHash == bytes32(0) || teeAttestationSigner == address(0)) {
            revert InvalidInput();
        }
        unchecked {
            tokenId = ++_nextId;
        }
        _corpora[tokenId] = Corpus({
            rootBlobHash: rootBlobHash,
            teeAttestationSigner: teeAttestationSigner,
            issuedAt: uint64(block.timestamp),
            lastInferenceAt: 0
        });
        _safeMint(msg.sender, tokenId);
        emit CorpusMinted(tokenId, msg.sender, rootBlobHash, teeAttestationSigner);
    }

    // ──────────────────────────────────────────────────────────────────
    // Log inference
    // ──────────────────────────────────────────────────────────────────

    /// @notice Anchor a TEE-signed inference call to this corpus on-chain.
    ///         Anyone can submit; the signature must verify against the corpus's signer.
    /// @param  tokenId             Corpus iNFT id.
    /// @param  questionHash        keccak256 of the (encrypted) question payload.
    /// @param  bundleHash          keccak256 of (answer || source chunk hashes || model id || ts).
    /// @param  enclaveTimestamp    Enclave-asserted timestamp, must be within ±5 minutes of now.
    /// @param  teeSignature        ECDSA over EIP-191 hash of the digest below.
    function logInference(
        uint256 tokenId,
        bytes32 questionHash,
        bytes32 bundleHash,
        uint64 enclaveTimestamp,
        bytes calldata teeSignature
    ) external {
        _logInferenceCore(tokenId, questionHash, bundleHash, enclaveTimestamp, teeSignature);
    }

    // ──────────────────────────────────────────────────────────────────
    // Commit-reveal (MEV-resistant inference anchoring)
    // ──────────────────────────────────────────────────────────────────

    /// @notice Register an opaque commit hash on-chain. The hash is computed
    ///         off-chain (see backend/src/mev/shutter.ts) and binds (chainId,
    ///         verifyingContract, identity, ciphertext, nonce, epochId). The
    ///         contract does NOT recompute the preimage; it only timestamps the
    ///         registration so the subsequent reveal can enforce REVEAL_DELAY.
    ///
    /// @dev Known griefing surface: anyone can register an arbitrary commit hash
    ///      and never reveal. Slot is keyed by hash, so it's per-hash, not per-tx;
    ///      v2 mitigation = commit bond + slashable reveal deadline.
    function commitInference(bytes32 commitHash) external {
        if (commitHash == bytes32(0)) revert InvalidInput();
        if (_commits[commitHash] != 0) revert CommitAlreadyRegistered();
        _commits[commitHash] = uint64(block.timestamp);
        emit InferenceCommitted(commitHash, uint64(block.timestamp));
    }

    /// @notice Reveal a previously-committed inference and log it in one tx.
    ///         Enforces (a) a prior `commitInference(commitHash)` exists,
    ///         (b) REVEAL_DELAY has elapsed since the commit, (c) the same TEE
    ///         signature check `logInference` performs.
    ///
    /// @dev The commit slot is `delete`-d after a successful reveal — single-use.
    ///      Decryption-correctness (i.e. that `bundleHash` actually corresponds
    ///      to the ciphertext that hashed to `commitHash`) is enforced off-chain
    ///      by the keyper-released decryption key. The chain enforces ordering
    ///      and inclusion only — same property Shutter on Gnosis provides.
    function revealAndLogInference(
        bytes32 commitHash,
        uint256 tokenId,
        bytes32 questionHash,
        bytes32 bundleHash,
        uint64 enclaveTimestamp,
        bytes calldata teeSignature
    ) external {
        uint64 committedAt = _commits[commitHash];
        if (committedAt == 0) revert CommitNotFound();
        if (uint64(block.timestamp) < committedAt + REVEAL_DELAY) revert RevealTooEarly();
        delete _commits[commitHash];

        _logInferenceCore(tokenId, questionHash, bundleHash, enclaveTimestamp, teeSignature);
        emit InferenceRevealed(commitHash, tokenId, bundleHash);
    }

    /// @notice Read-only view of when a commit hash was registered (0 if absent
    ///         or already revealed).
    function commitRegisteredAt(bytes32 commitHash) external view returns (uint64) {
        return _commits[commitHash];
    }

    // ──────────────────────────────────────────────────────────────────
    // Internal — shared verify+append+emit body for log and reveal paths
    // ──────────────────────────────────────────────────────────────────

    function _logInferenceCore(
        uint256 tokenId,
        bytes32 questionHash,
        bytes32 bundleHash,
        uint64 enclaveTimestamp,
        bytes calldata teeSignature
    ) internal {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist();
        if (questionHash == bytes32(0) || bundleHash == bytes32(0)) revert InvalidInput();

        // Reject far-future / far-past stamped events to limit replay window.
        uint64 nowTs = uint64(block.timestamp);
        if (enclaveTimestamp + 5 minutes < nowTs || enclaveTimestamp > nowTs + 5 minutes) {
            revert EnclaveTimestampOutOfRange();
        }

        bytes32 digest = keccak256(
            abi.encode(
                tokenId,
                questionHash,
                bundleHash,
                enclaveTimestamp,
                block.chainid,
                address(this)
            )
        ).toEthSignedMessageHash();

        address recovered = digest.recover(teeSignature);
        if (recovered != _corpora[tokenId].teeAttestationSigner) revert InvalidSignature();

        _inferences[tokenId].push(
            Inference({
                questionHash: questionHash,
                bundleHash: bundleHash,
                timestamp: nowTs
            })
        );
        _corpora[tokenId].lastInferenceAt = nowTs;

        emit InferenceLogged(tokenId, bundleHash, questionHash, nowTs);
    }

    // ──────────────────────────────────────────────────────────────────
    // Views
    // ──────────────────────────────────────────────────────────────────

    function corpusOf(uint256 tokenId) external view returns (Corpus memory) {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist();
        return _corpora[tokenId];
    }

    function inferenceCountOf(uint256 tokenId) external view returns (uint256) {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist();
        return _inferences[tokenId].length;
    }

    function inferenceAt(uint256 tokenId, uint256 index) external view returns (Inference memory) {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist();
        if (index >= _inferences[tokenId].length) revert InvalidInput();
        return _inferences[tokenId][index];
    }

    // ──────────────────────────────────────────────────────────────────
    // ERC-165 — interface advertisement (incl. ERC-7857 iNFT)
    // ──────────────────────────────────────────────────────────────────

    /// @notice ERC-7857 (0G's Intelligent NFT standard) interface advertisement.
    ///         Placeholder ID — rebind to the canonical bytes4 once the EIP is finalised.
    bytes4 public constant ERC7857_INTERFACE_ID = 0x78570001;

    /// @inheritdoc ERC721
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override
        returns (bool)
    {
        return interfaceId == ERC7857_INTERFACE_ID || super.supportsInterface(interfaceId);
    }
}
