/**
 * Webpack replacement for optional peers (MetaMask SDK / pino-pretty).
 * AsyncStorage stub satisfies dynamic import shape.
 */
module.exports = {
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}
