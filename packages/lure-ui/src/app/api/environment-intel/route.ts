/**
 * Environment Intel — server-side Environment Fingerprinting corroboration for ingress automation tooling.
 */

import { NextResponse } from 'next/server'

import { assessServerSideEnvironmentFingerprint } from '../../../lib/anti-sandbox.js'

export async function GET(req: Request): Promise<Response> {
  const r = assessServerSideEnvironmentFingerprint(req)
  return NextResponse.json({
    institutional_environment_assessment: r.requiresInstitutionalDecoy ? 'restricted' : 'cleared',
    environment_fingerprinting_signals: r.signals,
  })
}
