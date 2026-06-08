export {
  solveCaptchaWithFallback,
  type CaptchaProvider,
  type CaptchaType,
  type CaptchaSolveRequest,
  type CaptchaSolveResult,
} from './captcha-queue.js'

export {
  rotateMirrorDomain,
  rotateCampaignById,
  readRotationIntervalHours,
  type DomainRotationResult,
} from './domain-rotator.js'

export {
  checkMirrorUrl,
  runHealthCheckCycle,
  startHealthWatcherCron,
  type HealthCheckResult,
} from './health-watcher.js'

export {
  getCampaignById,
  listActiveCampaignsWithMirror,
  listAutoRotateCampaigns,
  updateCampaignMirrorFields,
  type CampaignMirrorRecord,
} from './campaign-store.js'

export {
  HARDENED_TLS_DIRECTIVES,
  renderMirrorNginxConfig,
  writeNginxConfig,
  type MirrorNginxTemplateParams,
} from './nginx-template.js'

export { sendMirrorTelegram, isMirrorTelegramConfigured } from './telegram-notify.js'
