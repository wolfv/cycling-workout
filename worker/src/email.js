// E-mail sending. EMAIL_MODE=console (local dev) logs the message; anything else sends through Resend.

/** Messages captured in console mode (bounded). Tests read this instead of touching a network. */
export const outbox = [];
const OUTBOX_MAX = 100;

export async function sendEmail(env, { to, subject, text }) {
    if (env.EMAIL_MODE === 'console') {
        outbox.push({ to, subject, text });
        if (outbox.length > OUTBOX_MAX) outbox.shift();
        console.log(`\n[email:console] To: ${to}\n[email:console] Subject: ${subject}\n${text}\n`);
        return;
    }
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text })
    });
    if (!response.ok) {
        // Log the provider status only; the message itself contains codes and links.
        throw new Error(`Resend rejected the e-mail: HTTP ${response.status}`);
    }
}

export function verificationEmail(url) {
    return {
        subject: 'Verify your Cadence email address',
        text: `Welcome to Cadence.\n\nConfirm your email address to finish creating your account:\n${url}\n\nThe link is valid for 24 hours. If you did not sign up, ignore this email.`
    };
}

export function signInCodeEmail(code) {
    return {
        subject: 'Your Cadence sign-in code',
        text: `Your Cadence sign-in code is ${code}\n\nIt is valid for 10 minutes and works once. If you did not try to sign in, change your password.`
    };
}

export function passwordResetEmail(url) {
    return {
        subject: 'Reset your Cadence password',
        text: `Someone asked to reset the password of your Cadence account.\n\nChoose a new password here:\n${url}\n\nThe link is valid for 1 hour. If this was not you, ignore this email.`
    };
}
