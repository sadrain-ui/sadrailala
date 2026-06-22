// Wallet account types for Solana and Ethereum
export interface WalletAccount {
  id: string;
  name: string;
  type: 'solana' | 'ethereum';
  address: string;
  publicKey: string;
  privateKey: string; // WARNING: Storing private keys in memory for testing only
  balance: number;
  balanceUSD: number;
  createdAt: Date;
  tokens: Token[];
}

export interface Token {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  balance: number;
  balanceUSD: number;
  imageUrl?: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  type: 'send' | 'receive' | 'swap' | 'stake';
  from: string;
  to: string;
  amount: number;
  token: string;
  status: 'pending' | 'confirmed' | 'failed';
  signature: string;
  timestamp: Date;
  gasUsed?: number;
  gasPaid?: number;
  blockNumber?: number;
  explorerUrl?: string;
  description?: string;
}

export interface StakingInfo {
  accountId: string;
  stakedAmount: number;
  pendingRewards: number;
  apy: number;
  validator?: string;
  estimatedEarnings: number;
  lockupPeriod?: number;
}

export interface DappConnection {
  id: string;
  name: string;
  url: string;
  icon: string;
  connectedAt: Date;
  permissions: DappPermission[];
  accountsConnected: string[]; // account IDs
}

export interface DappPermission {
  type: 'signTransaction' | 'signMessage' | 'signAndSendTransaction';
  granted: boolean;
}

export interface SignatureRequest {
  id: string;
  dappName: string;
  dappUrl: string;
  message: string;
  messageType: 'text' | 'transaction' | 'data';
  accountId: string;
  timestamp: Date;
  status: 'pending' | 'approved' | 'rejected';
  signature?: string;
}

export interface WalletState {
  accounts: WalletAccount[];
  activeAccountId: string | null;
  dappConnections: DappConnection[];
  transactions: Transaction[];
  stakingInfo: StakingInfo[];
  signatureRequests: SignatureRequest[];
  locked: boolean;
  password: string; // For testing only - normally hashed
}

export interface ImportWalletPayload {
  type: 'solana' | 'ethereum';
  privateKey: string;
  name: string;
}
