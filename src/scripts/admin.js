// @ts-check

/**
 * Comprimă orice fotografie (JPG, PNG, WebP) direct în browser folosind un Canvas nativ.
 * Convertește la max 1200px și format WebP (calitate 0.84), reducând un fișier de 8 MB la ~120 KB.
 * @param {File} file
 * @returns {Promise<Blob>}
 */
async function compressImageClientSide(file) {
  return new Promise((resolve) => {
    // Dacă e deja un WebP mic (sub 250 KB), nu mai e nevoie de compresie
    if (file.type === 'image/webp' && file.size < 256 * 1024) {
      resolve(file);
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxDim = 1200;
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve(file);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob && blob.size > 0) {
            resolve(blob);
          } else {
            resolve(file);
          }
        },
        'image/webp',
        0.84
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}

/**
 * Încarcă o fotografie în `/api/admin/upload` (optimizată automat pe client).
 * @param {File} file
 * @returns {Promise<{ ok: boolean, imageUrl?: string, message: string }>}
 */
async function uploadAdminPhoto(file) {
  const optimizedBlob = await compressImageClientSide(file);
  const webpFileName = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.webp';
  const uploadFile = new File([optimizedBlob], webpFileName, { type: 'image/webp' });

  const formData = new FormData();
  formData.append('photo', uploadFile);

  const response = await fetch('/api/admin/upload', {
    method: 'POST',
    body: formData,
  });

  const payload = await response.json();
  if (!response.ok) {
    return {
      ok: false,
      message: payload?.detail ?? 'Eroare la încărcarea fotografiei.',
    };
  }

  return {
    ok: true,
    imageUrl: payload.imageUrl,
    message: payload.message ?? 'Fotografie încărcată!',
  };
}

/**
 * Afișează un mesaj de feedback în panoul de administrare.
 * @param {HTMLElement | null} el
 * @param {'success' | 'error'} state
 * @param {string} message
 */
function showAdminFeedback(el, state, message) {
  if (!el) {
    return;
  }
  el.hidden = false;
  el.dataset.state = state;
  el.textContent = message;
}

document.addEventListener('DOMContentLoaded', () => {
  // 1. Autentificare cu parolă în /admin
  const loginForm = document.getElementById('admin-login-form');
  const passwordInput = document.getElementById('admin-password');
  const loginFeedback = document.getElementById('admin-login-feedback');
  const loginSubmitBtn = document.getElementById('admin-login-submit');

  if (loginForm instanceof HTMLFormElement && passwordInput instanceof HTMLInputElement) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (loginSubmitBtn instanceof HTMLButtonElement) {
        loginSubmitBtn.disabled = true;
        loginSubmitBtn.textContent = 'Se verifică parola...';
      }

      try {
        const res = await fetch('/api/admin/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: passwordInput.value }),
        });

        const data = await res.json();
        if (!res.ok) {
          showAdminFeedback(
            loginFeedback,
            'error',
            data?.detail ?? 'Parola introdusă este incorectă.'
          );
          if (loginSubmitBtn instanceof HTMLButtonElement) {
            loginSubmitBtn.disabled = false;
            loginSubmitBtn.textContent = 'Intră în Panoul de Administrare';
          }
          return;
        }

        showAdminFeedback(loginFeedback, 'success', 'Autentificare reușită! Se încarcă panoul...');
        window.location.reload();
      } catch {
        showAdminFeedback(loginFeedback, 'error', 'Eroare de conexiune cu serverul.');
        if (loginSubmitBtn instanceof HTMLButtonElement) {
          loginSubmitBtn.disabled = false;
          loginSubmitBtn.textContent = 'Intră în Panoul de Administrare';
        }
      }
    });
  }

  // 2. Logout
  const logoutBtn = document.getElementById('admin-logout-btn');
  if (logoutBtn instanceof HTMLButtonElement) {
    logoutBtn.addEventListener('click', async () => {
      await fetch('/api/admin/auth', { method: 'DELETE' });
      window.location.reload();
    });
  }

  // 3. Upload Fotografie pentru Oferta Săptămânii
  const woFileInput = document.getElementById('weekly-offer-file-input');
  const woImageUrlInput = document.getElementById('wo-image-url');
  const woPreviewImg = document.getElementById('weekly-offer-preview-img');
  const woUploadStatus = document.getElementById('weekly-offer-upload-status');

  if (woFileInput instanceof HTMLInputElement) {
    woFileInput.addEventListener('change', async () => {
      const file = woFileInput.files?.[0];
      if (!file) {
        return;
      }
      if (woUploadStatus) {
        woUploadStatus.textContent = 'Se optimizează fotografia în format WebP...';
      }
      const result = await uploadAdminPhoto(file);
      if (result.ok && result.imageUrl) {
        if (woImageUrlInput instanceof HTMLInputElement) {
          woImageUrlInput.value = result.imageUrl;
        }
        if (woPreviewImg instanceof HTMLImageElement) {
          woPreviewImg.src = result.imageUrl;
        }
        if (woUploadStatus) {
          woUploadStatus.textContent = `✅ ${result.message}`;
        }
      } else if (woUploadStatus) {
        woUploadStatus.textContent = `❌ ${result.message}`;
      }
    });
  }

  // 4. Salvare „Oferta Săptămânii”
  const weeklyOfferForm = document.getElementById('weekly-offer-form');
  const woTitleInput = document.getElementById('wo-title');
  const woPriceInput = document.getElementById('wo-price-ron');
  const woDescInput = document.getElementById('wo-desc');
  const woActiveInput = document.getElementById('wo-is-active');
  const woFeedback = document.getElementById('weekly-offer-feedback');
  const woSaveBtn = document.getElementById('weekly-offer-save-btn');

  if (weeklyOfferForm instanceof HTMLFormElement) {
    weeklyOfferForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (woSaveBtn instanceof HTMLButtonElement) {
        woSaveBtn.disabled = true;
        woSaveBtn.textContent = 'Se salvează...';
      }

      try {
        const res = await fetch('/api/admin/catalog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update_weekly_offer',
            title: woTitleInput instanceof HTMLInputElement ? woTitleInput.value : '',
            priceRon: woPriceInput instanceof HTMLInputElement ? woPriceInput.value : '190',
            description: woDescInput instanceof HTMLTextAreaElement ? woDescInput.value : '',
            imageUrl: woImageUrlInput instanceof HTMLInputElement ? woImageUrlInput.value : '',
            isActive: woActiveInput instanceof HTMLInputElement ? woActiveInput.checked : true,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          showAdminFeedback(woFeedback, 'error', data?.detail ?? 'Eroare la salvarea ofertei.');
        } else {
          showAdminFeedback(
            woFeedback,
            'success',
            data?.message ?? 'Oferta Săptămânii a fost actualizată!'
          );
        }
      } catch {
        showAdminFeedback(woFeedback, 'error', 'Conexiunea cu serverul a eșuat.');
      } finally {
        if (woSaveBtn instanceof HTMLButtonElement) {
          woSaveBtn.disabled = false;
          woSaveBtn.textContent = '💾 Salvează Oferta Săptămânii pe Site';
        }
      }
    });
  }

  // 5. Upload & Adăugare Produs Nou
  const newProdFileInput = document.getElementById('new-prod-file-input');
  const newProdImageInput = document.getElementById('new-prod-image');
  const createProductForm = document.getElementById('create-product-form');
  const createProductFeedback = document.getElementById('create-product-feedback');
  const createProductBtn = document.getElementById('create-product-btn');

  if (newProdFileInput instanceof HTMLInputElement) {
    newProdFileInput.addEventListener('change', async () => {
      const file = newProdFileInput.files?.[0];
      if (!file) {
        return;
      }
      const result = await uploadAdminPhoto(file);
      if (result.ok && result.imageUrl && newProdImageInput instanceof HTMLInputElement) {
        newProdImageInput.value = result.imageUrl;
        showAdminFeedback(
          createProductFeedback,
          'success',
          'Fotografia a fost încărcată! Apasă pe „Adaugă Produsul în Site” pentru a finaliza.'
        );
      } else {
        showAdminFeedback(createProductFeedback, 'error', result.message);
      }
    });
  }

  if (createProductForm instanceof HTMLFormElement) {
    createProductForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const nameEl = document.getElementById('new-prod-name');
      const catEl = document.getElementById('new-prod-category');
      const priceEl = document.getElementById('new-prod-price');
      const badgeEl = document.getElementById('new-prod-badge');
      const descEl = document.getElementById('new-prod-desc');

      if (createProductBtn instanceof HTMLButtonElement) {
        createProductBtn.disabled = true;
        createProductBtn.textContent = 'Se adaugă produsul...';
      }

      try {
        const res = await fetch('/api/admin/catalog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_product',
            name: nameEl instanceof HTMLInputElement ? nameEl.value : '',
            category: catEl instanceof HTMLSelectElement ? catEl.value : 'buchete',
            priceRon: priceEl instanceof HTMLInputElement ? priceEl.value : '190',
            badge: badgeEl instanceof HTMLInputElement ? badgeEl.value : '',
            imageUrl: newProdImageInput instanceof HTMLInputElement ? newProdImageInput.value : '',
            description: descEl instanceof HTMLTextAreaElement ? descEl.value : '',
            inStock: true,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          showAdminFeedback(
            createProductFeedback,
            'error',
            data?.detail ?? 'Nu am putut adăuga produsul.'
          );
        } else {
          showAdminFeedback(
            createProductFeedback,
            'success',
            data?.message ?? 'Produs adăugat! Pagina se reîncarcă...'
          );
          setTimeout(() => window.location.reload(), 800);
        }
      } catch {
        showAdminFeedback(createProductFeedback, 'error', 'Eroare de rețea.');
      } finally {
        if (createProductBtn instanceof HTMLButtonElement) {
          createProductBtn.disabled = false;
          createProductBtn.textContent = '➕ Adaugă Produsul în Site';
        }
      }
    });
  }

  // 6. Filtrare Produse pe Rubrici în Panoul Admin
  const filterBtns = document.querySelectorAll('.admin-filter-btn');
  const adminProductCards = document.querySelectorAll('.admin-product-card');

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!(btn instanceof HTMLButtonElement)) {
        return;
      }
      const filter = btn.dataset.filter ?? 'all';
      filterBtns.forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');

      adminProductCards.forEach((card) => {
        if (!(card instanceof HTMLElement)) {
          return;
        }
        const cat = card.dataset.category ?? '';
        card.hidden = !(filter === 'all' || cat === filter);
      });
    });
  });

  // 7. Editare Preț, Poză, Descriere & Stoc pe Fiecare Card de Produs
  adminProductCards.forEach((card) => {
    if (!(card instanceof HTMLElement)) {
      return;
    }
    const productId = card.dataset.productId ?? '';
    const fileInput = card.querySelector('.prod-file-input');
    const previewImg = card.querySelector('.prod-preview-img');
    const nameInput = card.querySelector('.prod-name-input');
    const priceInput = card.querySelector('.prod-price-input');
    const categoryInput = card.querySelector('.prod-category-input');
    const badgeInput = card.querySelector('.prod-badge-input');
    const imageInput = card.querySelector('.prod-image-input');
    const descInput = card.querySelector('.prod-desc-input');
    const stockInput = card.querySelector('.prod-stock-input');
    const feedbackEl = card.querySelector('.prod-card-feedback');
    const saveBtn = card.querySelector('.save-product-btn');
    const deleteBtn = card.querySelector('.delete-product-btn');

    if (fileInput instanceof HTMLInputElement) {
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) {
          return;
        }
        if (feedbackEl instanceof HTMLElement) {
          showAdminFeedback(feedbackEl, 'success', 'Se încarcă și se optimizează poza...');
        }
        const result = await uploadAdminPhoto(file);
        if (result.ok && result.imageUrl) {
          if (imageInput instanceof HTMLInputElement) {
            imageInput.value = result.imageUrl;
          }
          if (previewImg instanceof HTMLImageElement) {
            previewImg.src = result.imageUrl;
          }
          if (feedbackEl instanceof HTMLElement) {
            showAdminFeedback(
              feedbackEl,
              'success',
              'Poza a fost încărcată! Apasă „Salvează Modificarea”.'
            );
          }
        } else if (feedbackEl instanceof HTMLElement) {
          showAdminFeedback(feedbackEl, 'error', result.message);
        }
      });
    }

    if (saveBtn instanceof HTMLButtonElement) {
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Se salvează...';

        try {
          const res = await fetch('/api/admin/catalog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'update_product',
              id: productId,
              name: nameInput instanceof HTMLInputElement ? nameInput.value : '',
              priceRon: priceInput instanceof HTMLInputElement ? priceInput.value : '190',
              category: categoryInput instanceof HTMLSelectElement ? categoryInput.value : 'buchete',
              badge: badgeInput instanceof HTMLInputElement ? badgeInput.value : '',
              imageUrl: imageInput instanceof HTMLInputElement ? imageInput.value : '',
              description: descInput instanceof HTMLTextAreaElement ? descInput.value : '',
              inStock: stockInput instanceof HTMLInputElement ? stockInput.checked : true,
            }),
          });

          const data = await res.json();
          if (feedbackEl instanceof HTMLElement) {
            if (!res.ok) {
              showAdminFeedback(feedbackEl, 'error', data?.detail ?? 'Eroare la salvare.');
            } else {
              showAdminFeedback(feedbackEl, 'success', data?.message ?? 'Salvat pe site!');
              card.dataset.category =
                categoryInput instanceof HTMLSelectElement ? categoryInput.value : 'buchete';
            }
          }
        } catch {
          if (feedbackEl instanceof HTMLElement) {
            showAdminFeedback(feedbackEl, 'error', 'Eroare de conexiune.');
          }
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = '💾 Salvează Modificarea';
        }
      });
    }

    if (deleteBtn instanceof HTMLButtonElement) {
      deleteBtn.addEventListener('click', async () => {
        const prodName = nameInput instanceof HTMLInputElement ? nameInput.value : 'acest produs';
        if (!window.confirm(`Sigur dorești să ștergi „${prodName}” din catalog?`)) {
          return;
        }
        deleteBtn.disabled = true;
        try {
          const res = await fetch('/api/admin/catalog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'delete_product',
              id: productId,
            }),
          });
          if (res.ok) {
            card.remove();
          } else if (feedbackEl instanceof HTMLElement) {
            showAdminFeedback(feedbackEl, 'error', 'Produsul nu a putut fi șters.');
          }
        } finally {
          deleteBtn.disabled = false;
        }
      });
    }
  });

  // 8. Trimitere Manuală Raport Săptămânal / Închidere Lunară din Panoul Admin
  const triggerWeeklyBtn = document.getElementById('trigger-weekly-report-btn');
  const triggerMonthlyBtn = document.getElementById('trigger-monthly-report-btn');
  const reportsFeedback = document.getElementById('reports-dispatch-feedback');

  if (triggerWeeklyBtn instanceof HTMLButtonElement) {
    triggerWeeklyBtn.addEventListener('click', async () => {
      triggerWeeklyBtn.disabled = true;
      triggerWeeklyBtn.textContent = 'Se generează raportul săptămânal...';
      try {
        const res = await fetch('/api/cron/weekly-digest?dispatch=true', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
          showAdminFeedback(
            reportsFeedback,
            'success',
            `✅ Raport Săptămânal generat (${data.orders_count} comenzi | ${data.total_revenue}) pentru ${data.recipient_email}!`
          );
        } else {
          showAdminFeedback(
            reportsFeedback,
            'error',
            data?.detail ?? 'Nu am putut genera raportul săptămânal.'
          );
        }
      } catch {
        showAdminFeedback(reportsFeedback, 'error', 'Eroare de conexiune la generarea raportului.');
      } finally {
        triggerWeeklyBtn.disabled = false;
        triggerWeeklyBtn.textContent = '📧 Trimite Acum pe contact@floraria-siati.ro';
      }
    });
  }

  if (triggerMonthlyBtn instanceof HTMLButtonElement) {
    triggerMonthlyBtn.addEventListener('click', async () => {
      triggerMonthlyBtn.disabled = true;
      triggerMonthlyBtn.textContent = 'Se generează închiderea lunară...';
      try {
        const res = await fetch('/api/cron/monthly-closing?dispatch=true', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
          showAdminFeedback(
            reportsFeedback,
            'success',
            `✅ Închidere Lunară (${data.period_label}) generată (${data.invoiced_spv_count} facturi SPV | Total: ${data.total_revenue} | TVA 19%: ${data.estimated_vat_19}) către ${data.recipient_email}!`
          );
        } else {
          showAdminFeedback(
            reportsFeedback,
            'error',
            data?.detail ?? 'Nu am putut genera raportul lunar.'
          );
        }
      } catch {
        showAdminFeedback(reportsFeedback, 'error', 'Eroare de conexiune la generarea raportului lunar.');
      } finally {
        triggerMonthlyBtn.disabled = false;
        triggerMonthlyBtn.textContent = '📧 Trimite Raportul Lunar pe Email';
      }
    });
  }

  // 9. Copiere Mesaj Felicitare Cadou în Clipboard
  const copyGreetingButtons = document.querySelectorAll('.copy-greeting-btn');
  copyGreetingButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(btn instanceof HTMLButtonElement)) {
        return;
      }
      const text = btn.dataset.greeting ?? '';
      if (!text) {
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        const originalText = btn.textContent;
        btn.textContent = '✅ Copiat!';
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      } catch {
        window.prompt('Copiază textul felicitării:', text);
      }
    });
  });
});
