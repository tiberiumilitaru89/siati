# Siati — Atelier Floral de Lux Ploiești & Blejoi

Platformă digitală modernă de e-commerce botanic și experiență de brand imersivă creată pentru **S.C. SIATI S.R.L.** (Atelier Ploiești Galeria Carrefour Mall & Blejoi DN1A).

---

## 🌸 Concepte Cheie de Arhitectură & Design

* **Viziune Vizuală:** Atelier Parizian Editorial combinat cu **Luxury Glassmorphism** (sticlă mată ivoire cu contururi fine aurii).
* **Parallax Scroll Zoom:** Fundal fixat de studio botanic cu scalare optică organică sincronizată cu derularea paginii (Zoom In spre inima florilor, Zoom Out spre recenzii și locații).
* **Stack Tehnic:**
  - **Framework:** [Astro 5](https://astro.build/) (Server-Side Rendering + Static Islands).
  - **Deploy:** [Cloudflare Pages](https://pages.cloudflare.com/) (Edge Network cu latență < 15ms în România).
  - **Bază de date & Catalog:** [Supabase PostgreSQL](https://supabase.com/) cu Row-Level Security (RLS) strict.
  - **Securitate & Conformitate:** Respectare strictă a normelor OWASP, WCAG 2.2 AA (contrast & prefers-reduced-motion), OUG 34/2014, GDPR și ANPC SAL/SOL.

---

## 📚 Documentație Internă (`docs/`)

* [Strategie de Brand & Direcție Vizuală pentru Loredana Novac](docs/PREZENTARE_BRAND_SIATI_LOREDANA_NOVAC.md)
* [Opțiuni Procesatori de Plată (Stripe / Netopia) & SPV ANAF e-Factura](docs/OPTIUNI_PROCESATORI_PLATA_SI_SPV_ANAF.md)

---

## 🚀 Comenzi de Dezvoltare

```bash
# Pornire mediu local de dezvoltare
npm run dev

# Rulare teste automate (231 teste unitare & de securitate)
npm run test

# Verificare completă Gatekeeper (TypeScript + Vitest + Astro Build)
npm run gatekeeper
```
