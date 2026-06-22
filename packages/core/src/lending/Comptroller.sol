// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title Comptroller
 * @dev Central controller for the Compound lending protocol clone
 * Manages market registration, collateral calculations, and liquidations
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IcToken {
    function mint(uint amount) external returns (uint);
    function redeem(uint redeemTokens) external returns (uint);
    function redeemUnderlying(uint redeemAmount) external returns (uint);
    function borrow(uint borrowAmount) external returns (uint);
    function repayBorrow(uint repayAmount) external returns (uint);
    function balanceOf(address owner) external view returns (uint);
    function borrowBalanceCurrent(address account) external returns (uint);
    function exchangeRateCurrent() external returns (uint);
    function getAccountSnapshot(address account) external view returns (
        uint,
        uint,
        uint,
        uint
    );
}

interface IPriceOracle {
    function getUnderlyingPrice(address cToken) external view returns (uint);
}

interface ICompToken {
    function mint(address to, uint amount) external;
    function balanceOf(address account) external view returns (uint);
    function transfer(address to, uint amount) external returns (bool);
}

contract Comptroller is Ownable, ReentrancyGuard {
    // Markets
    mapping(address => Market) public markets;
    address[] public allMarkets;

    // Account liquidity
    mapping(address => mapping(address => bool)) public accountMembership;
    mapping(address => address[]) public accountAssets;

    // Governance
    address public compToken;
    mapping(address => uint) public compAccrued;
    uint public compRate = 1e16; // 0.01 COMP per block

    // Parameters
    uint public constant closeFactorMin = 5e16; // 50%
    uint public constant closeFactorMax = 9e16; // 90%
    uint public closeFactor = 5e16;

    uint public liquidationIncentive = 11e17; // 1.1x (110%)
    IPriceOracle public oracle;

    struct Market {
        bool isListed;
        uint collateralFactorMantissa;
        bool isComped;
        uint compSpeed;
    }

    struct AccountLiquidity {
        uint error;
        uint liquidity;
        uint shortfall;
    }

    event MarketListed(address indexed cToken);
    event CollateralFactorChanged(address indexed cToken, uint oldFactor, uint newFactor);
    event CompSpeedUpdated(address indexed cToken, uint newSpeed);
    event CompAccrued(address indexed user, uint amount);
    event LiquidationEvent(address indexed liquidator, address indexed borrower, uint repayAmount);

    constructor(address _oracle, address _compToken) {
        oracle = IPriceOracle(_oracle);
        compToken = _compToken;
    }

    /**
     * @notice Support market by allowing it to be entered as collateral
     */
    function supportMarket(
        address cToken,
        uint collateralFactor,
        bool isComped,
        uint compSpeed
    ) external onlyOwner {
        require(!markets[cToken].isListed, "Market already listed");
        require(collateralFactor <= 9e17, "Invalid collateral factor"); // Max 90%

        markets[cToken] = Market({
            isListed: true,
            collateralFactorMantissa: collateralFactor,
            isComped: isComped,
            compSpeed: compSpeed
        });

        allMarkets.push(cToken);
        emit MarketListed(cToken);
    }

    /**
     * @notice Set collateral factor for a market
     */
    function setCollateralFactor(address cToken, uint newCollateralFactor)
        external
        onlyOwner
    {
        require(markets[cToken].isListed, "Market not listed");
        require(newCollateralFactor <= 9e17, "Invalid factor");

        uint oldFactor = markets[cToken].collateralFactorMantissa;
        markets[cToken].collateralFactorMantissa = newCollateralFactor;

        emit CollateralFactorChanged(cToken, oldFactor, newCollateralFactor);
    }

    /**
     * @notice Set COMP distribution speed
     */
    function setCompSpeed(address cToken, uint newSpeed) external onlyOwner {
        require(markets[cToken].isListed, "Market not listed");
        markets[cToken].compSpeed = newSpeed;
        emit CompSpeedUpdated(cToken, newSpeed);
    }

    /**
     * @notice Enter markets to use as collateral
     */
    function enterMarkets(address[] calldata cTokens) external returns (uint[] memory) {
        uint len = cTokens.length;
        uint[] memory results = new uint[](len);

        for (uint i = 0; i < len; i++) {
            if (markets[cTokens[i]].isListed) {
                if (!accountMembership[msg.sender][cTokens[i]]) {
                    accountMembership[msg.sender][cTokens[i]] = true;
                    accountAssets[msg.sender].push(cTokens[i]);
                }
                results[i] = 0;
            } else {
                results[i] = 1; // Market not listed
            }
        }
        return results;
    }

    /**
     * @notice Exit a market
     */
    function exitMarket(address cToken) external returns (uint) {
        require(markets[cToken].isListed, "Market not listed");
        require(accountMembership[msg.sender][cToken], "Not member");

        // Check if account has any outstanding debt
        (uint error, uint liquidity, uint shortfall) = getAccountLiquidity(msg.sender);
        require(error == 0, "Account not healthy");

        accountMembership[msg.sender][cToken] = false;

        // Remove from assets array
        address[] storage assets = accountAssets[msg.sender];
        for (uint i = 0; i < assets.length; i++) {
            if (assets[i] == cToken) {
                assets[i] = assets[assets.length - 1];
                assets.pop();
                break;
            }
        }

        return 0;
    }

    /**
     * @notice Calculate account liquidity (available to borrow)
     */
    function getAccountLiquidity(address account)
        public
        view
        returns (uint, uint, uint)
    {
        AccountLiquidity memory accountLiquidity;

        address[] memory assets = accountAssets[account];
        for (uint i = 0; i < assets.length; i++) {
            address cToken = assets[i];
            if (!accountMembership[account][cToken]) continue;

            try IcToken(cToken).getAccountSnapshot(account) returns (
                uint balance,
                uint borrows,
                uint exchangeRate
            ) {
                uint collateralValue = (balance * exchangeRate / 1e18) *
                    oracle.getUnderlyingPrice(cToken) / 1e18;
                uint collateralFactor = markets[cToken].collateralFactorMantissa;
                accountLiquidity.liquidity += (collateralValue * collateralFactor) / 1e18;

                uint borrowValue = borrows * oracle.getUnderlyingPrice(cToken) / 1e18;
                accountLiquidity.shortfall += borrowValue;
            } catch {
                return (1, 0, 0);
            }
        }

        if (accountLiquidity.liquidity >= accountLiquidity.shortfall) {
            return (0, accountLiquidity.liquidity - accountLiquidity.shortfall, 0);
        } else {
            return (0, 0, accountLiquidity.shortfall - accountLiquidity.liquidity);
        }
    }

    /**
     * @notice Liquidate undercollateralized account
     */
    function liquidateBorrow(
        address borrower,
        uint repayAmount,
        address cTokenCollateral,
        address cTokenBorrow
    ) external nonReentrant returns (uint) {
        require(markets[cTokenBorrow].isListed, "Market not listed");
        require(markets[cTokenCollateral].isListed, "Market not listed");

        // Verify borrower is underwater
        (, uint liquidity, uint shortfall) = getAccountLiquidity(borrower);
        require(shortfall > 0, "Account is healthy");

        // Verify repay amount is reasonable
        uint maxClose = (IcToken(cTokenBorrow).borrowBalanceCurrent(borrower) *
            closeFactor) / 1e18;
        require(repayAmount <= maxClose, "Too much repay");

        // Transfer repay amount from liquidator
        address underlying = cTokenBorrow;
        IERC20(underlying).transferFrom(msg.sender, cTokenBorrow, repayAmount);

        // Repay borrow on behalf of borrower
        IcToken(cTokenBorrow).repayBorrow(repayAmount);

        // Seize collateral
        uint seizeTokens = (repayAmount * liquidationIncentive) / 1e18;
        IcToken(cTokenCollateral).redeem(seizeTokens);

        emit LiquidationEvent(msg.sender, borrower, repayAmount);
        return 0;
    }

    /**
     * @notice Distribute COMP rewards
     */
    function claimComp(address[] calldata holders, address[] calldata cTokens) external {
        uint len = holders.length;
        for (uint i = 0; i < len; i++) {
            address holder = holders[i];
            _compAccrueInternal(holder);

            if (compAccrued[holder] > 0) {
                uint compToTransfer = compAccrued[holder];
                compAccrued[holder] = 0;
                ICompToken(compToken).mint(holder, compToTransfer);
            }
        }
    }

    /**
     * @notice Internal: Accrue COMP for user
     */
    function _compAccrueInternal(address user) internal {
        address[] memory assets = accountAssets[user];
        for (uint i = 0; i < assets.length; i++) {
            if (markets[assets[i]].isComped) {
                compAccrued[user] += markets[assets[i]].compSpeed;
            }
        }
    }

    /**
     * @notice Get all markets
     */
    function getAllMarkets() external view returns (address[] memory) {
        return allMarkets;
    }

    /**
     * @notice Get account assets
     */
    function getAssetsIn(address account) external view returns (address[] memory) {
        return accountAssets[account];
    }

    /**
     * @notice Check if account is member of market
     */
    function checkMembership(address account, address cToken) external view returns (bool) {
        return accountMembership[account][cToken];
    }
}
