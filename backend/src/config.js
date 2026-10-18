import './env.js';
// Central configuration. Every value can be overridden by an environment variable (see .env.example).
const num = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : Number(v);
};
const bool = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : ['1', 'true', 'yes'].includes(v.toLowerCase());
};

const env = process.env.NODE_ENV || 'development';

export const config = {
  env,
  isProd: env === 'production',
  isTest: env === 'test',
  port: num('PORT', 4000),
  // Empty = use the embedded PostgreSQL (no installation needed). Set it to use a real PostgreSQL server.
  databaseUrl: process.env.DATABASE_URL || '',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  // Secrets: development defaults exist so the project runs out of the box. Production refuses them.
  jwtSecret: process.env.JWT_SECRET || 'dev-only-jwt-secret-change-me-please-0123456789',
  reportKeyHex: process.env.REPORT_ENCRYPTION_KEY || '0'.repeat(63) + '1', // 32 bytes as 64 hex chars
  accessTokenMinutes: num('ACCESS_TOKEN_MINUTES', 15),
  refreshTokenDays: num('REFRESH_TOKEN_DAYS', 14),
  cookieSecure: bool('COOKIE_SECURE', env === 'production'),

  // Login protection
  maxFailedLogins: num('MAX_FAILED_LOGINS', 5),
  lockMinutes: num('LOCK_MINUTES', 15),
  authRateLimit: num('AUTH_RATE_LIMIT', env === 'test' ? 10000 : 30), // per 15 minutes per IP
  apiRateLimit: num('API_RATE_LIMIT', env === 'test' ? 100000 : 600), // per minute per IP

  // Guardian accounts: when true, an administrator must verify a guardian before links can activate.
  requireGuardianVerification: bool('REQUIRE_GUARDIAN_VERIFICATION', false),

  // Geofence validation
  maxAccuracyM: num('GEOFENCE_MAX_ACCURACY_M', 100), // readings less accurate than this are ignored
  confirmReadings: num('GEOFENCE_CONFIRM_READINGS', 2), // consecutive differing readings required
  confirmMinSeconds: num('GEOFENCE_CONFIRM_MIN_SECONDS', env === 'test' ? 0 : 15),
  confirmMaxSeconds: num('GEOFENCE_CONFIRM_MAX_SECONDS', 180), // a stale candidate restarts
  cooldownSeconds: num('GEOFENCE_COOLDOWN_SECONDS', env === 'test' ? 5 : 300),

  // Retention (days unless noted). The retention job deletes anything older.
  retention: {
    locationEventsDays: num('RETENTION_LOCATION_EVENTS_DAYS', 30),
    sosDays: num('RETENTION_SOS_DAYS', 90),
    notificationsDays: num('RETENTION_NOTIFICATIONS_DAYS', 90),
    checkinsDays: num('RETENTION_CHECKINS_DAYS', 7),
    auditMonths: num('RETENTION_AUDIT_MONTHS', 12),
    closedReportsDays: num('RETENTION_CLOSED_REPORTS_DAYS', 365),
    endedLinksDays: num('RETENTION_ENDED_LINKS_DAYS', 30),
    deactivatedAnonymizeDays: num('RETENTION_DEACTIVATED_ANONYMIZE_DAYS', 30),
  },
  runRetentionOnStart: bool('RUN_RETENTION_ON_START', env !== 'test'),
};

if (config.isProd) {
  const weak = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) weak.push('JWT_SECRET (min 32 chars)');
  if (!process.env.REPORT_ENCRYPTION_KEY || !/^[0-9a-fA-F]{64}$/.test(process.env.REPORT_ENCRYPTION_KEY)) {
    weak.push('REPORT_ENCRYPTION_KEY (64 hex chars)');
  }
  if (weak.length) {
    throw new Error(`Refusing to start in production without: ${weak.join(', ')}`);
  }
}
