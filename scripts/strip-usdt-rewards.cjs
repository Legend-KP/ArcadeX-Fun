const fs = require("fs");
const path =
  "e:/kushal paliwal/Coding/ArcadeX-Fun/contracts/ArcadeXRewards.sol";
let s = fs.readFileSync(path, "utf8");

s = s.replace("MiniPay hub:", "Base hub:");
s = s.replace(
  "Treasury reservation for USDT/USDC",
  "Treasury reservation for USDC"
);
s = s.replace(
  "On-chain ceiling for a single shuffle payout (USDT/USDC)",
  "On-chain ceiling for a single shuffle payout (USDC)"
);
s = s.replace(
  "// STREAK: fund fixed reward × maxClaims. SHUFFLE: fund maxSinglePayout × maxClaims\n        // (actual token chosen per spin; require either stable can cover the ceiling).",
  "// STREAK: fund fixed USDC reward × maxClaims. SHUFFLE: fund maxSinglePayout × maxClaims in USDC."
);

s = s.replace(
  `    address public constant USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address public constant USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;`,
  `    /// @dev REWARD_USDT (2) kept for ABI numbering; all USDT paths revert UsdtDisabled().
    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;`
);

if (!s.includes("error UsdtDisabled()")) {
  s = s.replace(
    "error UnknownRewardMode();",
    "error UnknownRewardMode();\n    error UsdtDisabled();"
  );
}

s = s.replace(/\n    uint256 public reservedUSDT;/, "");
s = s.replace(
  /\n    event WithdrawnUSDT\(address indexed to, uint256 amount\);/,
  ""
);

