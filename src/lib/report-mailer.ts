import { looksLikePlaceholder, readEnv } from './env';
import { writeStructuredLog } from './problem';

const REPORT_EMAIL_TIMEOUT_MS = 10_000;

export function getReportRecipientEmail(): string {
  return readEnv('REPORT_RECIPIENT_EMAIL') ?? 'contact@floraria-siati.ro';
}

/**
 * Trimite prin Resend un raport (HTML + CSV atașat) către adresa atelierului.
 * Returnează `true` doar dacă Resend a acceptat mesajul; orice eșec este logat.
 */
export async function dispatchReportEmail(params: {
  readonly subject: string;
  readonly html: string;
  readonly csvFilename: string;
  readonly csvContent: string;
  readonly traceId: string;
  readonly logEventPrefix: string;
}): Promise<boolean> {
  const resendApiKey = readEnv('RESEND_API_KEY');
  if (!resendApiKey || looksLikePlaceholder(resendApiKey)) {
    return false;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: readEnv('RESEND_FROM_EMAIL') ?? 'Florăria Siati <contact@floraria-siati.ro>',
        to: [getReportRecipientEmail()],
        subject: params.subject,
        html: params.html,
        attachments: [
          {
            filename: params.csvFilename,
            content: Buffer.from(params.csvContent, 'utf8').toString('base64'),
          },
        ],
      }),
      signal: AbortSignal.timeout(REPORT_EMAIL_TIMEOUT_MS),
    });

    if (!response.ok) {
      writeStructuredLog({
        level: 'error',
        event: `${params.logEventPrefix}_email_rejected`,
        trace_id: params.traceId,
        http_status: response.status,
        error_text: (await response.text()).slice(0, 300),
      });
    }
    return response.ok;
  } catch (err) {
    writeStructuredLog({
      level: 'error',
      event: `${params.logEventPrefix}_email_failed`,
      trace_id: params.traceId,
      error_name: err instanceof Error ? err.name : 'ResendError',
    });
    return false;
  }
}
