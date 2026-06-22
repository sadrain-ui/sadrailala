export interface CoinbaseUser {
  id: string;
  email: string;
  name: string;
  verified: boolean;
  createdAt: string;
}

export interface CoinbaseAccount {
  id: string;
  type: 'wallet' | 'vault';
  currency: string;
  balance: number;
  available: number;
  hold: number;
}

export interface CoinbaseTransaction {
  id: string;
  type: 'buy' | 'sell' | 'send' | 'receive' | 'convert';
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed';
  timestamp: string;
  fee?: number;
  description?: string;
}

export interface CoinbasePrice {
  currency: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}

export interface CoinbasePortfolioAsset {
  symbol: string;
  name: string;
  amount: number;
  value: number;
  price: number;
  change24h: number;
  icon: string;
}

export interface CoinbaseOrder {
  id: string;
  side: 'buy' | 'sell';
  productId: string;
  orderType: 'market' | 'limit';
  price?: number;
  amount: number;
  status: 'open' | 'pending' | 'done' | 'rejected';
  createdAt: string;
  filledSize: number;
  executedValue: number;
}

export interface CoinbaseDepositMethod {
  id: string;
  type: 'bank_account' | 'payment_method' | 'wire';
  name: string;
  verified: boolean;
  primary: boolean;
}

export interface CoinbaseConversionRate {
  from: string;
  to: string;
  rate: number;
  fee: number;
  estimatedAmount: number;
}

export interface CoinbaseNotification {
  id: string;
  type: 'alert' | 'info' | 'warning';
  message: string;
  timestamp: string;
  read: boolean;
}
