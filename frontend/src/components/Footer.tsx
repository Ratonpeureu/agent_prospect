import React, { useEffect, useId, useRef, useState } from 'react'

export const DONATION = {
  phone: '+221784788015',
  display: '+221 78 478 80 15',
  waveLink: '',
}

const SPOTIFY_SRC = 'https://open.spotify.com/embed/playlist/7kT2EnaROEpfXiy2tmFMJQ?utm_source=generator&si=bf4fa99a00e54720'

const MESSAGES = [
  'Cet outil est développé avec passion, pour toi.',
  'Un café = une nouvelle fonctionnalité en route.',
  'Chaque soutien aide à garder l\'outil vivant et gratuit.',
  'Merci d\'utiliser Agent Social. Ça fait vraiment plaisir.',
]

const TICKER = ['Free Palestine', 'حرية', 'Liberté', 'Justice', 'سلام', 'Paix', 'Freedom', 'Solidarité']
const STRIP = ['#000', '#fff', '#149954', '#e4312b']

function useDakarClock() {
  const fmt = () => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Dakar', hour: '2-digit', minute: '2-digit' }).format(new Date())
  const [t, setT] = useState(fmt)
  useEffect(() => { const i = setInterval(() => setT(fmt()), 20000); return () => clearInterval(i) }, [])
  return t
}

export function CoffeeCup({ size = 28 }: { size?: number }) {
  return (
    <svg className="ft-cup" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path className="ft-steam s1" d="M11 9c-1.5-1.6 1.5-3 0-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path className="ft-steam s2" d="M16 9c-1.5-1.6 1.5-3 0-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path className="ft-steam s3" d="M21 9c-1.5-1.6 1.5-3 0-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M6 12h18v6a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8v-6z" fill="currentColor" />
      <path d="M24 14h2.5a3.5 3.5 0 0 1 0 7H23.4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

function BriefcaseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="7" width="18" height="13" rx="2.5" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M3 13h18" />
      <path d="M10.5 13v1.5h3V13" />
    </svg>
  )
}

