/** Canonical production host for the hosted Alliance HQ deployment. */
export const PRODUCTION_APP_HOST = "frontline.gay";

export const PRODUCTION_APP_ORIGIN = `https://${PRODUCTION_APP_HOST}`;

/** Default From address once Resend verifies {@link PRODUCTION_APP_HOST}. */
export const PRODUCTION_EMAIL_FROM = `Alliance HQ <auth@${PRODUCTION_APP_HOST}>`;

/** Resend sandbox sender — local dev only; often lands in spam. */
export const RESEND_DEV_EMAIL_FROM = "Alliance HQ <onboarding@resend.dev>";
