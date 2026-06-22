import { PublicKey, Keypair } from '@solana/web3.js';
import { ethers } from 'ethers';
import CryptoJS from 'crypto-js';
import { WalletAccount, Token } from '../types/wallet';

/**
 * Solana Wallet Utilities
 */
export class SolanaWalletManager {
  /**
   * Generate a new Solana keypair
   */
  static generateKeypair(): { publicKey: string; privateKey: string } {
    const keypair = Keypair.generate();
    return {
      publicKey: keypair.publicKey.toString(),
      privateKey: Buffer.from(keypair.secretKey).toString('base64'),
    };
  }

  /**
   * Import Solana wallet from private key
   */
  static importFromPrivateKey(privateKeyBase64: string): {
    publicKey: string;
    privateKey: string;
  } {
    try {
      const secretKey = Buffer.from(privateKeyBase64, 'base64');
      const keypair = Keypair.fromSecretKey(secretKey);
      return {
        publicKey: keypair.publicKey.toString(),
        privateKey: privateKeyBase64,
      };
    } catch (error) {
      throw new Error('Invalid Solana private key format');
    }
  }

  /**
   * Validate Solana public key
   */
  static validatePublicKey(publicKey: string): boolean {
    try {
      new PublicKey(publicKey);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sign a message with Solana keypair
   */
  static signMessage(
    privateKeyBase64: string,
    message: string
  ): string {
    try {
      const secretKey = Buffer.from(privateKeyBase64, 'base64');
      const keypair = Keypair.fromSecretKey(secretKey);
      const messageBytes = Buffer.from(message, 'utf8');
      const signature = keypair.sign(messageBytes);
      return Buffer.from(signature.signature).toString('hex');
    } catch (error) {
      throw new Error('Failed to sign message');
    }
  }

  /**
   * Simulate Solana transaction creation
   */
  static createMockTransaction(
    from: string,
    to: string,
    amount: number,
    token: string = 'SOL'
  ): {
    signature: string;
    instructions: string[];
  } {
    return {
      signature: `${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 10)}`.repeat(4),
      instructions: [
        `Transfer ${amount} ${token} from ${from.slice(0, 8)}...`,
        `To: ${to.slice(0, 8)}...`,
        `Gas: ~5000 lamports`,
      ],
    };
  }
}

/**
 * Ethereum Wallet Utilities
 */
export class EthereumWalletManager {
  /**
   * Generate a new Ethereum wallet
   */
  static generateWallet(): { address: string; privateKey: string } {
    const wallet = ethers.Wallet.createRandom();
    return {
      address: wallet.address,
      privateKey: wallet.privateKey,
    };
  }

  /**
   * Import Ethereum wallet from private key
   */
  static importFromPrivateKey(privateKey: string): {
    address: string;
    privateKey: string;
  } {
    try {
      const wallet = new ethers.Wallet(privateKey);
      return {
        address: wallet.address,
        privateKey: privateKey,
      };
    } catch (error) {
      throw new Error('Invalid Ethereum private key format');
    }
  }

  /**
   * Validate Ethereum address
   */
  static validateAddress(address: string): boolean {
    return ethers.isAddress(address);
  }

  /**
   * Sign a message with Ethereum wallet
   */
  static signMessage(privateKey: string, message: string): string {
    try {
      const wallet = new ethers.Wallet(privateKey);
      const messageHash = ethers.hashMessage(message);
      const signature = wallet.signingKey.sign(messageHash);
      return signature.serialized;
    } catch (error) {
      throw new Error('Failed to sign message');
    }
  }

  /**
   * Simulate Ethereum transaction creation
   */
  static createMockTransaction(
    from: string,
    to: string,
    amount: number,
    token: string = 'ETH'
  ): {
    signature: string;
    gasEstimate: string;
  } {
    const gasPrice = Math.random() * 100 + 20; // 20-120 Gwei
    const gasEstimate = (amount * 0.01 * gasPrice).toFixed(6);
    return {
      signature: `0x${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`,
      gasEstimate,
    };
  }
}

/**
 * Unified Wallet Manager
 */
export class WalletManager {
  /**
   * Create a new account
   */
  static createAccount(
    type: 'solana' | 'ethereum',
    name: string,
    id: string
  ): WalletAccount {
    let publicKey: string;
    let address: string;
    let privateKey: string;

    if (type === 'solana') {
      const { publicKey: pk, privateKey: prk } = SolanaWalletManager.generateKeypair();
      publicKey = pk;
      address = pk;
      privateKey = prk;
    } else {
      const { address: addr, privateKey: prk } = EthereumWalletManager.generateWallet();
      publicKey = addr;
      address = addr;
      privateKey = prk;
    }

    return {
      id,
      name,
      type,
      address,
      publicKey,
      privateKey,
      balance: Math.random() * 100,
      balanceUSD: Math.random() * 5000,
      createdAt: new Date(),
      tokens: this.generateMockTokens(type),
    };
  }

  /**
   * Import an account
   */
  static importAccount(
    type: 'solana' | 'ethereum',
    privateKey: string,
    name: string,
    id: string
  ): WalletAccount {
    let publicKey: string;
    let address: string;

    try {
      if (type === 'solana') {
        const result = SolanaWalletManager.importFromPrivateKey(privateKey);
        publicKey = result.publicKey;
        address = result.publicKey;
      } else {
        const result = EthereumWalletManager.importFromPrivateKey(privateKey);
        publicKey = result.address;
        address = result.address;
      }

      return {
        id,
        name,
        type,
        address,
        publicKey,
        privateKey,
        balance: Math.random() * 100,
        balanceUSD: Math.random() * 5000,
        createdAt: new Date(),
        tokens: this.generateMockTokens(type),
      };
    } catch (error) {
      throw new Error(`Failed to import ${type} account: ${(error as Error).message}`);
    }
  }

  /**
   * Generate mock tokens for account
   */
  private static generateMockTokens(type: 'solana' | 'ethereum'): Token[] {
    if (type === 'solana') {
      return [
        {
          mint: 'So11111111111111111111111111111111111111112',
          name: 'Solana',
          symbol: 'SOL',
          decimals: 9,
          balance: Math.random() * 100,
          balanceUSD: Math.random() * 5000,
        },
        {
          mint: 'EPjFWaLb3odcccccccccccccccccccccccccccccc',
          name: 'USDC',
          symbol: 'USDC',
          decimals: 6,
          balance: Math.random() * 10000,
          balanceUSD: Math.random() * 10000,
        },
        {
          mint: 'orcaEKTdK7gn1ruzggj8k9wQbF7ARZXquiRQGgyB9tq',
          name: 'Orca',
          symbol: 'ORCA',
          decimals: 6,
          balance: Math.random() * 1000,
          balanceUSD: Math.random() * 2000,
        },
      ];
    } else {
      return [
        {
          mint: '0x0000000000000000000000000000000000000000',
          name: 'Ethereum',
          symbol: 'ETH',
          decimals: 18,
          balance: Math.random() * 10,
          balanceUSD: Math.random() * 50000,
        },
        {
          mint: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          name: 'USDC',
          symbol: 'USDC',
          decimals: 6,
          balance: Math.random() * 50000,
          balanceUSD: Math.random() * 50000,
        },
        {
          mint: '0x7Fc66500c84A76Ad7e9c93437E434122A1f9AcDEd',
          name: 'Aave',
          symbol: 'AAVE',
          decimals: 18,
          balance: Math.random() * 100,
          balanceUSD: Math.random() * 30000,
        },
      ];
    }
  }

  /**
   * Encrypt sensitive data (for storage)
   */
  static encryptData(data: string, password: string): string {
    return CryptoJS.AES.encrypt(data, password).toString();
  }

  /**
   * Decrypt sensitive data
   */
  static decryptData(encryptedData: string, password: string): string {
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedData, password);
      return bytes.toString(CryptoJS.enc.Utf8);
    } catch {
      throw new Error('Failed to decrypt data');
    }
  }

  /**
   * Validate password strength
   */
  static validatePassword(password: string): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    if (password.length < 8) errors.push('Password must be at least 8 characters');
    if (!/[A-Z]/.test(password)) errors.push('Password must contain uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('Password must contain lowercase letter');
    if (!/[0-9]/.test(password)) errors.push('Password must contain number');
    if (!/[!@#$%^&*]/.test(password)) errors.push('Password must contain special character');

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Hash password for storage
   */
  static hashPassword(password: string): string {
    return CryptoJS.SHA256(password).toString();
  }

  /**
   * Verify password
   */
  static verifyPassword(password: string, hash: string): boolean {
    return this.hashPassword(password) === hash;
  }
}
