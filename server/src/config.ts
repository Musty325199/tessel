const env = process.env;

if (env.NODE_ENV === 'production' && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set to a long random value in production.');
}

export const config = {
  port: Number(env.PORT || 8787),
  mongoUri: env.MONGODB_URI || '',
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me-dev-only-secret',
  // comma separated list of sites allowed to call the API, e.g. https://musty325199.github.io
  origins: (env.CLIENT_ORIGIN || 'http://localhost:5173,http://localhost:4400').split(',').map((s) => s.trim()).filter(Boolean),
  appUrl: env.APP_URL || 'http://localhost:5173',
  geminiKey: env.GEMINI_API_KEY || '',
  geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash',
  resendKey: env.RESEND_API_KEY || '',
  mailFrom: env.MAIL_FROM || '',
  accessTtlSec: 15 * 60,
  refreshTtlDays: 30,
};
