import React, { useEffect, useRef, useState } from 'react'
import nagoraLogo from '../assets/Nagora_logo.jpg'
import rhLogo from '../assets/logo_rh_manager.png'
import cmLogo from '../assets/logo.png'
import shotIdees from '../assets/idees.png'
import shotPosts from '../assets/posts.png'
import shotCalendrier from '../assets/calendrier.png'
import shotMediatheque from '../assets/mediatheque.png'

const EMAIL = 'gorasow026@gmail.com'
const LINKEDIN = 'https://www.linkedin.com/in/mak-gora-b7a6a2176'
const RH_URL = 'https://rhmanager.site'

const SHOTS = [
  { src: shotIdees, label: 'Idées de publications' },
  { src: shotPosts, label: 'Posts' },
  { src: shotCalendrier, label: 'Calendrier éditorial' },
  { src: shotMediatheque, label: 'Médiathèque' },
]

/* Apparition au défilement */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return }
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) { setSeen(true); io.disconnect() }
    }, { threshold: 0.12 })
    io.observe(el)
    const t = setTimeout(() => setSeen(true), 5000)
    return () => { io.disconnect(); clearTimeout(t) }
  }, [])
  return [ref, seen] as const
}

function Reveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const [ref, seen] = useInView<HTMLDivElement>()
  return <div ref={ref} className={`pf-rv ${seen ? 'in' : ''} ${className}`}>{children}</div>
}

/* Compteur animé */
function Count({ to, plus = false }: { to: number; plus?: boolean }) {
  const [ref, seen] = useInView<HTMLElement>()
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!seen) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(to); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min((t - t0) / 1500, 1)
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [seen, to])
  return <b ref={ref}>{v}{plus && v === to ? '+' : ''}</b>
}

