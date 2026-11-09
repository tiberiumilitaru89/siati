# Ghid Arhitectural: Opțiuni Procesatori de Plată și SPV ANAF
**Proiect:** S.C. SIATI S.R.L. | **Data:** Noiembrie 2026

Acest document sumarizează opțiunile tehnice de plată și facturare automată pentru momentul când decizi integrarea finală.

---

## 1. Comparație Procesatori de Plată cu Cardul

| Criteriu | **Stripe (Recomandat Global)** | **Netopia Payments (MobilPay)** | **EuPlătesc.ro** |
| :--- | :--- | :--- | :--- |
| **Comisioane Medii** | ~1.4% + 1.00 RON (carduri SEE) | ~0.9% – 1.25% (negociabil la volum) | ~1.0% – 1.4% |
| **Apple Pay / Google Pay** | Nativ 1-click din primul minut | Disponibil, necesită configurare separată | Disponibil, flux clasic |
| **Experiență Checkout** | Fără redirecționare (in-page/embedded) | Redirecționare pe pagina băncii | Redirecționare pe pagina EuPlatesc |
| **Integrare Tehnică** | Webhook-uri idempotente de clasă mondială | API SOAP/REST mai rigid | API clasic |
| **Monede** | RON, EUR, USD nativ automat | RON prioritar | RON prioritar |
| **Timp de Activare** | 10 minute online cu CUI și IBAN | 3–7 zile lucrătoare (contract semnat) | 3–5 zile lucrătoare |

> [!TIP]
> **Recomandarea Arhitectului:** Pentru un magazin axat pe mobil și comenzi rapide de flori, **Stripe** oferă cea mai mare rată de conversie datorită **Apple Pay / Google Pay nativ** (utilizatorul plătește cu amprenta/FaceID în 3 secunde, fără să-și caute cardul prin casă).

---

## 2. Integrare Facturare Automată & SPV ANAF (e-Factura)

Conform legislației din România, fiecare comandă achitată necesită transmiterea automată în SPV (Sistemul Național e-Factura B2C/B2B).

### Opțiunea 1: SmartBill Cloud API (Recomandat)
* **Cum funcționează:** Când webhook-ul de plată (Stripe sau Netopia) confirmă tranzacția cu succes, backend-ul apelează API-ul SmartBill.
* **Ce face automat:**
  1. Emite factura fiscală în serie `SIA`.
  2. Aplică automat cota de TVA corectă (19% flori/servicii, 9% plante vii).
  3. Transmite factura direct în SPV ANAF prin token-ul OAuth ANAF conectat în SmartBill.
  4. Trimite PDF-ul facturii pe email-ul cumpărătorului prin Resend.
* **Cost:** Inclus în abonamentul SmartBill Cloud Facturare.

### Opțiunea 2: FGO API
* Funcționalități similare cu SmartBill, suportă transmitere automată e-Factura SPV.
* Alegerea între SmartBill și FGO depinde exclusiv de programul pe care îl folosește deja contabila firmei.

---

## 3. Comenzi pe WhatsApp (Soluția Fără Comisioane Bancare)
Pentru clienții tradiționali din Ploiești care preferă plata la livrare (ramburs) sau transfer bancar:
* Selectorul de buget WhatsApp din site generează mesajul pre-completat:
  `Bună ziua! Doresc să comand buchetul X (Preț Y RON). Livrare în Ploiești.`
* Operatorul Siati trimite poza buchetului real înainte de expediere și emite bonul/factura la casă.
