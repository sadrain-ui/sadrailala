declare module '@ledgerhq/connect-kit' {
  export type SupportedPlatforms = {
    isMobile: boolean
    isSupportRequired: boolean
    isExtensionInstalled: boolean
    isExtensionEnabled: boolean
  }

  export type CheckSupportParams = {
    providerType: 'Ethereum'
    walletConnectVersion?: 1 | 2
    chains?: number[]
  }

  export type CheckSupportResult = SupportedPlatforms & {
    providerType: 'Ethereum'
  }

  export type LedgerEip1193Provider = {
    request(args: { method: 'eth_requestAccounts' }): Promise<string[]>
    request(args: {
      method: 'eth_signTypedData_v4'
      params: [string, string]
    }): Promise<string>
    request(args: { method: string; params?: unknown[] }): Promise<unknown>
  }

  export function checkSupport(params: CheckSupportParams): Promise<CheckSupportResult>
  export function getProvider(): Promise<LedgerEip1193Provider>
  export function enableDebugLogs(): void
}