/* ═════════════════════ Panneau FREE PALESTINE ═════════════════════ */
function PalestinePanel() {
  const id = useId().replace(/:/g, '')
  const ref = useRef<HTMLDivElement>(null)

  // Le drapeau suit légèrement la souris (effet de profondeur)
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width - 0.5) * 2
    const y = ((e.clientY - r.top) / r.height - 0.5) * 2
    el.style.setProperty('--mx', x.toFixed(3))
    el.style.setProperty('--my', y.toFixed(3))
  }
  const onLeave = () => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--mx', '0')
    el.style.setProperty('--my', '0')
  }

  return (
    <div ref={ref} className="fx-pal" role="img" aria-label="Free Palestine" onMouseMove={onMove} onMouseLeave={onLeave}>
      {/* Drapeau : filtre calculé une seule fois, mouvement fluide en CSS */}
      <div className="fx-flagwrap" aria-hidden="true">
        <svg className="fx-flag" viewBox="0 0 300 150" preserveAspectRatio="none">
          <defs>
            <filter id={`wave-${id}`} x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency="0.008 0.02" numOctaves="2" seed="3" />
              <feDisplacementMap in="SourceGraphic" scale="14" />
            </filter>
            <pattern id={`kef-${id}`} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <path d="M0 6h12M6 0v12" stroke="#fff" strokeWidth="0.6" />
              <circle cx="6" cy="6" r="1.4" fill="none" stroke="#fff" strokeWidth="0.6" />
            </pattern>
          </defs>
          <g filter={`url(#wave-${id})`}>
            <rect x="0" y="0" width="300" height="50" fill="#111" />
            <rect x="0" y="50" width="300" height="50" fill="#f4f4f4" />
            <rect x="0" y="100" width="300" height="50" fill="#149954" />
            <polygon points="0,0 115,75 0,150" fill="#e4312b" />
            <rect x="0" y="0" width="300" height="150" fill={`url(#kef-${id})`} opacity="0.12" />
          </g>
        </svg>
      </div>

      <div className="fx-shade" aria-hidden="true" />
      <div className="fx-sweep" aria-hidden="true" />

      {/* Titre fixe, sans animation */}
      <div className="fx-title">
        <span className="fx-word">Free</span>
        <span className="fx-word">Palestine</span>
      </div>

      {/* Bandeau défilant */}
      <div className="fx-ticker" aria-hidden="true">
        <div className="fx-marquee">
          {[0, 1].map(dup => (
            <span key={dup} className="fx-tgrp">
              {TICKER.map((w, k) => (
                <span key={k} className="fx-titem">
                  <span className="fx-tw">{w}</span>
                  <span className={`fx-dia d${k % 3}`} />
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ═════════════════════ Footer ═════════════════════ */
export function Footer({ onDonate }: { onDonate: () => void }) {
  const [i, setI] = useState(0)
  const clock = useDakarClock()
  const [reduce] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    if (reduce) return
    const t = setInterval(() => setI(n => (n + 1) % MESSAGES.length), 4000)
    return () => clearInterval(t)
  }, [reduce])

  return (
    <footer className="fx">
      <style>{FX_CSS}</style>

      {/* Bande aux couleurs du drapeau qui défile */}
      <div className="fx-strip" aria-hidden="true">
        <div className="fx-flow">
          {Array.from({ length: 16 }).map((_, k) => (
            <span key={k} style={{ background: STRIP[k % 4] }} />
          ))}
        </div>
      </div>

      <div className="fx-in">
        {/* Gauche : marque */}
        <div className="fx-brand">
          <div className="fx-head">
            <div className="fx-logo">S</div>
            <h3>Agent Social</h3>
            <span className="fx-clock">
              <span className="fx-ping"><i /><b /></span>
              Dakar {clock}
            </span>
          </div>

          <div className="fx-msgbox">
            <p key={i} className="fx-msg">{MESSAGES[i]}</p>
          </div>

          <div className="fx-actions">
            <button type="button" className="fx-donate" onClick={onDonate}>
              <CoffeeCup size={20} />
              <span>Offrir un café</span>
              <i className="fx-shine" aria-hidden="true" />
            </button>
            <span className="fx-pill wave">Wave</span>
            <span className="fx-pill om">Orange Money</span>
            <a href="/portfolio" className="fx-port" title="Portfolio de Gora Mak Sow" aria-label="Portfolio de Gora Mak Sow">
              <BriefcaseIcon size={18} />
            </a>
          </div>
        </div>

        {/* Centre : Free Palestine */}
        <PalestinePanel />

        {/* Droite : playlist */}
        <div className="fx-play">
          <div className="fx-label">
            <span className="fx-eq" aria-hidden="true"><i /><i /><i /><i /></span>
            <span className="fx-ltxt">Ma playlist pendant que tu travailles</span>
          </div>
          <div className="fx-frame">
            <iframe
              title="Playlist Spotify"
              data-testid="embed-iframe"
              src={SPOTIFY_SRC}
              frameBorder="0"
              allowFullScreen
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
            />
          </div>
        </div>
      </div>
    </footer>
  )
}

const FX_CSS = `
.fx{position:relative;overflow:hidden;background:#0b0b0d;color:#fff;padding:16px 0;font-family:inherit}
.fx *{box-sizing:border-box}

.fx-strip{position:absolute;left:0;right:0;top:0;height:3px;overflow:hidden}
.fx-flow{display:flex;width:200%;height:100%;animation:fx-flow 10s linear infinite}
.fx-flow span{flex:1;height:100%}
@keyframes fx-flow{from{transform:translateX(0)}to{transform:translateX(-50%)}}

.fx-in{max-width:1400px;width:100%;margin:0 auto;padding:0 32px;display:flex;align-items:center;justify-content:space-between;gap:48px}

/* gauche */
.fx-brand{width:390px;flex:none;min-width:0;display:flex;flex-direction:column;gap:8px}
.fx-head{display:flex;align-items:center;gap:10px}
.fx-logo{width:40px;height:40px;border-radius:8px;background:#fff;color:#0b0b0d;display:grid;place-items:center;font-size:1.1rem;font-weight:900;transition:transform .16s cubic-bezier(.23,1,.32,1)}
.fx-logo:hover{transform:rotate(-8deg) scale(1.06)}
.fx-head h3{margin:0;font-size:1.1rem;font-weight:700;line-height:1;color:#fff}
.fx-clock{margin-left:auto;display:flex;align-items:center;gap:6px;white-space:nowrap;border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:2px 8px;font-size:11px;color:#9aa0a6}
.fx-ping{position:relative;display:flex;width:6px;height:6px}
.fx-ping i{position:absolute;inset:0;border-radius:50%;background:#1ed760;animation:fx-ping 1.6s ease-out infinite}
.fx-ping b{position:relative;width:6px;height:6px;border-radius:50%;background:#1ed760}
@keyframes fx-ping{0%{transform:scale(1);opacity:.8}100%{transform:scale(3);opacity:0}}

.fx-msgbox{position:relative;height:40px;overflow:hidden}
.fx-msg{margin:0;font-size:13px;line-height:1.35;color:#9aa0a6;animation:fx-msg .28s cubic-bezier(.23,1,.32,1) both}
@keyframes fx-msg{from{opacity:0;transform:translateY(10px);filter:blur(4px)}to{opacity:1;transform:none;filter:blur(0)}}

.fx-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.fx-donate{position:relative;display:flex;align-items:center;gap:8px;height:40px;padding:0 16px;overflow:hidden;white-space:nowrap;border:0;border-radius:12px;background:#ffc414;color:#111;font:inherit;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 6px 24px -6px rgba(255,196,20,.6);transition:transform .14s cubic-bezier(.23,1,.32,1)}
.fx-donate:hover{transform:translateY(-2px) scale(1.03)}
.fx-donate:active{transform:scale(.96)}
.fx-shine{position:absolute;top:0;bottom:0;left:0;width:32px;background:rgba(255,255,255,.5);transform:translateX(-50px) skewX(-20deg);pointer-events:none;animation:fx-shine 3.2s ease-out infinite}
@keyframes fx-shine{0%{transform:translateX(-50px) skewX(-20deg)}45%,100%{transform:translateX(220px) skewX(-20deg)}}
.fx-pill{white-space:nowrap;border:1px solid;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:600;line-height:1.2}
.fx-pill.wave{border-color:rgba(60,200,255,.5);color:#3cc8ff}
.fx-pill.om{border-color:rgba(255,138,31,.5);color:#ff8a1f}
.fx-port{width:36px;height:36px;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:10px;border:1px solid rgba(255,255,255,.3);color:rgba(255,255,255,.9);text-decoration:none;transition:transform .14s cubic-bezier(.23,1,.32,1),background .15s,color .15s,border-color .15s}
.fx-port:hover{transform:translateY(-2px) rotate(-6deg);background:#fff;color:#0b0b0d;border-color:#fff}
.fx-port:active{transform:scale(.94)}
.fx-donate:focus-visible,.fx-port:focus-visible{outline:2px solid #fff;outline-offset:3px}

/* centre : Free Palestine */
.fx-pal{--mx:0;--my:0;position:relative;flex:1 1 0;min-width:0;max-width:600px;height:152px;overflow:hidden;border-radius:12px;background:#000;isolation:isolate}

/* drapeau : dérive douce (GPU) sur le conteneur, parallaxe + zoom au survol sur le SVG */
.fx-flagwrap{position:absolute;inset:0;animation:fx-drift 9s ease-in-out infinite;will-change:transform}
@keyframes fx-drift{
  0%,100%{transform:translate3d(0,0,0) rotate(0deg)}
  50%{transform:translate3d(-6px,3px,0) rotate(.6deg)}
}
.fx-flag{position:absolute;left:-14px;top:-14px;width:calc(100% + 28px);height:calc(100% + 28px);
  transform:translate3d(calc(var(--mx) * -9px),calc(var(--my) * -6px),0) scale(1);
  transition:transform .35s cubic-bezier(.23,1,.32,1);will-change:transform}
.fx-pal:hover .fx-flag{transform:translate3d(calc(var(--mx) * -9px),calc(var(--my) * -6px),0) scale(1.08)}

/* voile sombre : s'éclaircit au survol pour révéler les couleurs */
.fx-shade{position:absolute;inset:0;background:rgba(0,0,0,.45);transition:background .4s ease}
.fx-pal:hover .fx-shade{background:rgba(0,0,0,.25)}

/* reflet lumineux qui traverse le panneau au survol */
.fx-sweep{position:absolute;top:0;bottom:0;left:0;width:45%;pointer-events:none;
  background:linear-gradient(100deg,transparent 0%,rgba(255,255,255,.22) 50%,transparent 100%);
  transform:translateX(-130%) skewX(-18deg);opacity:0}
.fx-pal:hover .fx-sweep{opacity:1;transform:translateX(320%) skewX(-18deg);transition:transform .9s cubic-bezier(.23,1,.32,1),opacity .2s}

/* titre fixe */
.fx-title{position:absolute;left:0;right:0;top:0;bottom:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:none}
.fx-word{display:block;font-size:clamp(1.6rem,3.4vw,2.7rem);font-weight:900;text-transform:uppercase;line-height:1;letter-spacing:.04em;text-shadow:0 3px 14px rgba(0,0,0,.85);color:#fff}

/* bandeau */
.fx-ticker{position:absolute;left:0;right:0;bottom:0;height:24px;display:flex;align-items:center;overflow:hidden;border-top:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.7)}
.fx-marquee{display:flex;width:max-content;white-space:nowrap;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.18em;color:rgba(255,255,255,.85);animation:fx-marquee 22s linear infinite}
.fx-tgrp{display:flex}
.fx-titem{display:flex;align-items:center}
.fx-tw{padding:0 12px}
.fx-dia{width:6px;height:6px;transform:rotate(45deg)}
.fx-dia.d0{background:#e4312b}.fx-dia.d1{background:#fff}.fx-dia.d2{background:#149954}
@keyframes fx-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}

/* droite */
.fx-play{width:380px;flex:none;min-width:0;display:flex;flex-direction:column}
.fx-label{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#1ed760}
.fx-ltxt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fx-eq{display:flex;align-items:flex-end;gap:2px;height:12px}
.fx-eq i{display:block;width:3px;height:100%;border-radius:2px;background:#1ed760;transform-origin:bottom;animation:fx-eq 1s ease-in-out infinite}
.fx-eq i:nth-child(2){animation-delay:.2s}.fx-eq i:nth-child(3){animation-delay:.4s}.fx-eq i:nth-child(4){animation-delay:.6s}
@keyframes fx-eq{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}
.fx-frame{overflow:hidden;border-radius:12px;box-shadow:0 0 0 1px rgba(255,255,255,.1);transition:transform .16s cubic-bezier(.23,1,.32,1)}
.fx-frame:hover{transform:translateY(-2px)}
.fx-frame iframe{display:block;width:100%;height:152px;border:0}

@media (max-width:1023px){
  .fx-in{flex-direction:column;align-items:stretch;gap:24px;padding:0 20px}
  .fx-brand,.fx-play{width:auto}
  .fx-pal{flex:none;width:100%;max-width:none}
}
@media (prefers-reduced-motion:reduce){
  .fx *{animation:none!important;transition:none!important}
}
`

/* ═════════════════════ Fenêtre de don ═════════════════════ */
type Method = 'wave' | 'om'
const AMOUNTS = [500, 1000, 2000, 5000]

export function DonateModal({ onClose }: { onClose: () => void }) {
  const [m, setM] = useState<Method>('wave')
  const [amount, setAmount] = useState<number | null>(1000)
  const [copied, setCopied] = useState(false)
  const [hearts, setHearts] = useState<{ id: number; x: number; d: number; s: number }[]>([])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = prev }
  }, [onClose])

  const burst = () => {
    const base = Date.now()
    const list = Array.from({ length: 14 }, (_, k) => ({ id: base + k, x: 8 + Math.random() * 84, d: Math.random() * 0.5, s: 0.8 + Math.random() * 0.9 }))
    setHearts(h => [...h, ...list])
    setTimeout(() => setHearts(h => h.filter(x => !list.some(l => l.id === x.id))), 2200)
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(DONATION.phone) }
    catch {
      const a = document.createElement('textarea'); a.value = DONATION.phone; document.body.appendChild(a); a.select()
      document.execCommand('copy'); a.remove()
    }
    setCopied(true); burst()
    setTimeout(() => setCopied(false), 2200)
  }

  const steps = m === 'wave'
    ? ['Ouvre l\'application Wave.', 'Choisis « Envoyer » puis saisis le numéro ci-dessus.', `Entre le montant${amount ? ` (${amount.toLocaleString('fr-FR')} FCFA)` : ''} et valide.`]
    : ['Ouvre l\'application Orange et Moi, ou compose #144#.', 'Choisis « Transfert d\'argent » puis saisis le numéro ci-dessus.', `Entre le montant${amount ? ` (${amount.toLocaleString('fr-FR')} FCFA)` : ''} et valide avec ton code secret.`]

  return (
    <div className="ft-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ft-modal" role="dialog" aria-modal="true" aria-label="Offrir un café au développeur">
        <div className="ft-hearts" aria-hidden="true">
          {hearts.map(h => <span key={h.id} style={{ left: `${h.x}%`, animationDelay: `${h.d}s`, fontSize: `${14 * h.s + 8}px` }}>♥</span>)}
        </div>
        <button className="ft-x" onClick={onClose} aria-label="Fermer">×</button>

        <div className="ft-hero">
          <div className="ft-bigcup"><CoffeeCup size={56} /></div>
          <h2>Offre un café au développeur</h2>
          <p>Si cet outil te fait gagner du temps, un petit geste m'aide à continuer de l'améliorer. Merci du fond du cœur.</p>
        </div>

        <div className="ft-amounts">
          {AMOUNTS.map(a => (
            <button key={a} type="button" className={amount === a ? 'on' : ''} onClick={() => setAmount(a)}>{a.toLocaleString('fr-FR')} <small>FCFA</small></button>
          ))}
          <button type="button" className={amount === null ? 'on' : ''} onClick={() => setAmount(null)}>Libre</button>
        </div>

        <div className="ft-tabs">
          <button type="button" className={`wave${m === 'wave' ? ' on' : ''}`} onClick={() => setM('wave')}>Wave</button>
          <button type="button" className={`om${m === 'om' ? ' on' : ''}`} onClick={() => setM('om')}>Orange Money</button>
        </div>

        <div className={`ft-number ${m}`}>
          <small>Envoyer au numéro</small>
          <b>{DONATION.display}</b>
          <button type="button" className="ft-copy" onClick={copy}>{copied ? 'Copié ✓' : 'Copier le numéro'}</button>
        </div>

        <ol className="ft-steps">{steps.map(s => <li key={s}>{s}</li>)}</ol>

        <div className="ft-actions">
          {m === 'wave' && DONATION.waveLink && <a className="ft-go wave" href={DONATION.waveLink} target="_blank" rel="noreferrer">Ouvrir Wave</a>}
          <a className="ft-go" href={`tel:${DONATION.phone}`}>Appeler le numéro</a>
        </div>
        <p className="ft-thanks">Chaque don, petit ou grand, compte. Merci ♥</p>
      </div>
    </div>
  )
}