const replacements = [
  [
    `            if (cfg.rewardMode == REWARD_USDT) {
                reservedUSDT += cfg.rewardAmount;
            } else if (cfg.rewardMode == REWARD_USDC) {
                reservedUSDC += cfg.rewardAmount;
            }`,
    `            if (cfg.rewardMode == REWARD_USDT) {
                revert UsdtDisabled();
            } else if (cfg.rewardMode == REWARD_USDC) {
                reservedUSDC += cfg.rewardAmount;
            }`,
  ],
  [
    `        if (rewardMode == REWARD_USDT) resolvedTarget = USDT;
        else if (rewardMode == REWARD_USDC) resolvedTarget = USDC;`,
    `        if (rewardMode == REWARD_USDT) revert UsdtDisabled();
        else if (rewardMode == REWARD_USDC) resolvedTarget = USDC;`,
  ],
  [
    `            if (rewardMode == REWARD_USDT) {
                reservedUSDT += rewardAmount;
            } else if (rewardMode == REWARD_USDC) {
                reservedUSDC += rewardAmount;
            }`,
    `            if (rewardMode == REWARD_USDT) {
                revert UsdtDisabled();
            } else if (rewardMode == REWARD_USDC) {
                reservedUSDC += rewardAmount;
            }`,
  ],
  [
    `        if (mode == REWARD_USDT) {
            reservedUSDT -= amount;
        } else if (mode == REWARD_USDC) {
            reservedUSDC -= amount;
        }`,
    `        if (mode == REWARD_USDT) {
            revert UsdtDisabled();
        } else if (mode == REWARD_USDC) {
            reservedUSDC -= amount;
        }`,
  ],
  [
    `            if (won.rewardMode != REWARD_USDT && won.rewardMode != REWARD_USDC) {`,
    `            if (won.rewardMode == REWARD_USDT) revert UsdtDisabled();
            if (won.rewardMode != REWARD_USDC) {`,
  ],
  [
    `            if (cfg.rewardMode != REWARD_USDT && cfg.rewardMode != REWARD_USDC) {`,
    `            if (cfg.rewardMode == REWARD_USDT) revert UsdtDisabled();
            if (cfg.rewardMode != REWARD_USDC) {`,
  ],
  [
    `        if (mode == REWARD_USDT) {
            reservedUSDT -= amount;
            emit ReservationReleased(player, campaignId, USDT, amount);
        } else {
            reservedUSDC -= amount;
            emit ReservationReleased(player, campaignId, USDC, amount);
        }`,
    `        if (mode == REWARD_USDT) {
            revert UsdtDisabled();
        }
        reservedUSDC -= amount;
        emit ReservationReleased(player, campaignId, USDC, amount);`,
  ],
  [
    `            if (rewardMode == REWARD_USDT) {
                rewardTarget = USDT;
            }
            if (rewardMode == REWARD_USDC) {
                rewardTarget = USDC;
            }`,
    `            if (rewardMode == REWARD_USDT) {
                revert UsdtDisabled();
            }
            if (rewardMode == REWARD_USDC) {
                rewardTarget = USDC;
            }`,
  ],
  [
    `        if (campaignType == CampaignType.STREAK) {
            if (rewardMode == REWARD_USDT || rewardMode == REWARD_USDC) {
                uint256 available = _availableBalance(rewardTarget);
                uint256 needed = rewardAmount;
                if (maxClaims > 0) {
                    needed = rewardAmount * uint256(maxClaims);
                }
                if (available < needed) revert InsufficientTreasury();
            }
        } else if (maxSinglePayout > 0 && maxClaims > 0) {
            uint256 needed = maxSinglePayout * uint256(maxClaims);
            if (
                _availableBalance(USDT) < needed && _availableBalance(USDC) < needed
            ) {
                revert InsufficientTreasury();
            }
        }`,
    `        if (campaignType == CampaignType.STREAK) {
            if (rewardMode == REWARD_USDT) {
                revert UsdtDisabled();
            }
            if (rewardMode == REWARD_USDC) {
                uint256 available = _availableBalance(USDC);
                uint256 needed = rewardAmount;
                if (maxClaims > 0) {
                    needed = rewardAmount * uint256(maxClaims);
                }
                if (available < needed) revert InsufficientTreasury();
            }
        } else if (maxSinglePayout > 0 && maxClaims > 0) {
            uint256 needed = maxSinglePayout * uint256(maxClaims);
            if (_availableBalance(USDC) < needed) {
                revert InsufficientTreasury();
            }
        }`,
  ],
  [
    `        if (rewardMode == REWARD_USDT || rewardMode == REWARD_USDC) {
            if (rewardAmount == 0) revert ZeroAmount();
            if (cfg.maxSinglePayout == 0 || rewardAmount > cfg.maxSinglePayout) {
                revert ExceedsMaxPayout();
            }
            // Ensure treasury can cover this variable reservation.
            address token = rewardMode == REWARD_USDT ? USDT : USDC;
            if (_availableBalance(token) < rewardAmount) revert InsufficientTreasury();
            return;
        }`,
    `        if (rewardMode == REWARD_USDT) {
            revert UsdtDisabled();
        }
        if (rewardMode == REWARD_USDC) {
            if (rewardAmount == 0) revert ZeroAmount();
            if (cfg.maxSinglePayout == 0 || rewardAmount > cfg.maxSinglePayout) {
                revert ExceedsMaxPayout();
            }
            if (_availableBalance(USDC) < rewardAmount) revert InsufficientTreasury();
            return;
        }`,
  ],
  [
    `        uint256 reserved = token == USDT ? reservedUSDT : reservedUSDC;`,
    `        if (token != USDC) revert UsdtDisabled();
        uint256 reserved = reservedUSDC;`,
  ],
  [
    `        if (rewardMode == REWARD_USDT || rewardMode == REWARD_USDC) {
            if (rewardAmount == 0) revert ZeroAmount();
            IERC20(rewardTarget).safeTransfer(player, rewardAmount);
            return;
        }`,
    `        if (rewardMode == REWARD_USDT) {
            revert UsdtDisabled();
        }
        if (rewardMode == REWARD_USDC) {
            if (rewardAmount == 0) revert ZeroAmount();
            IERC20(USDC).safeTransfer(player, rewardAmount);
            return;
        }`,
  ],
];

for (const [from, to] of replacements) {
  if (!s.includes(from)) {
    console.warn("MISSING BLOCK:\n" + from.slice(0, 120));
  } else {
    s = s.replace(from, to);
  }
}

s = s.replace(
  /    function withdrawUSDT\(address to, uint256 amount\) external onlyOwner nonReentrant \{[\s\S]*?emit WithdrawnUSDT\(to, amount\);\n    \}\n\n/,
  ""
);
s = s.replace(
  /    function availableUSDT\(\) external view returns \(uint256\) \{\n        return _availableBalance\(USDT\);\n    \}\n\n/,
  ""
);
s = s.replace(/No CELO accepted/g, "No ETH accepted");

fs.writeFileSync(path, s);

const leftovers = [...s.matchAll(/USDT|reservedUSDT|WithdrawnUSDT/g)].map(
  (m) => m[0]
);
console.log("done. leftovers:", leftovers);
console.log(
  "base usdc:",
  s.includes("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")
);
