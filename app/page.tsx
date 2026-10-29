import Link from "next/link";
import { Mark } from "@/components/shell/Mark";
import { getSessionUser } from "@/lib/session";
import { isInternal } from "@/lib/auth/rbac";
import { COPY, type Lang } from "./landing-content";
import { LangCookie } from "@/components/demo/LangCookie";

export const dynamic = "force-dynamic";
export const metadata = {
  title: { absolute: "Sentinel · ruang kerja risiko untuk payment aggregator" },
  description: "Pilih toko yang boleh menerima kartu, awasi setiap hari, bertindak sebelum rugi. Demo dengan data fiktif.",
};

/** Public landing page: what Sentinel is and why it exists, before anyone signs in. */
export default async function Landing({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const sp = await searchParams;
  const lang: Lang = sp.lang === "en" ? "en" : "id";
  const c = COPY[lang];
  const me = await getSessionUser();
  const signedIn = !!me && isInternal(me.role);
  const primary = signedIn ? { href: "/dashboard", label: c.nav.open } : { href: "/login", label: c.hero.cta };

  return (
    <div className="lp" lang={lang}>
      <header className="lp-top">
        <div className="lp-wrap lp-top-in">
          <Link href={lang === "en" ? "/?lang=en" : "/"} className="lp-brand" aria-label="Sentinel">
            <Mark size={26} />
            <span>Sentinel</span>
          </Link>
          <nav className="lp-nav" aria-label="Landing">
            <a href="#cara-kerja" className="lp-hide-sm">{c.nav.how}</a>
            <Link href={c.nav.langHref} hrefLang={lang === "en" ? "id" : "en"}>{c.nav.lang}</Link>
            <LangCookie lang={lang} />
            <Link className="btn primary" href={primary.href} data-testid="lp-nav-cta">{signedIn ? c.nav.open : c.nav.demo}</Link>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="lp-hero">
          <div className="lp-wrap lp-hero-grid">
            <div>
              <div className="lp-eyebrow">{c.hero.eyebrow}</div>
              <h1 className="lp-h1">{c.hero.title}</h1>
              <p className="lp-lead">{c.hero.sub}</p>
              <div className="lp-ctas">
                <Link className="btn primary lp-btn-lg" href={primary.href} data-testid="lp-cta">{primary.label}</Link>
                <a className="btn lp-btn-lg" href="#cara-kerja">{c.hero.cta2}</a>
              </div>
              <div className="meta" style={{ marginTop: 12 }}>{c.hero.note}</div>
            </div>
            <figure className="lp-shot lp-shot-hero">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/landing/merchant.webp" alt={lang === "id" ? "Profil toko di Sentinel: skor risiko per faktor, rasio Visa dan Mastercard, dan eksposur" : "A shop profile in Sentinel: risk score by factor, Visa and Mastercard ratios, and exposure"} width={1600} height={1000} />
            </figure>
          </div>
        </section>

        <section className="lp-section" aria-labelledby="lp-problem">
          <div className="lp-wrap">
            <div className="lp-kicker">{c.problem.kicker}</div>
            <h2 id="lp-problem" className="lp-h2">{c.problem.title}</h2>
            <p className="lp-body">{c.problem.body}</p>

            <ol className="lp-flow" aria-label={lang === "id" ? "Alur pembayaran kartu lewat aggregator" : "How a card payment flows through an aggregator"}>
              {c.problem.flow.map((n, i) => (
                <li key={n.t} className={`lp-node${"hl" in n && n.hl ? " hl" : ""}`}>
                  <span className="lp-node-t">{n.t}</span>
                  <span className="lp-node-d">{n.d}</span>
                  {i < c.problem.flow.length - 1 ? <span className="lp-arrow" aria-hidden>→</span> : null}
                </li>
              ))}
            </ol>
            <p className="lp-back" role="note">
              <span aria-hidden className="lp-back-mark">↩</span>
              {c.problem.back}
            </p>

            <div className="lp-cards3">
              {c.problem.risks.map((r) => (
                <div key={r.t} className="lp-card">
                  <h3>{r.t}</h3>
                  <p>{r.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section lp-alt" id="cara-kerja" aria-labelledby="lp-steps">
          <div className="lp-wrap">
            <div className="lp-kicker">{c.steps.kicker}</div>
            <h2 id="lp-steps" className="lp-h2">{c.steps.title}</h2>
            <ol className="lp-steps">
              {c.steps.items.map((s, i) => (
                <li key={s.t}>
                  <span className="lp-num" aria-hidden>{i + 1}</span>
                  <span>
                    <strong>{s.t}</strong>
                    <span className="lp-step-d">{s.d}</span>
                  </span>
                </li>
              ))}
            </ol>

            <div className="lp-shots">
              {c.shots.map((s) => (
                <figure key={s.src} className="lp-shot-card">
                  <div className="lp-shot">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.src} alt={s.t} width={1600} height={1000} loading="lazy" />
                  </div>
                  <figcaption>
                    <strong>{s.t}</strong>
                    <span>{s.d}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section" aria-labelledby="lp-why">
          <div className="lp-wrap">
            <div className="lp-kicker" id="lp-why">{c.why.kicker}</div>
            <div className="lp-cards2">
              {c.why.items.map((w) => (
                <div key={w.t} className="lp-card">
                  <h3>{w.t}</h3>
                  <p>{w.d}</p>
                </div>
              ))}
            </div>

            <div className="lp-kicker" style={{ marginTop: 48 }}>{c.people.kicker}</div>
            <ul className="lp-people">
              {c.people.items.map((p) => (
                <li key={p.n}>
                  <span className="lp-avatar" aria-hidden>{p.n[0]}</span>
                  <span>
                    <strong>{p.n}</strong> <span className="meta">· {p.r}</span>
                    <span className="lp-step-d">{p.d}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section lp-alt" aria-labelledby="lp-stories">
          <div className="lp-wrap">
            <div className="lp-kicker">{c.stories.kicker}</div>
            <h2 id="lp-stories" className="lp-h2">{c.stories.title}</h2>
            <p className="lp-body">{c.stories.sub}</p>
            <ol className="lp-stories">
              {c.stories.items.map((s) => (
                <li key={s.k}>
                  <span className="id lp-story-k">{s.k}</span>
                  <span>
                    <strong>{s.t}</strong>
                    <span className="lp-step-d">{s.d}</span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="lp-ctas">
              <Link className="btn primary lp-btn-lg" href={signedIn ? "/login?switch=1" : "/login"} data-testid="lp-stories-cta">{c.stories.cta}</Link>
              <Link className="btn lp-btn-lg" href="/guide">{c.guide}</Link>
            </div>
          </div>
        </section>

        <section className="lp-section" aria-labelledby="lp-faq">
          <div className="lp-wrap lp-narrow">
            <h2 id="lp-faq" className="lp-h2">{c.faq.kicker}</h2>
            <div className="lp-faq">
              {c.faq.items.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-top-in">
          <span className="lp-brand"><Mark size={20} /> <span className="meta">{c.footer}</span></span>
          <Link className="btn primary" href={primary.href}>{signedIn ? c.nav.open : c.nav.demo}</Link>
        </div>
      </footer>
    </div>
  );
}
