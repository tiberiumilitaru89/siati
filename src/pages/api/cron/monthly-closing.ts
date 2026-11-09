import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { ADMIN_COOKIE_NAME, getAdminSecurityConfig } from '../../../lib/admin-domain';
import { authorizeCronOrAdmin } from '../../../lib/cron-auth';
import { readEnv } from '../../../lib/env';
import { createProblemResponse, writeStructuredLog } from '../../../lib/problem';
import { dispatchReportEmail, getReportRecipientEmail } from '../../../lib/report-mailer';
import { crossSiteBlockedResponse, isSameOriginRequest } from '../../../lib/request-guards';
import {
  aggregateOrdersReport,
  buildReportEmailHtml,
  computeClosedMonthWindow,
  generateOrdersCsv,
} from '../../../lib/reporting-domain';
import { fetchOrdersBetweenDates, PersistenceError } from '../../../lib/supabase';

export const prerender = false;

/**
 * Jobul Cron de Închidere Lunară (Rulează pe data de 1 a lunii la 08:00: `0 8 1 * *`).
 * Generează automat raportul contabil + borderoul CSV al tuturor facturilor SPV și comenzilor
 * pentru luna anterioară încheiată și îl trimite la contact@floraria-siati.ro.
 */
const handleMonthlyClosing: APIRoute = async ({ request, cookies }) => {
  const traceId = crypto.randomUUID();
  const url = new URL(request.url);
  const instance = url.pathname;

  const auth = authorizeCronOrAdmin({
    authorizationHeader: request.headers.get('authorization'),
    cookieToken: cookies.get(ADMIN_COOKIE_NAME)?.value,
    cronSecret: readEnv('CRON_SECRET'),
    adminConfig: getAdminSecurityConfig(),
  });

  if (!auth.authorized) {
    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/cron-unauthorized',
      title: 'Acces Neautorizat la Închiderea Lunară',
      status: 401,
      detail: 'Token-ul de autorizare pentru raportul lunar de facturi și comenzi este invalid sau lipsește.',
      instance,
      trace_id: traceId,
    });
  }

  if (!auth.viaCronBearer && request.method === 'POST' && !isSameOriginRequest(request)) {
    return crossSiteBlockedResponse(instance, traceId);
  }

  // Permite și interogarea lunii curente din panoul de admin (?scope=current_month),
  // dar implicit calculează luna anterioară încheiată (pentru execuția automată de pe data de 1).
  const scope = url.searchParams.get('scope');
  const now = new Date();

  let startIso: string;
  let endIso: string;
  let periodLabel: string;
  let csvFilename: string;

  if (scope === 'current_month') {
    const startCurrent = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    startIso = startCurrent.toISOString();
    endIso = now.toISOString();
    const monthPadded = String(now.getUTCMonth() + 1).padStart(2, '0');
    periodLabel = `Luna Curentă în Curs (${now.getUTCFullYear()}-${monthPadded})`;
    csvFilename = `Raport_Contabil_Siati_Luna_Curenta_${now.getUTCFullYear()}_${monthPadded}.csv`;
  } else {
    const closedWindow = computeClosedMonthWindow(now);
    startIso = closedWindow.startIso;
    endIso = closedWindow.endIso;
    periodLabel = `Luna Încheiată: ${closedWindow.monthLabelRo}`;
    csvFilename = closedWindow.csvFilename;
  }

  let orders: Awaited<ReturnType<typeof fetchOrdersBetweenDates>>;
  try {
    orders = await fetchOrdersBetweenDates(startIso, endIso, { strict: true });
  } catch (err) {
    writeStructuredLog({
      level: 'error',
      event: 'cron.monthly_closing_orders_unavailable',
      trace_id: traceId,
      error_name: err instanceof Error ? err.name : 'UnknownError',
      error_code: err instanceof PersistenceError ? err.code : undefined,
    });
    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/report-unavailable',
      title: 'Raport Indisponibil',
      status: 502,
      detail: 'Comenzile nu au putut fi citite din baza de date. Raportul lunar nu a fost generat.',
      instance,
      trace_id: traceId,
    });
  }

  const report = aggregateOrdersReport(orders, periodLabel);
  const csvContent = generateOrdersCsv(orders);

  if (url.searchParams.get('format') === 'csv') {
    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csvFilename}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const shouldDispatchEmail =
    auth.viaCronBearer || request.method === 'POST' || url.searchParams.get('dispatch') === 'true';
  const recipientEmail = getReportRecipientEmail();
  const emailDispatched = shouldDispatchEmail
    ? await dispatchReportEmail({
        subject: `🧾 Închidere Lunară Facturi SPV & Comenzi — ${report.periodLabel} (${report.totalRevenueRonFormatted})`,
        html: buildReportEmailHtml(report, 'monthly'),
        csvFilename,
        csvContent,
        traceId,
        logEventPrefix: 'cron.monthly_closing',
      })
    : false;

  writeStructuredLog({
    level: 'info',
    event: 'cron.monthly_closing_generated',
    trace_id: traceId,
    period_label: report.periodLabel,
    orders_count: report.totalOrdersCount,
    invoiced_spv_count: report.invoicedSpvCount,
    total_bani: report.totalRevenueBani.toString(),
    email_dispatched: emailDispatched,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      report_type: 'monthly',
      cron_schedule: '0 8 1 * *',
      period_label: report.periodLabel,
      period_start: startIso,
      period_end: endIso,
      csv_filename: csvFilename,
      recipient_email: recipientEmail,
      email_dispatched: emailDispatched,
      orders_count: report.totalOrdersCount,
      invoiced_spv_count: report.invoicedSpvCount,
      total_revenue: report.totalRevenueRonFormatted,
      total_revenue_eur: report.totalRevenueEurFormatted,
      net_without_vat: report.netWithoutVatRonFormatted,
      estimated_vat_19: report.estimatedVat19RonFormatted,
      by_zone: report.byZone,
      express_count: report.expressCount,
      after_hours_vip_count: report.afterHoursVipCount,
      invoices: report.invoices,
      trace_id: traceId,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    }
  );
};

export const GET: APIRoute = handleMonthlyClosing;
export const POST: APIRoute = handleMonthlyClosing;