export default function Portfolio() {
  const [copied, setCopied] = useState(false)
  const [barRef, barSeen] = useInView<HTMLDivElement>()

  const copy = async () => {
    try { await navigator.clipboard.writeText(EMAIL) }
    catch {
      const a = document.createElement('textarea'); a.value = EMAIL
      document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="pf">
      <style>{CSS}</style>

      {/* ───────── Présentation ───────── */}
      <section className="pf-hero">
        <div className="pf-orb o1" aria-hidden="true" />
        <div className="pf-orb o2" aria-hidden="true" />
        <div className="pf-wrap pf-hero-in">
          <div className="pf-eye">Portfolio</div>
          <h1 aria-label="Gora Mak Sow">
            <span>Gora</span> <span className="g">Mak</span> <span>Sow</span>
          </h1>
          <p className="pf-lead">Autodidacte, je crée des logiciels. J'ai appris la programmation seul, jusqu'à monter ma propre société, Nagora SARL.</p>
          <div className="pf-cta">
            <a className="pf-btn p" href={LINKEDIN} target="_blank" rel="noreferrer">Mon profil LinkedIn <span>↗</span></a>
            <a className="pf-btn" href={`mailto:${EMAIL}`}>Me contacter <span>→</span></a>
          </div>
        </div>
      </section>

      {/* ───────── Parcours ───────── */}
      <section className="pf-sec">
        <div className="pf-wrap">
          <Reveal>
            <div className="pf-eye">Qui je suis</div>
            <h2>Un parcours construit seul.</h2>
          </Reveal>
          <div className="pf-cols">
            <Reveal>
              <p>Ma formation de départ est le droit, avec un niveau Master. La programmation, je ne l'ai pas apprise à l'école : je me la suis enseignée moi-même, projet après projet.</p>
            </Reveal>
            <Reveal>
              <p>Cet apprentissage m'a mené jusqu'à créer ma société, Nagora SARL. J'ai aujourd'hui de nombreux logiciels, dont deux que je mets en avant ici : Agent CM et RH Manager.</p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ───────── Agent CM ───────── */}
      <section className="pf-sec alt">
        <div className="pf-wrap">
          <Reveal>
            <div className="pf-brandrow">
              <div className="pf-tile"><img src={cmLogo} alt="Logo Agent CM" /></div>
              <div>
                <div className="pf-eye">Logiciel</div>
                <h2 style={{ margin: '6px 0 0' }}>Agent CM</h2>
              </div>
            </div>
            <p className="pf-big">Mon community manager IA. Il apprend la marque, propose des idées, rédige les posts, prépare les visuels et programme les publications.</p>
          </Reveal>

          <div className="pf-cols">
            <Reveal>
              <h3 className="pf-h3">Ce qu'il fait</h3>
              <ul className="pf-list">
                <li>Analyse le site de la marque pour comprendre son identité et son ton.</li>
                <li>Propose des idées de publications.</li>
                <li>Rédige une version adaptée à chaque réseau.</li>
                <li>Fabrique les visuels et les vidéos.</li>
                <li>Programme les publications dans un calendrier éditorial.</li>
                <li>Suit les résultats pour s'améliorer.</li>
              </ul>
              <p className="pf-nets">LinkedIn · Facebook · Instagram · X · TikTok</p>
            </Reveal>
            <Reveal>
              <h3 className="pf-h3">Pourquoi je l'ai créé</h3>
              <p>Au départ, j'avais une version personnelle, utilisée uniquement pour LinkedIn. Elle m'a permis de publier plus de 87 posts et de faire passer mon compte de 150 à 1450 relations.</p>
              <p>Puis Nagora SARL a grandi. Il a fallu gérer son image et sa présence sur les réseaux sociaux. C'est comme ça que cet outil personnel est devenu Agent CM.</p>
            </Reveal>
          </div>

          <Reveal className="pf-nums">
            <div className="pf-num"><Count to={87} plus /><small>posts LinkedIn publiés</small></div>
            <div className="pf-num"><Count to={150} /><small>relations au départ</small></div>
            <div className="pf-num"><Count to={1450} /><small>relations après les posts</small></div>
          </Reveal>

          <div ref={barRef} className={`pf-bars ${barSeen ? 'in' : ''}`} role="img" aria-label="Relations LinkedIn : de 150 à 1450">
            <div className="pf-bar"><span>Avant</span><div className="pf-track"><div className="pf-fill a">150</div></div></div>
            <div className="pf-bar"><span>Après</span><div className="pf-track"><div className="pf-fill b">1450</div></div></div>
          </div>

          <Reveal className="pf-shots">
            {SHOTS.map(s => (
              <figure key={s.label} className="pf-shot">
                <div className="pf-img"><img src={s.src} alt={`Agent CM : ${s.label}`} loading="lazy" /></div>
                <figcaption>{s.label}</figcaption>
              </figure>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ───────── RH Manager ───────── */}
      <section className="pf-sec">
        <div className="pf-wrap">
          <Reveal>
            <div className="pf-brandrow">
              <div className="pf-tile"><img src={rhLogo} alt="Logo RH Manager" /></div>
              <div>
                <div className="pf-eye">Logiciel</div>
                <h2 style={{ margin: '6px 0 0' }}>RH Manager</h2>
              </div>
            </div>
            <p className="pf-big">Un logiciel de gestion des ressources humaines, proposé sous forme de portail entreprise.</p>
          </Reveal>
          <Reveal className="pf-chips">
            <span>Pointages</span>
            <span>Documents</span>
            <span>Visioconférence</span>
            <span>Messagerie interne chiffrée</span>
          </Reveal>
          <Reveal>
            <p style={{ marginTop: 24 }}>
              <a className="pf-btn p" href={RH_URL} target="_blank" rel="noreferrer">Voir rhmanager.site <span>↗</span></a>
            </p>
          </Reveal>
        </div>
      </section>

      {/* ───────── Nagora SARL ───────── */}
      <section className="pf-sec alt">
        <div className="pf-wrap">
          <Reveal>
            <div className="pf-brandrow">
              <div className="pf-tile"><img src={nagoraLogo} alt="Logo Nagora SARL" /></div>
              <div>
                <div className="pf-eye">Ma société</div>
                <h2 style={{ margin: '6px 0 0' }}>Nagora SARL</h2>
              </div>
            </div>
            <p className="pf-big">La société que j'ai montée après avoir appris la programmation par moi-même.</p>
          </Reveal>
        </div>
      </section>

      {/* ───────── Contact ───────── */}
      <section className="pf-sec">
        <div className="pf-wrap">
          <Reveal>
            <div className="pf-eye">Contact</div>
            <h2>Parlons-en.</h2>
            <div className="pf-mail">
              <span className="pf-addr">{EMAIL}</span>
              <button type="button" className="pf-cp" onClick={copy}>{copied ? 'Copié ✓' : 'Copier'}</button>
            </div>
            <div className="pf-cta" style={{ marginTop: 24 }}>
              <a className="pf-btn p" href={`mailto:${EMAIL}`}>Écrire un email <span>→</span></a>
              <a className="pf-btn" href={LINKEDIN} target="_blank" rel="noreferrer">LinkedIn <span>↗</span></a>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  )
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Inter:wght@400;500;600&display=swap');
.pf{
  --bg:#08100E; --bg2:#0D1915; --fg:#E8F2ED; --muted:#93AAA1; --line:#1C2D27;
  --accent:#34D8A4; --accent-ink:#04140E; --warm:#F2B33D; --card:#101E19;
  --d:'Bricolage Grotesque','Segoe UI',system-ui,sans-serif;
  background:var(--bg); color:var(--fg); min-height:100vh; overflow-x:hidden;
  font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif; font-size:17px; line-height:1.65;
}
.pf *{box-sizing:border-box}
.pf a{color:inherit}
.pf a:focus-visible,.pf button:focus-visible{outline:3px solid var(--accent);outline-offset:3px;border-radius:8px}
.pf-wrap{max-width:1000px;margin:0 auto;padding:0 20px}
.pf h1,.pf h2,.pf h3{font-family:var(--d);line-height:1.05;margin:0;letter-spacing:-.02em;text-wrap:balance}
.pf p{margin:0 0 1em;max-width:62ch;color:var(--muted)}
.pf-eye{font-size:.78rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.pf h2{font-size:clamp(2rem,5vw,3.2rem);font-weight:800;margin:10px 0 20px}
.pf-h3{font-size:1.3rem;font-weight:800;margin-bottom:12px!important}

.pf-hero{position:relative;overflow:hidden;padding:clamp(64px,11vw,130px) 0 clamp(56px,9vw,100px);border-bottom:1px solid var(--line)}
.pf-orb{position:absolute;border-radius:50%;filter:blur(70px);opacity:.5;pointer-events:none}
.pf-orb.o1{width:420px;height:420px;background:#0f8f6a;top:-140px;right:-100px;animation:pfFloat 9s ease-in-out infinite}
.pf-orb.o2{width:320px;height:320px;background:#8a5a00;bottom:-140px;left:-80px;opacity:.28;animation:pfFloat 11s ease-in-out infinite reverse}
@keyframes pfFloat{50%{transform:translate(-30px,34px) scale(1.12)}}
.pf-hero-in{position:relative;display:grid;gap:22px}
.pf-hero h1{font-size:clamp(3rem,11vw,7rem);font-weight:800}
.pf-hero h1 span{display:inline-block;animation:pfUp .9s cubic-bezier(.2,.8,.2,1) both}
.pf-hero h1 span:nth-child(2){animation-delay:.12s}
.pf-hero h1 span:nth-child(3){animation-delay:.24s}
.pf-hero h1 .g{color:var(--accent)}
@keyframes pfUp{from{opacity:0;transform:translateY(36px)}to{opacity:1;transform:none}}
.pf-lead{font-size:clamp(1.1rem,2.3vw,1.4rem);max-width:36ch;color:var(--fg)!important;animation:pfUp .9s .4s both}
.pf-cta{display:flex;gap:12px;flex-wrap:wrap}
.pf-hero .pf-cta{animation:pfUp .9s .55s both}
.pf-btn{display:inline-flex;align-items:center;gap:8px;padding:13px 22px;border-radius:999px;text-decoration:none;font-weight:600;border:1.5px solid var(--fg);transition:transform .2s,box-shadow .2s}
.pf-btn:hover{transform:translateY(-3px)}
.pf-btn.p{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.pf-btn.p:hover{box-shadow:0 10px 30px -8px rgba(52,216,164,.7)}
.pf-btn span{transition:transform .2s}.pf-btn:hover span{transform:translateX(4px)}

.pf-sec{padding:clamp(52px,8vw,92px) 0}
.pf-sec.alt{background:var(--bg2);border-block:1px solid var(--line)}
.pf-cols{display:grid;grid-template-columns:1fr 1fr;gap:clamp(20px,4vw,48px);margin-top:8px}
.pf-cols>*{min-width:0}
.pf-big{font-size:clamp(1.1rem,2.2vw,1.35rem);color:var(--fg)!important;max-width:44ch!important;margin-top:18px!important}
.pf-brandrow{display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.pf-tile{display:inline-flex;background:#fff;border-radius:18px;padding:12px}
.pf-tile img{display:block;height:68px;width:auto;max-width:160px;object-fit:contain}
.pf-list{margin:0 0 14px;padding-left:1.2em;color:var(--muted)}
.pf-list li{margin-bottom:6px}
.pf-nets{font-size:.88rem;font-weight:600;letter-spacing:.06em;color:var(--accent)!important}

.pf-nums{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-top:36px}
.pf-num{border:1px solid var(--line);background:var(--card);border-radius:18px;padding:22px}
.pf-num b{display:block;font-family:var(--d);font-size:clamp(2.6rem,6vw,3.6rem);line-height:1;font-weight:800;color:var(--accent);font-variant-numeric:tabular-nums}
.pf-num small{display:block;margin-top:8px;color:var(--muted);font-size:.95rem}
.pf-bars{display:grid;gap:14px;margin-top:16px;border:1px solid var(--line);background:var(--card);border-radius:18px;padding:22px}
.pf-bar{display:grid;grid-template-columns:70px 1fr;gap:14px;align-items:center}
.pf-bar>span{font-size:.9rem;color:var(--muted)}
.pf-track{height:34px;border-radius:999px;background:var(--bg2);overflow:hidden}
.pf-fill{height:100%;width:0;border-radius:999px;display:flex;align-items:center;justify-content:flex-end;padding-right:12px;font-weight:700;font-size:.9rem;color:var(--accent-ink);transition:width 1.6s cubic-bezier(.2,.8,.2,1)}
.pf-fill.a{background:var(--warm);min-width:56px}
.pf-fill.b{background:var(--accent)}
.pf-bars.in .pf-fill.a{width:10.34%}
.pf-bars.in .pf-fill.b{width:100%}

.pf-shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:36px}
.pf-shot{margin:0;min-width:0}
.pf-img{overflow:hidden;border-radius:14px;border:1px solid var(--line);background:var(--card)}
.pf-img img{display:block;width:100%;height:auto;transition:transform .5s cubic-bezier(.2,.8,.2,1)}
.pf-shot:hover .pf-img img{transform:scale(1.05)}
.pf-shot figcaption{margin-top:8px;font-size:.85rem;color:var(--muted)}

.pf-chips{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}
.pf-chips span{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:8px 16px;font-weight:600;font-size:.95rem}

.pf-mail{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.pf-addr{font-family:var(--d);font-weight:800;font-size:clamp(1.3rem,4.4vw,2.3rem);word-break:break-all;user-select:all}
.pf-cp{cursor:pointer;font:inherit;font-size:.9rem;font-weight:600;padding:8px 16px;border-radius:999px;border:1.5px solid var(--fg);background:transparent;color:var(--fg)}
.pf-cp:hover{background:var(--fg);color:var(--bg)}

.pf-rv{opacity:0;transform:translateY(28px);transition:opacity .8s ease,transform .8s cubic-bezier(.2,.8,.2,1)}
.pf-rv.in{opacity:1;transform:none}

@media (max-width:760px){
  .pf-cols{grid-template-columns:1fr}
  .pf-bar{grid-template-columns:1fr;gap:6px}
}
@media (prefers-reduced-motion:reduce){
  .pf *,.pf *::after{animation:none!important;transition:none!important}
  .pf-rv{opacity:1;transform:none}
  .pf-fill.a{width:10.34%}.pf-fill.b{width:100%}
}
`