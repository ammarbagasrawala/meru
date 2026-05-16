// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title  ProvenantReader — Sepolia mirror of Provenant audit events (Track 5 cross-chain layer)
/// @notice Re-attests `InferenceLogged` events from 0G Aristotle, signed by the **same** TEE enclave
///         that authored the original bundle. Deployed on Sepolia (chain 11155111).
/// @dev    THIS IS NOT A BRIDGE. No value is locked, transferred, or custodied. Mirror events
///         are re-attestations of audit-log facts that an indexer on any EVM chain can read.
///         The teeAttestationSigner is bound immutably at deploy time; this contract has no owner.
contract ProvenantReader {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ──────────────────────────────────────────────────────────────────
    // Types
    // ──────────────────────────────────────────────────────────────────

    struct Mirror {
        bytes32 bundleHash;
        bytes32 originTxHash;     // 0G Chain transaction hash where InferenceLogged was emitted
        uint256 originChainId;    // 16661 for 0G Aristotle
        uint64  enclaveTimestamp;
        uint64  mirroredAt;
    }

    // ──────────────────────────────────────────────────────────────────
    // Storage
    // ──────────────────────────────────────────────────────────────────

    address public immutable teeAttestationSigner;
    mapping(bytes32 => Mirror) public mirrorsByBundle;

    // ──────────────────────────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────────────────────────

    error InvalidInput();
    error InvalidSignature();
    error AlreadyMirrored();

    // ──────────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────────

    event Mirrored(
        bytes32 indexed bundleHash,
        bytes32 originTxHash,
        uint256 indexed originChainId,
        uint64 enclaveTimestamp,
        uint64 mirroredAt
    );

    // ──────────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────────

    constructor(address _teeAttestationSigner) {
        if (_teeAttestationSigner == address(0)) revert InvalidInput();
        teeAttestationSigner = _teeAttestationSigner;
    }

    // ──────────────────────────────────────────────────────────────────
    // Mirror submission
    // ──────────────────────────────────────────────────────────────────

    /// @notice Re-attest a 0G Chain InferenceLogged event on this chain.
    /// @param  bundleHash        Must match the original 0G event.
    /// @param  originTxHash      0G Chain tx hash where the event was emitted.
    /// @param  originChainId     The chain id where the event originated (16661 for Aristotle).
    /// @param  enclaveTimestamp  Enclave-asserted timestamp (must match the original).
    /// @param  teeSignature      Signature by the bound TEE signer over the digest below.
    function mirror(
        bytes32 bundleHash,
        bytes32 originTxHash,
        uint256 originChainId,
        uint64 enclaveTimestamp,
        bytes calldata teeSignature
    ) external {
        if (bundleHash == bytes32(0) || originTxHash == bytes32(0) || originChainId == 0) {
            revert InvalidInput();
        }
        if (mirrorsByBundle[bundleHash].bundleHash != bytes32(0)) revert AlreadyMirrored();

        bytes32 digest = keccak256(
            abi.encode(
                bundleHash,
                originTxHash,
                originChainId,
                enclaveTimestamp,
                block.chainid,
                address(this)
            )
        ).toEthSignedMessageHash();

        address recovered = digest.recover(teeSignature);
        if (recovered != teeAttestationSigner) revert InvalidSignature();

        uint64 nowTs = uint64(block.timestamp);
        mirrorsByBundle[bundleHash] = Mirror({
            bundleHash: bundleHash,
            originTxHash: originTxHash,
            originChainId: originChainId,
            enclaveTimestamp: enclaveTimestamp,
            mirroredAt: nowTs
        });

        emit Mirrored(bundleHash, originTxHash, originChainId, enclaveTimestamp, nowTs);
    }

    // ──────────────────────────────────────────────────────────────────
    // Views
    // ──────────────────────────────────────────────────────────────────

    function isMirrored(bytes32 bundleHash) external view returns (bool) {
        return mirrorsByBundle[bundleHash].bundleHash != bytes32(0);
    }
}
