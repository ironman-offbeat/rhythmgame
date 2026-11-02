import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  BEAT_INTERVAL_OPTIONS,
  DEFAULT_CONFIG,
  RhythmEngine,
  noteIntervalMs,
  type GameConfig,
  type GameSnapshot,
  type JudgeEvent,
} from './game/engine';
import { drawGame } from './game/render';

const fmt = (value: number) => value.toLocaleString('ko-KR');

function App() {
  const engine = useRef(new RhythmEngine());
  const canvas = useRef<HTMLCanvasElement>(null);
  const configInPlay = useRef<GameConfig>({ ...DEFAULT_CONFIG });
  const latestFeedback = useRef<JudgeEvent | null>(null);
  const lastUiUpdate = useRef(0);
  const [settings, setSettings] = useState<GameConfig>({ ...DEFAULT_CONFIG });
  const [state, setState] = useState<GameSnapshot>(() => engine.current.snapshot(0));
  const [announcement, setAnnouncement] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (state.phase === 'ready') configInPlay.current = settings;
  }, [settings, state.phase]);

  const sync = useCallback(() => setState(engine.current.snapshot(performance.now())), []);

  useEffect(() => {
    let animationFrame = 0;
    const loop = (now: number) => {
      engine.current.tick(now);
      const events = engine.current.drainEvents();
      if (events.length) {
        latestFeedback.current = events[events.length - 1];
        setAnnouncement(events[events.length - 1].kind === 'GOOD' ? 'GOOD. 1점 획득' : 'BAD. 점수 없음');
      }
      const view = engine.current.snapshot(now);
      if (canvas.current) drawGame(canvas.current, view, configInPlay.current, latestFeedback.current);
      if (events.length || now - lastUiUpdate.current >= 100) {
        lastUiUpdate.current = now;
        setState({ ...view });
      }
      animationFrame = requestAnimationFrame(loop);
    };
    animationFrame = requestAnimationFrame(loop);

    const release = () => engine.current.release(performance.now());
    const keyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, input, select, textarea, summary')) return;
      if (event.code !== 'Space') return;
      event.preventDefault();
      if (!event.repeat) engine.current.press(performance.now());
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      event.preventDefault();
      release();
    };
    const pauseWhenHidden = () => {
      if (document.hidden) engine.current.pause(performance.now());
    };
    const pauseWhenBlurred = () => engine.current.pause(performance.now());
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', pauseWhenBlurred);
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', pauseWhenBlurred);
      document.removeEventListener('visibilitychange', pauseWhenHidden);
    };
  }, []);

  const playOrPause = () => {
    const now = performance.now();
    const phase = engine.current.getPhase();
    if (phase === 'ready') {
      configInPlay.current = { ...settings };
      latestFeedback.current = null;
      engine.current.start(now, settings);
      setShowSettings(false);
    } else if (phase === 'playing') {
      engine.current.pause(now);
    } else {
      engine.current.resume(now);
    }
    sync();
  };

  const restart = () => {
    engine.current.reset();
    latestFeedback.current = null;
    setAnnouncement('');
    sync();
  };

  const stageDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    if (engine.current.getPhase() === 'playing') engine.current.press(performance.now());
    sync();
  };

  const updateSetting = (key: keyof GameConfig, value: number) => {
    if (state.phase !== 'ready') return;
    setSettings((previous) => ({ ...previous, [key]: value }));
  };

  const accuracy = state.good + state.bad === 0
    ? '—'
    : `${Math.round((state.good / (state.good + state.bad)) * 100)}%`;
  const isReady = state.phase === 'ready';
  const isRunning = state.phase === 'playing';
  const phaseLabel = isRunning ? 'PLAYING' : state.phase === 'paused' ? 'PAUSED' : 'READY';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /><span /></div>
          <div>
            <div className="brand-name">NEON <span>PULSE</span></div>
            <div className="brand-subtitle">RHYTHM CONTROL / PROTOTYPE 01</div>
          </div>
        </div>
        <div className="head-actions">
          <span className={`phase phase-${state.phase}`}><i />{phaseLabel}</span>
          <div className="score-primary"><span>SCORE</span><strong>{fmt(state.score)}</strong></div>
        </div>
      </header>

      <div className="game-layout">
        <aside className="side-panel" aria-label="게임 진행 현황">
          <p className="panel-label">SESSION DATA <span>01 / 01</span></p>
          <div className="metric"><span>GOOD</span><strong className="good-text">{fmt(state.good)}</strong></div>
          <div className="metric"><span>BAD</span><strong className="bad-text">{fmt(state.bad)}</strong></div>
          <div className="metric"><span>ACCURACY</span><strong>{accuracy}</strong></div>
          <div className="metric"><span>COMBO</span><strong>{fmt(state.combo)}</strong></div>
          <div className="metrics-bottom"><div className="small-indicator" /> 타이밍에 맞춰 눌렀다가 떼세요.</div>
        </aside>

        <section className="play-area" aria-label="리듬게임 플레이 영역">
          <div className="stage-header">
            <span><i className="tiny-dot" /> CONTROL SURFACE</span>
            <span>{settings.bpm} BPM <b>·</b> {BEAT_INTERVAL_OPTIONS.find((s) => s.value === settings.beatsPerNote)?.label}</span>
          </div>
          <div className={`stage ${isRunning ? 'stage-live' : ''}`} onPointerDown={stageDown}>
            <canvas ref={canvas} aria-hidden="true" />
            {state.phase !== 'playing' && (
              <div className="stage-overlay" aria-hidden="true">
                <div className="overlay-chip">{state.phase === 'paused' ? 'PAUSED' : 'STANDBY'}</div>
                <p>{state.phase === 'paused' ? '일시정지 중입니다' : '시작 버튼을 눌러주세요'}</p>
              </div>
            )}
            <div className="corner corner-tl" /><div className="corner corner-tr" />
            <div className="corner corner-bl" /><div className="corner corner-br" />
          </div>
          <div className="stage-footer">
            <span>INPUT <strong>CLICK / TOUCH / SPACE</strong></span>
            <span>NEXT <strong>{isReady ? '—' : `${(state.nextNoteIn / 1000).toFixed(1)}s`}</strong></span>
          </div>
        </section>

        <aside className="right-panel" aria-label="조작 안내">
          <p className="panel-label">HOW TO PLAY <span>01</span></p>
          <div className="instruction"><em>01</em><div><strong>WAIT</strong><p>보라색 원이 점선 원으로 다가옵니다.</p></div></div>
          <div className="instruction"><em>02</em><div><strong>PRESS</strong><p>원의 테두리가 점선 띠에 들어오면 누르세요.</p></div></div>
          <div className="instruction"><em>03</em><div><strong>RELEASE</strong><p>테두리가 점선 띠를 벗어나기 전에 떼세요.</p></div></div>
          <div className="legend"><span className="good-text">● GOOD</span> +1점 <span className="bad-text">● BAD</span> 0점</div>
        </aside>
      </div>

      <footer className="bottom-panel">
        <div className="bottom-intro"><span className="live-signal" /> <span>BEAT ENGINE</span><small>오디오 없이 타이밍 판정 테스트</small></div>
        <div className="control-group">
          <button className="control-secondary" onClick={() => setShowSettings((v) => !v)} disabled={!isReady} aria-expanded={showSettings}>설정 <span aria-hidden="true">⚙</span></button>
          <button className="control-secondary" onClick={restart} disabled={isReady}>초기화 <span aria-hidden="true">↺</span></button>
          <button className="control-primary" onClick={playOrPause}>{isRunning ? '일시정지' : state.phase === 'paused' ? '계속하기' : '게임 시작'} <span aria-hidden="true">{isRunning ? 'Ⅱ' : '▶'}</span></button>
        </div>
      </footer>

      {showSettings && isReady && (
        <section className="settings" aria-label="개발자용 게임 설정">
          <div className="settings-head"><div><strong>PLAY SETTINGS</strong><p>게임 시작 전에 변경할 수 있습니다.</p></div><button onClick={() => setShowSettings(false)} aria-label="설정 닫기">×</button></div>
          <div className="setting-grid">
            <label>BPM <strong>{settings.bpm}</strong><input type="range" min="60" max="180" step="5" value={settings.bpm} onChange={(event) => updateSetting('bpm', Number(event.target.value))}/></label>
            <label>원 생성 간격 (1~16박)<select value={settings.beatsPerNote} onChange={(event) => updateSetting('beatsPerNote', Number(event.target.value))}>{BEAT_INTERVAL_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
            <label>축소 시간 <strong>{(settings.durationMs / 1000).toFixed(1)}초</strong><input type="range" min="1200" max="2200" step="100" value={settings.durationMs} onChange={(event) => updateSetting('durationMs', Number(event.target.value))}/></label>
            <label>판정 띠 두께 <strong>{settings.bandWidth}px</strong><input type="range" min="20" max="36" step="2" value={settings.bandWidth} onChange={(event) => updateSetting('bandWidth', Number(event.target.value))}/></label>
          </div>
          <p className="settings-footnote">현재 설정: {settings.bpm} BPM · {BEAT_INTERVAL_OPTIONS.find((s) => s.value === settings.beatsPerNote)?.label} · {Number((noteIntervalMs(settings) / 1000).toFixed(2))}초마다 원 생성. 1~16박을 모두 선택할 수 있으며, 기존 16분음표 옵션도 유지됩니다.</p>
        </section>
      )}
      <div className="sr-only" aria-live="polite">{announcement}</div>
    </div>
  );
}

export default App;
