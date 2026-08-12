// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ArcadeXTxHub
 * @notice Free on-chain play sign-in for Start Game on Base (EVM mirror of Vara ArcadeXTxHub).
 * @dev Play purpose encoding (clients): keccak256(UTF-8 "PLAY:{gameId}") → bytes32.
 *      `signIn` is free (no token transfer); gas is paid by the player.
 */
contract ArcadeXTxHub {
    address public owner;
    address public pendingOwner;
    bool public paused;
    uint64 public signInCount;

    /// @notice Optional future paid purposes (fee in token base units). Unused for free play.
    mapping(bytes32 => uint256) public feeOf;

    event SignedIn(address indexed player, bytes32 indexed purpose, uint256 timestamp);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeeUpdated(bytes32 indexed purpose, uint256 fee);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Free activity tx when the player clicks Start Game.
    function signIn(bytes32 purpose) external whenNotPaused {
        unchecked {
            signInCount += 1;
        }
        emit SignedIn(msg.sender, purpose, block.timestamp);
    }

    function pause() external onlyOwner {
        require(!paused, "Already paused");
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        require(paused, "Not paused");
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner is zero address");
        require(newOwner != address(this), "New owner cannot be this contract");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    /// @notice Owner sets a fee for a future paid purpose (Phase 2).
    function setFee(bytes32 purpose, uint256 fee) external onlyOwner {
        if (fee == 0) {
            delete feeOf[purpose];
        } else {
            feeOf[purpose] = fee;
        }
        emit FeeUpdated(purpose, fee);
    }

    receive() external payable {
        revert("No ETH accepted");
    }

    fallback() external payable {
        revert("No ETH accepted");
    }
}
