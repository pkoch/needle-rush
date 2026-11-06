const Spark = ({ className = "" }: { className?: string }) => <svg className={className} viewBox="0 0 100 100" fill="none" aria-hidden="true"><path d="m50 0 9 33 29-21-21 29 33 9-33 9 21 29-29-21-9 33-9-33-29 21 21-29-33-9 33-9-21-29 29 21Z" fill="currentColor"/></svg>;

export default function Home() {
  return <main className="landing">
    <nav className="site-nav" aria-label="Main navigation">
      <a className="wordmark" href="/" aria-label="Needle Rush home"><span className="brand-disc" aria-hidden="true"/>NEEDLE RUSH</a>
      <a className="small-link" href="/display">Host on the TV <span aria-hidden="true">↗</span></a>
    </nav>
    <div className="landing-stage">
      <section className="hero">
        <div className="eyebrow"><span className="live-dot"/> YOUR LIBRARY. EVERYONE’S EARS.</div>
        <h1>KNOW THE<br/>SONG? <em>BEAT<br/>THE ROOM.</em></h1>
        <p className="intro">Good ears. Fast fingers. Big bragging rights.<br/>The music party game that gets everyone playing.</p>
        <div className="actions"><a className="button primary" href="/join">Join the party <span aria-hidden="true">↗</span></a><a className="button secondary" href="/display">Set up the TV <span aria-hidden="true">▣</span></a></div>
        <p className="footnote">Players need no account. Just a room code and a name.</p>
      </section>
      <aside className="turntable-scene" aria-hidden="true">
        <div className="scene-orbit"/>
        <div className="scene-caption">TURN IT UP.<br/>SHOW THEM WHAT YOU KNOW.</div>
        <Spark className="scene-spark spark-one"/>
        <Spark className="scene-spark spark-two"/>
        <div className="record-shadow"/>
        <div className="vinyl-record"><div className="vinyl-shine"/><div className="vinyl-label"><span>THE PARTY STARTS HERE</span><strong>NEEDLE<br/>RUSH</strong><i/><small>SIDE A • ALL EARS</small></div></div>
        <div className="tonearm"><i/><span/></div>
        <div className="party-sticker"><span>2–16</span><b>PLAYERS</b><small>ONE LOUD ROOM</small></div>
        <span className="floating-note note-one">♪</span><span className="floating-note note-two">♫</span>
        <div className="scene-bottom"><span className="equalizer-mini"><i/><i/><i/><i/><i/></span>ALL TASTE. NO SKIPS.</div>
      </aside>
    </div>
    <div className="party-ticker" aria-hidden="true"><span>PRESS PLAY</span><b>✦</b><span>TRUST YOUR EARS</span><b>✦</b><span>FEEL THE RUSH</span><b>✦</b><span>PRESS PLAY</span><b>✦</b></div>
    <section className="rules" aria-label="How to play"><div className="rules-heading"><span className="eyebrow">THE GAME PLAN</span><h2>ALL EARS.<br/>ALL IN.</h2></div><article><b>01 /</b><h3>Listen up.</h3><p>A random slice of a song. Take your time: everyone answers or skips.</p></article><article><b>02 /</b><h3>Trust your ears.</h3><p>Four song + artist choices. One guess. First correct earns 3; other correct guesses earn 1.</p></article><article><b>03 /</b><h3>Risk the rush.</h3><p>A wrong guess costs three. Skip for minus one. Ten rounds. One glorious leaderboard.</p></article></section>
    <footer><a className="wordmark" href="/">NEEDLE RUSH <span aria-hidden="true">✦</span></a><span>Music on the TV. Everyone plays on their phone.</span><a href="/display">Host on the TV ↗</a></footer>
  </main>
}
