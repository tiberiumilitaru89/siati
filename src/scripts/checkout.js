// @ts-check

/**
 * @typedef {'idle' | 'loading' | 'success' | 'error'} CheckoutFsmStatus
 */

/**
 * @typedef {'ron' | 'eur'} SupportedCurrency
 */

/**
 * @typedef {'ploiesti' | 'limitrophe' | 'prahova_extins'} DeliveryZone
 */

/**
 * @typedef {Object} CheckoutState
 * @property {CheckoutFsmStatus} status
 * @property {string | null} message
 */

const GDPR_STORAGE_KEY = 'siati_gdpr_consent_v1';

/** @type {Record<DeliveryZone, bigint>} */
const ZONE_FEES_BANI = {
  ploiesti: 0n,
  limitrophe: 0n,
  prahova_extins: 2500n, // +25 RON (+5 EUR)
};

const EXPRESS_FEE_BANI = 3000n; // +30 RON (+6 EUR)
const AFTER_HOURS_VIP_FEE_BANI = 5000n; // +50 RON (+10 EUR)

/**
 * Cursul oficial BNR preluat din datele injectate de server (default: 5.3416).
 * @returns {bigint}
 */
function getActiveBnrRateScaled() {
  const anchor = document.getElementById('checkout-card-anchor');
  if (anchor?.dataset.bnrRate) {
    try {
      const parsed = BigInt(anchor.dataset.bnrRate);
      if (parsed > 0n) return parsed;
    } catch {}
  }
  return 53416n;
}

/**
 * Convertește suma din bani (RON) în eurocenți (EUR) la cursul oficial BNR cu rotunjire matematică.
 * @param {bigint} bani
 * @returns {bigint}
 */
function convertBaniToEurCents(bani) {
  const rateScaled = getActiveBnrRateScaled();
  return (bani * 10000n + (rateScaled / 2n)) / rateScaled;
}

/**
 * Formatează unități minore (bani sau eurocenți) în șir afișabil.
 * @param {bigint} minor
 * @param {SupportedCurrency} currency
 * @returns {string}
 */
function formatMinorUnits(minor, currency) {
  const label = currency === 'eur' ? 'EUR' : 'RON';
  const whole = minor / 100n;
  const rem = minor % 100n;
  if (rem === 0n) {
    return `${whole.toString()} ${label}`;
  }
  return `${whole.toString()},${rem.toString().padStart(2, '0')} ${label}`;
}

/**
 * Formatează o sumă exprimată în bani în moneda selectată.
 * @param {bigint} bani
 * @param {SupportedCurrency} currency
 * @returns {string}
 */
function formatBaniInCurrency(bani, currency) {
  if (currency === 'eur') {
    return formatMinorUnits(convertBaniToEurCents(bani), 'eur');
  }
  return formatMinorUnits(bani, 'ron');
}

/**
 * Returnează ora curentă în București (pentru regula cut-off 18:30 Carrefour Mall).
 * @returns {{ hour: number, minute: number, isAfterCutoff: boolean }}
 */
