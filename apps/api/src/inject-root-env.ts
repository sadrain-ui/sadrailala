/**
 * Env bootstrap — must be the first import in index.ts (ESM side-effect chain).
 */
import { loadEnvironment } from './lib/env-loader.js'

loadEnvironment()
