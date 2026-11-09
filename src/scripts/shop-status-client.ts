import { getShopStatus } from '../lib/shop-status';

/**
 * Menține insignele de program („Atelier Deschis…”) corecte după încărcarea paginii: serverul le randează deja cu
 * starea de la momentul cererii, iar aici le actualizăm la fiecare minut (o pagină poate rămâne deschisă ore în șir
 * sau poate fi servită dintr-un cache) și când tab-ul revine în prim-plan.
 */
function applyShopStatus(): void {
  const status = getShopStatus(new Date());
  document.querySelectorAll<HTMLElement>('[data-shop-status]').forEach((badge) => {
    if (badge.dataset.phase !== status.phase) {
      badge.dataset.phase = status.phase;
    }
    const label = badge.querySelector<HTMLElement>('[data-shop-status-label]');
    if (label && label.textContent !== status.label) {
      label.textContent = status.label;
    }
  });
}

applyShopStatus();
window.setInterval(applyShopStatus, 60_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    applyShopStatus();
  }
});