function getBucharestScheduleStatus() {
  try {
    const formatter = new Intl.DateTimeFormat('ro-RO', {
      timeZone: 'Europe/Bucharest',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '12');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const totalMinutes = hour * 60 + minute;
    const isAfterCutoff = totalMinutes > 18 * 60 + 30 || totalMinutes < 8 * 60 + 30;
    return { hour, minute, isAfterCutoff };
  } catch {
    return { hour: 12, minute: 0, isAfterCutoff: false };
  }
}

/**
 * Actualizează determinist UI-ul cardului de checkout pe baza automatului cu stări finite (FSM).
 * @param {CheckoutState} state
 * @param {HTMLButtonElement} buttonEl
 * @param {HTMLElement} feedbackEl
 * @param {SupportedCurrency} currency
 */
function renderCheckoutFsm(state, buttonEl, feedbackEl, currency = 'ron') {
  const currencyLabel = currency === 'eur' ? 'EUR €' : 'RON';
  switch (state.status) {
    case 'idle':
      buttonEl.disabled = false;
      buttonEl.textContent = `Comandă Acum (Apple Pay / Card ${currencyLabel})`;
      feedbackEl.hidden = true;
      feedbackEl.textContent = '';
      break;
    case 'loading':
      buttonEl.disabled = true;
      buttonEl.textContent = `Se inițiază sesiunea Stripe (${currencyLabel})...`;
      feedbackEl.hidden = false;
      feedbackEl.dataset.state = 'info';
      feedbackEl.textContent = 'Verificăm stocul, opțiunile de livrare Prahova și pregătim plata securizată...';
      break;
    case 'success':
      buttonEl.disabled = true;
      buttonEl.textContent = 'Redirecționare către Stripe...';
      feedbackEl.hidden = false;
      feedbackEl.dataset.state = 'info';
      feedbackEl.textContent = state.message ?? 'Sesiune creată. Vei fi redirecționat...';
      break;
    case 'error':
      buttonEl.disabled = false;
      buttonEl.textContent = `Comandă Acum (Apple Pay / Card ${currencyLabel})`;
      feedbackEl.hidden = false;
      feedbackEl.dataset.state = 'error';
      feedbackEl.textContent =
        state.message ?? 'A apărut o eroare la inițierea plății. Te rugăm să încerci din nou.';
      break;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const checkoutBtn = document.getElementById('checkout-btn');
  const feedbackEl = document.getElementById('checkout-feedback');
  const requirePhotoInput = document.getElementById('require-photo');
  const perishableConsentInput = document.getElementById('perishable-consent');

  // Câmpuri Felicitare Cadou & Destinatar
  const includeGreetingCardInput = document.getElementById('include-greeting-card');
  const greetingCardFields = document.getElementById('greeting-card-fields');
  const greetingMessageInput = document.getElementById('greeting-message');
  const charCounterEl = document.getElementById('char-counter');
  const msgChips = document.querySelectorAll('.msg-chip');
  const isAnonymousGiftInput = document.getElementById('is-anonymous-gift');
  const toggleRecipientBtn = document.getElementById('toggle-recipient-btn');
  const toggleRecipientLabel = document.getElementById('toggle-recipient-label');
  const recipientDetailsFields = document.getElementById('recipient-details-fields');
  const recipientNameInput = document.getElementById('recipient-name');
  const recipientPhoneInput = document.getElementById('recipient-phone');

  // Câmpuri Email Cumpărător & Newsletter
  const customerEmailInput = document.getElementById('customer-email');
  const newsletterOptinInput = document.getElementById('newsletter-optin');

  const deliveryZoneSelect = document.getElementById('delivery-zone');
  const deliverySlotSelect = document.getElementById('delivery-slot');
  const expressImmediateInput = document.getElementById('express-immediate');
  const afterHoursVipInput = document.getElementById('after-hours-vip');
  const cutoffNoticeEl = document.getElementById('cutoff-live-notice');
  const priceBreakdownEl = document.getElementById('price-breakdown-summary');
  const selectedPriceSecondaryEl = document.getElementById('selected-product-price-secondary');
  const currencyButtons = document.querySelectorAll('.currency-btn');

  const selectedTitleEl = document.getElementById('selected-product-title');
  const selectedDescEl = document.getElementById('selected-product-desc');
  const selectedPriceEl = document.getElementById('selected-product-price');
  const selectedBadgeEl = document.getElementById('selected-product-badge');
  const mainFlowerImg = document.getElementById('main-flower');

  /** @type {SupportedCurrency} */
  let activeCurrency = 'ron';

  /**
   * Recalculează și afișează totalul (Aranjament + Zonă Prahova + Express + VIP Nocturn) în RON și EUR.
   */
  function syncCheckoutPricingAndSchedule() {
    if (!(checkoutBtn instanceof HTMLButtonElement)) {
      return;
    }

    const baseBaniStr = checkoutBtn.dataset.productPriceBani ?? '19000';
    const baseBani = BigInt(baseBaniStr);

    /** @type {DeliveryZone} */
    const zone =
      deliveryZoneSelect instanceof HTMLSelectElement &&
      (deliveryZoneSelect.value === 'limitrophe' || deliveryZoneSelect.value === 'prahova_extins')
        ? deliveryZoneSelect.value
        : 'ploiesti';

    const zoneFeeBani = ZONE_FEES_BANI[zone];
    const isExpress =
      expressImmediateInput instanceof HTMLInputElement && expressImmediateInput.checked;
    const isAfterHoursVip =
      afterHoursVipInput instanceof HTMLInputElement && afterHoursVipInput.checked;

    const expressFeeBani = isExpress ? EXPRESS_FEE_BANI : 0n;
    const vipFeeBani = isAfterHoursVip ? AFTER_HOURS_VIP_FEE_BANI : 0n;
    const totalBani = baseBani + zoneFeeBani + expressFeeBani + vipFeeBani;

    const secondaryCurrency = activeCurrency === 'ron' ? 'eur' : 'ron';

    if (selectedPriceEl) {
      selectedPriceEl.textContent = formatBaniInCurrency(totalBani, activeCurrency);
    }
    if (selectedPriceSecondaryEl) {
      selectedPriceSecondaryEl.textContent = `(${formatBaniInCurrency(totalBani, secondaryCurrency)})`;
    }

    if (priceBreakdownEl) {
      /** @type {string[]} */
      const parts = [`Aranjament (${formatBaniInCurrency(baseBani, activeCurrency)})`];
      if (zoneFeeBani > 0n) {
        parts.push(`Transport Prahova Extins (+${formatBaniInCurrency(zoneFeeBani, activeCurrency)})`);
      } else {
        parts.push('Transport Gratuit');
      }
      if (expressFeeBani > 0n) {
        parts.push(`Plecare Imediată (+${formatBaniInCurrency(expressFeeBani, activeCurrency)})`);
      }
      if (vipFeeBani > 0n) {
        parts.push(`VIP În Afara Programului (+${formatBaniInCurrency(vipFeeBani, activeCurrency)})`);
      }
      priceBreakdownEl.textContent = parts.join(' + ');
    }

    const scheduleStatus = getBucharestScheduleStatus();
    if (cutoffNoticeEl) {
      if (scheduleStatus.isAfterCutoff && !isAfterHoursVip) {
        cutoffNoticeEl.dataset.afterCutoff = 'true';
        cutoffNoticeEl.innerHTML =
          '🌙 <strong>După ora 18:30 (Program Carrefour Mall 08:30–21:00):</strong> Pentru livrare în această seară bifează <strong>„Livrare VIP în Afara Programului (+50 RON)”</strong> sau alege intervalul <strong>„Mâine dimineață 08:30–12:30”</strong>.';
      } else {
        cutoffNoticeEl.dataset.afterCutoff = 'false';
        cutoffNoticeEl.innerHTML =
          '⏱️ Livrarea durează <strong>2–3 ore</strong> în funcție de destinația din Prahova. Ultima comandă standard pentru livrare azi este la ora <strong>18:30</strong>.';
      }
    }

    if (!checkoutBtn.disabled) {
      const currencyLabel = activeCurrency === 'eur' ? 'EUR €' : 'RON';
      checkoutBtn.textContent = `Comandă Acum — ${formatBaniInCurrency(totalBani, activeCurrency)} (Card ${currencyLabel})`;
    }
  }

  // Inițializează starea de oră București (dacă e după 18:30, preselectează Mâine dimineață)
  const initialSchedule = getBucharestScheduleStatus();
  if (
    initialSchedule.isAfterCutoff &&
    deliverySlotSelect instanceof HTMLSelectElement &&
    deliverySlotSelect.value === 'standard_2_3h'
  ) {
    deliverySlotSelect.value = 'next_day_0830_1230';
  }

  currencyButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!(btn instanceof HTMLButtonElement)) {
        return;
      }
      const nextCurr = btn.dataset.currency === 'eur' ? 'eur' : 'ron';
      activeCurrency = nextCurr;

      currencyButtons.forEach((b) => {
        b.classList.remove('is-active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-pressed', 'true');

      syncCheckoutPricingAndSchedule();
    });
  });

  if (deliveryZoneSelect instanceof HTMLSelectElement) {
    deliveryZoneSelect.addEventListener('change', syncCheckoutPricingAndSchedule);
  }
  if (deliverySlotSelect instanceof HTMLSelectElement) {
    deliverySlotSelect.addEventListener('change', syncCheckoutPricingAndSchedule);
  }
  if (expressImmediateInput instanceof HTMLInputElement) {
    expressImmediateInput.addEventListener('change', syncCheckoutPricingAndSchedule);
  }
  if (afterHoursVipInput instanceof HTMLInputElement) {
    afterHoursVipInput.addEventListener('change', syncCheckoutPricingAndSchedule);
  }

  // Felicitare Cadou Gratuită — toggle & counter & chips
  if (includeGreetingCardInput instanceof HTMLInputElement && greetingCardFields instanceof HTMLElement) {
    includeGreetingCardInput.addEventListener('change', () => {
      greetingCardFields.hidden = !includeGreetingCardInput.checked;
      if (includeGreetingCardInput.checked && greetingMessageInput instanceof HTMLTextAreaElement) {
        greetingMessageInput.focus();
      }
    });
  }

  if (greetingMessageInput instanceof HTMLTextAreaElement && charCounterEl instanceof HTMLElement) {
    greetingMessageInput.addEventListener('input', () => {
      charCounterEl.textContent = `${greetingMessageInput.value.length}/300`;
    });
  }

  msgChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      if (!(chip instanceof HTMLButtonElement) || !(greetingMessageInput instanceof HTMLTextAreaElement)) {
        return;
      }
      const msg = chip.dataset.msg ?? '';
      greetingMessageInput.value = msg;
      if (charCounterEl instanceof HTMLElement) {
        charCounterEl.textContent = `${greetingMessageInput.value.length}/300`;
      }
      greetingMessageInput.focus();
    });
  });

  // Livrare către altcineva (destinatar surpriză)
  if (toggleRecipientBtn instanceof HTMLButtonElement && recipientDetailsFields instanceof HTMLElement) {
    toggleRecipientBtn.addEventListener('click', () => {
      const isCurrentlyHidden = recipientDetailsFields.hidden;
      recipientDetailsFields.hidden = !isCurrentlyHidden;
      if (toggleRecipientLabel instanceof HTMLElement) {
        toggleRecipientLabel.textContent = isCurrentlyHidden
          ? 'Ascunde datele destinatarului'
          : '+ Livrare către altcineva (nume și telefon destinatar)';
      }
      if (isCurrentlyHidden && recipientNameInput instanceof HTMLInputElement) {
        recipientNameInput.focus();
      }
    });
  }

  syncCheckoutPricingAndSchedule();

  // 1. Checkout Submit Handler (FSM)
  if (
    checkoutBtn instanceof HTMLButtonElement &&
    feedbackEl instanceof HTMLElement &&
    requirePhotoInput instanceof HTMLInputElement &&
    perishableConsentInput instanceof HTMLInputElement
  ) {
    checkoutBtn.addEventListener('click', async () => {
      if (!perishableConsentInput.checked) {
        renderCheckoutFsm(
          {
            status: 'error',
            message:
              'Pentru a continua către plată, bifează acordul legal privind produsele florale perisabile (OUG 34/2014 art. 16 lit. c).',
          },
          checkoutBtn,
          feedbackEl,
          activeCurrency
        );
        perishableConsentInput.focus();
        return;
      }

      const customerEmail =
        customerEmailInput instanceof HTMLInputElement ? customerEmailInput.value.trim() : '';
      const newsletterOptin =
        newsletterOptinInput instanceof HTMLInputElement ? newsletterOptinInput.checked : true;

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!customerEmail || !emailRegex.test(customerEmail)) {
        renderCheckoutFsm(
          {
            status: 'error',
            message:
              'Te rugăm să introduci o adresă de email validă pentru confirmarea comenzii, primirea facturii și a codului de tracking.',
          },
          checkoutBtn,
          feedbackEl,
          activeCurrency
        );
        if (customerEmailInput instanceof HTMLInputElement) {
          customerEmailInput.focus();
        }
        return;
      }

      const productId = checkoutBtn.dataset.productId ?? '';
      const deliveryZone =
        deliveryZoneSelect instanceof HTMLSelectElement ? deliveryZoneSelect.value : 'ploiesti';
      const deliverySlot =
        deliverySlotSelect instanceof HTMLSelectElement
          ? deliverySlotSelect.value
          : 'standard_2_3h';
      const expressImmediate =
        expressImmediateInput instanceof HTMLInputElement ? expressImmediateInput.checked : false;
      const afterHoursVip =
        afterHoursVipInput instanceof HTMLInputElement ? afterHoursVipInput.checked : false;

      const includeGreetingCard =
        includeGreetingCardInput instanceof HTMLInputElement
          ? includeGreetingCardInput.checked
          : false;
      const greetingMessage =
        includeGreetingCard && greetingMessageInput instanceof HTMLTextAreaElement
          ? greetingMessageInput.value.trim()
          : '';
      const isAnonymousGift =
        isAnonymousGiftInput instanceof HTMLInputElement ? isAnonymousGiftInput.checked : false;
      const recipientName =
        recipientNameInput instanceof HTMLInputElement ? recipientNameInput.value.trim() : '';
      const recipientPhone =
        recipientPhoneInput instanceof HTMLInputElement ? recipientPhoneInput.value.trim() : '';

      renderCheckoutFsm({ status: 'loading', message: null }, checkoutBtn, feedbackEl, activeCurrency);

      try {
        const response = await fetch('/api/create-checkout-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, application/problem+json',
          },
          body: JSON.stringify({
            productId,
            currency: activeCurrency,
            deliveryZone,
            deliverySlot,
            expressImmediate,
            afterHoursVip,
            requirePhoto: requirePhotoInput.checked,
            perishableConsent: perishableConsentInput.checked,
            includeGreetingCard,
            greetingMessage,
            isAnonymousGift,
            recipientName,
            recipientPhone,
            customerEmail,
            newsletterOptin,
          }),
        });

        const payload = await response.json();

        if (!response.ok) {
          const detailMessage =
            typeof payload?.detail === 'string'
              ? payload.detail
              : 'Nu am putut iniția sesiunea de plată.';
          renderCheckoutFsm(
            { status: 'error', message: detailMessage },
            checkoutBtn,
            feedbackEl,
            activeCurrency
          );
          return;
        }

        if (typeof payload?.url === 'string' && payload.url.length > 0) {
          renderCheckoutFsm(
            { status: 'success', message: 'Redirecționare către pagina securizată Stripe...' },
            checkoutBtn,
            feedbackEl,
            activeCurrency
          );
          window.location.assign(payload.url);
          return;
        }

        renderCheckoutFsm(
          { status: 'error', message: 'Răspuns neașteptat de la serverul de plăți.' },
          checkoutBtn,
          feedbackEl,
          activeCurrency
        );
      } catch {
        renderCheckoutFsm(
          {
            status: 'error',
            message:
              'Conexiunea cu serverul a eșuat. Poți plasa comanda și direct pe WhatsApp la 0723 852 820.',
          },
          checkoutBtn,
          feedbackEl,
          activeCurrency
        );
      }
    });
  }

  // 2. Selectare Produs din Catalog -> Actualizează Checkout Card
  const selectButtons = document.querySelectorAll('.select-for-checkout-btn');
  selectButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!(btn instanceof HTMLButtonElement)) {
        return;
      }
      const id = btn.dataset.id;
      const name = btn.dataset.name;
      const desc = btn.dataset.desc;
      const badge = btn.dataset.badge;
      const priceBani = btn.dataset.priceBani;
      const imageUrl = btn.dataset.image;

      if (id && checkoutBtn instanceof HTMLButtonElement) {
        checkoutBtn.dataset.productId = id;
      }
      if (priceBani && checkoutBtn instanceof HTMLButtonElement) {
        checkoutBtn.dataset.productPriceBani = priceBani;
      }
      if (name && selectedTitleEl) {
        selectedTitleEl.textContent = name;
      }
      if (desc && selectedDescEl) {
        selectedDescEl.textContent = desc;
      }
      if (badge && selectedBadgeEl) {
        selectedBadgeEl.textContent = badge;
      }
      if (imageUrl && mainFlowerImg instanceof HTMLImageElement) {
        mainFlowerImg.src = imageUrl;
        if (name) {
          mainFlowerImg.alt = name;
        }
      }

      syncCheckoutPricingAndSchedule();

      const anchor = document.getElementById('checkout-card-anchor');
      if (anchor) {
        anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });

  // 3. Filtrare Categorii Catalog
  const categoryTabs = document.querySelectorAll('.category-tab');
  const productCards = document.querySelectorAll('.product-card');

  categoryTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      if (!(tab instanceof HTMLButtonElement)) {
        return;
      }
      const targetCategory = tab.dataset.category ?? 'all';

      categoryTabs.forEach((t) => {
        t.classList.remove('is-active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('is-active');
      tab.setAttribute('aria-selected', 'true');

      productCards.forEach((card) => {
        if (!(card instanceof HTMLElement)) {
          return;
        }
        const cardCategory = card.dataset.category ?? '';
        const shouldShow = targetCategory === 'all' || cardCategory === targetCategory;
        card.hidden = !shouldShow;
      });
    });
  });

  // 4. Selector Buget WhatsApp
  const budgetChips = document.querySelectorAll('.budget-chip');
  const whatsappBudgetLink = document.getElementById('whatsapp-budget-link');

  budgetChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      if (!(chip instanceof HTMLButtonElement)) {
        return;
      }
      budgetChips.forEach((c) => c.classList.remove('is-selected'));
      chip.classList.add('is-selected');

      const selectedBudget = chip.dataset.budget ?? '150 - 250 RON';
      if (whatsappBudgetLink instanceof HTMLAnchorElement) {
        const text = `Bună ziua! Doresc recomandarea unui buchet în bugetul ${selectedBudget} cu livrare în Ploiești.`;
        whatsappBudgetLink.href = `https://wa.me/40723852820?text=${encodeURIComponent(text)}`;
      }
    });
  });

  // 5. Dialog Modal Nativ „Oferta Săptămânii”
  const offerDialog = document.getElementById('weekly-offer-dialog');
  const openOfferBtn = document.getElementById('open-weekly-offer-btn');
  const closeOfferBtn = document.getElementById('close-weekly-offer-btn');
  const claimOfferBtn = document.getElementById('claim-weekly-offer-btn');

  if (offerDialog instanceof HTMLDialogElement) {
    if (openOfferBtn instanceof HTMLButtonElement) {
      openOfferBtn.addEventListener('click', () => {
        offerDialog.showModal();
      });
    }

    if (closeOfferBtn instanceof HTMLButtonElement) {
      closeOfferBtn.addEventListener('click', () => {
        offerDialog.close();
      });
    }

    offerDialog.addEventListener('click', (event) => {
      if (event.target === offerDialog) {
        offerDialog.close();
      }
    });

    if (claimOfferBtn instanceof HTMLButtonElement) {
      claimOfferBtn.addEventListener('click', () => {
        offerDialog.close();
        const anchor = document.getElementById('checkout-card-anchor');
        if (anchor) {
          anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }
  }

  // 6. Banner Consimțământ GDPR
  const gdprBanner = document.getElementById('gdpr-consent-banner');
  const gdprAcceptBtn = document.getElementById('gdpr-accept-btn');
  const gdprRejectBtn = document.getElementById('gdpr-reject-btn');

  if (gdprBanner instanceof HTMLElement) {
    const savedConsent = window.localStorage.getItem(GDPR_STORAGE_KEY);
    if (!savedConsent) {
      gdprBanner.hidden = false;
    }

    if (gdprAcceptBtn instanceof HTMLButtonElement) {
      gdprAcceptBtn.addEventListener('click', () => {
        window.localStorage.setItem(GDPR_STORAGE_KEY, 'accepted_all');
        gdprBanner.hidden = true;
      });
    }

    if (gdprRejectBtn instanceof HTMLButtonElement) {
      gdprRejectBtn.addEventListener('click', () => {
        window.localStorage.setItem(GDPR_STORAGE_KEY, 'essential_only');
        gdprBanner.hidden = true;
      });
    }
  }

  // 7. Dialog Confirmare Post-Plată Stripe (?comanda=succes)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('comanda') === 'succes') {
    const successDialog = document.getElementById('order-success-dialog');
    const closeSuccessBtn = document.getElementById('close-success-dialog-btn');

    if (successDialog instanceof HTMLDialogElement) {
      successDialog.showModal();

      if (closeSuccessBtn instanceof HTMLButtonElement) {
        closeSuccessBtn.addEventListener('click', () => {
          successDialog.close();
        });
      }

      successDialog.addEventListener('click', (event) => {
        if (event.target === successDialog) {
          successDialog.close();
        }
      });

      // Curățăm discret parametrul din bară fără a reîncărca pagina
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, '', cleanUrl);
    }
  }
});
