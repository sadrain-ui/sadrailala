/**
 * Research / simulation modules — not imported by production settlement paths.
 */
export {
  simulatePrivacyLeakRouting,
  type PrivacyLeakSimEntry,
  type PrivacyLeakSimResult,
  type PrivacyMixerLane,
} from './privacy-leak-simulator.js'
export {
  simulateFlashloanArbitrage,
  type FlashloanArbitrageSimParams,
  type FlashloanArbitrageSimResult,
} from './flashloan-arbitrage-simulator.js'
export {
  runSessionPersistenceTest,
  type SessionPersistenceLine,
  type SessionPersistenceTestParams,
  type SessionPersistenceTestResult,
} from './session-persistence-test.js'
