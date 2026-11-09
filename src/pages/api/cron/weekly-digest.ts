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
  generateOrdersCsv,
} from '../../../lib/reporting-domain';
import { fetchOrdersBetweenDates, PersistenceError } from '../../../lib/supabase';

export const prerender = false;

const handleWeeklyDigest: APIRoute = async ({ request, cookies }) => {
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
      title: 'Acces Neautorizat la Raportul Săptămânal',
      status: 401,
      detail: 'Token-ul de autorizare pentru raportul săptămânal este invalid sau lipsește.',
      instance,
      trace_id: traceId,
    });
  }

  if (!auth.viaCronBearer && request.method === 'POST' && !isSameOriginRequest(request)) {
    return crossSiteBlockedResponse(instance, traceId);
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startIso = sevenDaysAgo.toISOString();
  const endIso = now.toISOString();
  const periodLabel = `Ultimele 7 Zile (${startIso.slice(0, 10)} → ${endIso.slice(0, 10)})`;

  let orders: Awaited<ReturnType<typeof fetchOrdersBetweenDates>>;
  try {
    orders = await fetchOrdersBetweenDates(startIso, endIso, { strict: true });
  } catch (err) {
    writeStructuredLog({
      level: 'error',
      event: 'cron.weekly_digest_orders_unavailable',
      trace_id: traceId,
      error_name: err instanceof Error ? err.name : 'UnknownError',
      error_code: err instanceof PersistenceError ? err.code : undefined,
    });
    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/report-unavailable',
      title: 'Raport Indisponibil',
      status: 502,
      detail: 'Comenzile nu au putut fi citite din baza de date. Raportul nu a fost generat.',
      instance,
      trace_id: traceId,
    });
  }

  const report = aggregateOrdersReport(orders, periodLabel);
  const csvContent = generateOrdersCsv(orders);
  const csvFilename = `Raport_Saptamanal_Siati_${endIso.slice(0, 10)}.csv`;

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
        subject: `📊 Raport Săptămânal Comenzi Florăria Siati (${report.totalOrdersCount} comenzi | ${report.totalRevenueRonFormatted})`,
        html: buildReportEmailHtml(report, 'weekly'),
        csvFilename,
        csvContent,
        traceId,
        logEventPrefix: 'cron.weekly_digest',
      })
    : false;

  writeStructuredLog({
    level: 'info',
    event: 'cron.weekly_digest_generated',
    trace_id: traceId,
    orders_count: report.totalOrdersCount,
    total_bani: report.totalRevenueBani.toString(),
    email_dispatched: emailDispatched,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      report_type: 'weekly',
      period_label: report.periodLabel,
      period_start: startIso,
      period_end: endIso,
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

export const GET: APIRoute = handleWeeklyDigest;
export const POST: APIRoute = handleWeeklyDigest;
