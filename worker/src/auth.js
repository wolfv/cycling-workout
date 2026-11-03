// Better Auth instance. Created per request because Workers bindings (env) only exist inside a request.

import { betterAuth } from 'better-auth';
import { captcha, twoFactor } from 'better-auth/plugins';
import { isLocalUrl, allowedOrigins } from './security.js';
import { sendEmail, verificationEmail, signInCodeEmail, passwordResetEmail } from './email.js';

const DAY = 60 * 60 * 24;

// Per-IP limits from docs/api.md: sign-in, send-otp, verify-otp and password reset 5/min, sign-up 3/min.
const PER_MINUTE = (max) => ({ window: 60, max });
export const RATE_LIMIT_RULES = {
    '/sign-in/email': PER_MINUTE(5),
    '/two-factor/send-otp': PER_MINUTE(5),
    '/two-factor/verify-otp': PER_MINUTE(5),
    '/request-password-reset': PER_MINUTE(5),
    '/reset-password': PER_MINUTE(5),
    '/sign-up/email': PER_MINUTE(3)
};

export function createAuth(env, ctx) {
    const baseUrl = new URL(env.BASE_URL);
    // Secure cookies everywhere except plain-HTTP localhost, where browsers (Safari) would drop them.
    const useSecureCookies = !(isLocalUrl(baseUrl) && baseUrl.protocol === 'http:');

    return betterAuth({
        appName: 'Cadence',
        baseURL: baseUrl.origin,
        basePath: '/api/auth',
        secret: env.BETTER_AUTH_SECRET,
        trustedOrigins: [...allowedOrigins(env)],
        database: env.DB,

        emailAndPassword: {
            enabled: true,
            requireEmailVerification: true,
            autoSignIn: false,
            minPasswordLength: 10,
            maxPasswordLength: 128,
            resetPasswordTokenExpiresIn: 60 * 60,
            revokeSessionsOnPasswordReset: true,
            sendResetPassword: async ({ user, url }) => {
                await sendEmail(env, { to: user.email, ...passwordResetEmail(url) });
            }
        },

        emailVerification: {
            sendOnSignUp: true,
            sendOnSignIn: true,
            // A verified address must still pass the second factor, so never open a session from the link.
            autoSignInAfterVerification: false,
            expiresIn: DAY,
            sendVerificationEmail: async ({ user, url }) => {
                await sendEmail(env, { to: user.email, ...verificationEmail(url) });
            }
        },

        session: {
            expiresIn: 30 * DAY,
            updateAge: DAY
        },

        // Every account gets two-factor enabled the moment it is created. Better Auth only issues
        // `twoFactorRedirect` (instead of a session) for users with twoFactorEnabled = true, so this
        // hook is what makes "password alone never produces a session" true. See test/auth.test.js.
        databaseHooks: {
            user: {
                create: {
                    before: async (user) => ({ data: { ...user, twoFactorEnabled: true } })
                }
            }
        },

        plugins: [
            twoFactor({
                issuer: 'Cadence',
                trustDeviceMaxAge: 30 * DAY,
                twoFactorCookieMaxAge: 10 * 60,
                totpOptions: { disable: true },
                otpOptions: {
                    digits: 6,
                    period: 10, // minutes
                    allowedAttempts: 5,
                    storeOTP: 'hashed',
                    sendOTP: async ({ user, otp }) => {
                        await sendEmail(env, { to: user.email, ...signInCodeEmail(otp) });
                    }
                }
            }),
            captcha({
                provider: 'cloudflare-turnstile',
                secretKey: env.TURNSTILE_SECRET_KEY,
                // defaults: /sign-up/email, /sign-in/email, /request-password-reset
                endpoints: ['/sign-up/email', '/sign-in/email', '/request-password-reset']
            })
        ],

        rateLimit: {
            enabled: true,
            storage: 'database',
            window: 60,
            max: 100,
            customRules: RATE_LIMIT_RULES
        },

        advanced: {
            useSecureCookies,
            defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: useSecureCookies },
            ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
            backgroundTasks: ctx ? { handler: (promise) => ctx.waitUntil(promise) } : undefined
        }
    });
}
