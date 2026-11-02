import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from 'react';
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
import {
  BEATS_PER_SECTION,
  EMPTY_DRAFT,
  fillAtInterval,
  MAX_NOTES,
  MAX_SAVED_PATTERNS,
  MAX_SECTIONS,
  persistPatterns,
  readPatterns,
  toggleBeat,
  createPattern,
  validatePattern,
  type CustomPattern,
} from './game/patterns';

const fmt = (value: number) => value.toLocaleString('ko-KR');
const newId = () => `pattern_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const beatLabel = (beat: number) => `${Number((beat + 1).toFixed(2))}박`;

const getSavedPatterns = () => {
  try { return readPatterns(window.localStorage); } catch { return []; }
};

interface SettingControlsProps {
  config: GameConfig;
  onUpdate: (key: keyof GameConfig, value: number) => void;
}
function SettingControls({ config, onUpdate }: SettingControlsProps) {
  return (
    <div className="setting-grid">
      <label>BPM <strong>{config.bpm}</strong>
        <input aria-label="BPM" type="range" min="60" max="180" step="5" value={config.bpm} onChange={(event) => onUpdate('bpm', Number(event.target.value))} />
      </label>
      <label>원 생성 간격 (1~16박)
        <select aria-label="원 생성 간격" value={config.beatsPerNote} onChange={(event) => onUpdate('beatsPerNote', Number(event.target.value))}>
          {BEAT_INTERVAL_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label>축소 시간 <strong>{(config.durationMs / 1000).toFixed(1)}초</strong>
        <input aria-label="축소 시간" type="range" min="1200" max="2200" step="100" value={config.durationMs} onChange={(event) => onUpdate('durationMs', Number(event.target.value))} />
      </label>
      <label>판정 띠 두께 <strong>{config.bandWidth}px</strong>
        <input aria-label="판정 띠 두께" type="range" min="20" max="36" step="2" value={config.bandWidth} onChange={(event) => onUpdate('bandWidth', Number(event.target.value))} />
      </label>
    </div>
  );
}

function App() {
  const engine = useRef(new RhythmEngine());
  const canvas = useRef<HTMLCanvasElement>(null);
  const configInPlay = useRef<GameConfig>({ ...DEFAULT_CONFIG });
  const latestFeedback = useRef<JudgeEvent | null>(null);
  const lastUiUpdate = useRef(0);
  const editorRef = useRef<HTMLElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const beatScrollRef = useRef<HTMLDivElement>(null);

  const [settings, setSettings] = useState<GameConfig>({ ...DEFAULT_CONFIG });
  const [state, setState] = useState<GameSnapshot>(() => engine.current.snapshot(0));
  const [announcement, setAnnouncement] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<'endless' | 'custom'>('endless');

  const [patternName, setPatternName] = useState(EMPTY_DRAFT.name);
  const [patternBeats, setPatternBeats] = useState<number[]>([]);
  const [patternLength, setPatternLength] = useState(EMPTY_DRAFT.lengthBeats);
  const [patternId, setPatternId] = useState<string | null>(null);
  const [savedPatterns, setSavedPatterns] = useState<CustomPattern[]>(getSavedPatterns);
  const [selectedPatternId, setSelectedPatternId] = useState('');
  const [sectionIndex, setSectionIndex] = useState(0);
  const [gridStep, setGridStep] = useState<1 | 0.25>(1);
  const [cursorBeat, setCursorBeat] = useState(0);
  const [editorMessage, setEditorMessage] = useState('');
  const [previewPulse, setPreviewPulse] = useState(0);

  const isEditable = state.phase === 'ready' || state.phase === 'finished';
  const isRunning = state.phase === 'playing';
  const totalSections = patternLength / BEATS_PER_SECTION;
  const totalSeconds = Number(((patternLength * 60) / settings.bpm).toFixed(1));
  const visibleBeats = Array.from({ length: BEATS_PER_SECTION }, (_, index) => sectionIndex * BEATS_PER_SECTION + index);
  const accuracy = state.good + state.bad === 0 ? '—' : `${Math.round((state.good / (state.good + state.bad)) * 100)}%`;
  const phaseLabel = state.phase.toUpperCase();

  useEffect(() => {
    if (isEditable) configInPlay.current = { ...settings };
  }, [settings, isEditable]);

  useEffect(() => {
    if (beatScrollRef.current) beatScrollRef.current.scrollLeft = 0;
  }, [sectionIndex, gridStep]);

  const sync = useCallback(() => setState(engine.current.snapshot(performance.now())), []);
  const returnToReady = () => {
    if (engine.current.getPhase() === 'finished') {
      engine.current.reset();
      latestFeedback.current = null;
      sync();
    }
  };

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

  useEffect(() => {
    if (state.phase === 'finished' && mode === 'custom') {
      setEditorMessage(`패턴 종료 · GOOD ${state.good}/${state.totalNotes ?? patternBeats.length} · 점수 ${state.score}점`);
    }
  }, [state.phase, state.good, state.score, state.totalNotes, mode, patternBeats.length]);

  const updateSetting = (key: keyof GameConfig, value: number) => {
    if (!isEditable) return;
    returnToReady();
    setSettings((previous) => ({ ...previous, [key]: value }));
    if (mode === 'custom') setEditorMessage('설정이 변경되었습니다. 저장하면 패턴에 함께 반영됩니다.');
  };

  const selectMode = (next: 'endless' | 'custom') => {
    if (!isEditable) return;
    returnToReady();
    setMode(next);
    setShowSettings(false);
    setEditorMessage('');
    if (next === 'custom') {
      requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    }
  };

  const playOrPause = () => {
    const now = performance.now();
    const phase = engine.current.getPhase();
    if (phase === 'ready' || phase === 'finished') {
      if (mode === 'custom' && patternBeats.length === 0) {
        setEditorMessage('플레이 전에 원을 하나 이상 배치해 주세요.');
        editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      configInPlay.current = { ...settings };
      latestFeedback.current = null;
      engine.current.start(now, settings, mode === 'custom' ? patternBeats : undefined);
      setShowSettings(false);
      if (mode === 'custom') setEditorMessage(`커스텀 패턴 플레이 중 · ${patternBeats.length}개 원`);
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

  const placeAtBeat = (beat: number, toggle = false) => {
    if (!isEditable) return;
    returnToReady();
    if (!toggle && patternBeats.includes(beat)) {
      setEditorMessage(`${beatLabel(beat)}에 이미 원이 있습니다.`);
      return;
    }
    if (!toggle && patternBeats.length >= MAX_NOTES) {
      setEditorMessage(`원은 최대 ${MAX_NOTES}개까지 배치할 수 있습니다.`);
      return;
    }
    setPatternBeats((previous) => toggle ? toggleBeat(previous, beat, patternLength) : [...previous, beat].sort((a, b) => a - b));
    setPreviewPulse((previous) => previous + 1);
    setEditorMessage(toggle ? `${beatLabel(beat)} 원을 추가하거나 제거했습니다.` : `${beatLabel(beat)}에 원을 만들었습니다.`);
  };

  const stageDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    if (engine.current.getPhase() === 'playing') {
      engine.current.press(performance.now());
      sync();
    } else if (mode === 'custom' && isEditable) {
      // Repeated clicks on the central stage add consecutive timeline circles.
      let next = cursorBeat;
      let passes = 0;
      while (patternBeats.includes(next) && passes < patternLength * 4) {
        next = Number(((next + gridStep) % patternLength).toFixed(2));
        passes += 1;
      }
      if (passes >= patternLength * 4) {
        setEditorMessage('배치 가능한 빈 박자가 없습니다. 구간을 추가하거나 원을 지워 주세요.');
        return;
      }
      placeAtBeat(next);
      const following = Number(((next + gridStep) % patternLength).toFixed(2));
      setCursorBeat(following);
      setSectionIndex(Math.floor(following / BEATS_PER_SECTION));
    }
  };

  const sectionCountChange = (direction: -1 | 1) => {
    if (!isEditable) return;
    const sections = totalSections + direction;
    if (sections < 1 || sections > MAX_SECTIONS) return;
    const nextLength = sections * BEATS_PER_SECTION;
    if (direction === -1 && patternBeats.some((beat) => beat >= nextLength) && !window.confirm('마지막 구간에 배치한 원이 삭제됩니다. 계속할까요?')) return;
    returnToReady();
    setPatternLength(nextLength);
    setPatternBeats((previous) => previous.filter((beat) => beat < nextLength));
    setCursorBeat((value) => value >= nextLength ? Math.max(0, nextLength - 1) : value);
    setSectionIndex(direction === 1 ? sections - 1 : Math.min(sectionIndex, sections - 1));
    setEditorMessage(direction === 1 ? '16박 구간을 추가했습니다.' : '마지막 16박 구간을 제거했습니다.');
  };

  const fillBeats = () => {
    if (!isEditable) return;
    returnToReady();
    const next = fillAtInterval(patternBeats, patternLength, settings.beatsPerNote);
    setPatternBeats(next);
    setEditorMessage(`설정한 ${settings.beatsPerNote}박 간격으로 원을 채웠습니다. (총 ${next.length}개)`);
  };

  const clearBeats = () => {
    if (!isEditable || patternBeats.length === 0) return;
    if (!window.confirm('현재 배치한 모든 원을 지울까요? 저장된 패턴은 변경되지 않습니다.')) return;
    returnToReady();
    setPatternBeats([]);
    setCursorBeat(0);
    setSectionIndex(0);
    setEditorMessage('배치한 원을 모두 지웠습니다.');
  };

  const newPattern = () => {
    if (!isEditable) return;
    returnToReady();
    setPatternId(null);
    setSelectedPatternId('');
    setPatternName('새 패턴');
    setPatternBeats([]);
    setPatternLength(BEATS_PER_SECTION * 2);
    setSectionIndex(0);
    setCursorBeat(0);
    setGridStep(1);
    setEditorMessage('새 패턴을 만들 수 있습니다.');
  };

  const makeDraft = () => ({ name: patternName, beats: patternBeats, lengthBeats: patternLength, config: settings });

  const savePattern = () => {
    if (!isEditable) return;
    if (patternBeats.length === 0) { setEditorMessage('원을 하나 이상 배치한 뒤 저장해 주세요.'); return; }
    const current = savedPatterns.find((item) => item.id === patternId);
    if (!current && savedPatterns.length >= MAX_SAVED_PATTERNS) {
      setEditorMessage(`저장은 최대 ${MAX_SAVED_PATTERNS}개까지 가능합니다. 필요 없는 패턴을 삭제해 주세요.`);
      return;
    }
    const pattern = createPattern(makeDraft(), current?.id ?? newId(), new Date().toISOString(), current);
    if (!pattern) { setEditorMessage('패턴 이름과 설정을 확인해 주세요. (이름 최대 40자)'); return; }
    const next = [pattern, ...savedPatterns.filter((item) => item.id !== pattern.id)];
    if (!persistPatterns(window.localStorage, next)) {
      setEditorMessage('저장에 실패했습니다. 브라우저 저장공간 또는 시크릿 모드 설정을 확인해 주세요.');
      return;
    }
    setSavedPatterns(next);
    setPatternId(pattern.id);
    setSelectedPatternId(pattern.id);
    setEditorMessage(`「${pattern.name}」 패턴을 이 브라우저에 저장했습니다.`);
  };

  const loadPattern = () => {
    if (!isEditable) return;
    const pattern = savedPatterns.find((item) => item.id === selectedPatternId);
    if (!pattern) { setEditorMessage('불러올 패턴을 선택해 주세요.'); return; }
    returnToReady();
    setPatternId(pattern.id);
    setPatternName(pattern.name);
    setPatternBeats([...pattern.beats]);
    setSettings({ ...pattern.config });
    setPatternLength(pattern.lengthBeats);
    setSectionIndex(0);
    setCursorBeat(0);
    setGridStep(pattern.beats.some((beat) => !Number.isInteger(beat)) ? 0.25 : 1);
    setMode('custom');
    setEditorMessage(`「${pattern.name}」 패턴과 BPM·박자·축소 시간·판정 띠 설정을 불러왔습니다.`);
  };

  const deletePattern = () => {
    if (!isEditable) return;
    const pattern = savedPatterns.find((item) => item.id === selectedPatternId);
    if (!pattern) { setEditorMessage('삭제할 저장 패턴을 선택해 주세요.'); return; }
    if (!window.confirm(`저장된 「${pattern.name}」 패턴을 삭제할까요?`)) return;
    const next = savedPatterns.filter((item) => item.id !== pattern.id);
    if (!persistPatterns(window.localStorage, next)) { setEditorMessage('저장소에서 삭제하지 못했습니다.'); return; }
    setSavedPatterns(next);
    setSelectedPatternId('');
    if (patternId === pattern.id) setPatternId(null);
    setEditorMessage(`「${pattern.name}」 저장 기록을 삭제했습니다. 현재 화면의 배치는 유지됩니다.`);
  };

  const exportPattern = () => {
    const pattern = createPattern(makeDraft(), patternId ?? newId(), new Date().toISOString(), savedPatterns.find((p) => p.id === patternId));
    if (!pattern || patternBeats.length === 0) { setEditorMessage('원을 하나 이상 배치한 후 내보내 주세요.'); return; }
    const blob = new Blob([JSON.stringify(pattern, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'neon-pulse-pattern.json';
    link.click();
    URL.revokeObjectURL(url);
    setEditorMessage('JSON 패턴 파일을 내보냈습니다. 다른 기기에서도 가져올 수 있습니다.');
  };

  const importPattern = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !isEditable) return;
    if (file.size > 150_000) { setEditorMessage('150KB 이하의 패턴 JSON 파일만 가져올 수 있습니다.'); return; }
    try {
      const data: unknown = JSON.parse(await file.text());
      const pattern = validatePattern(data);
      if (!pattern || pattern.beats.length === 0) throw new Error('INVALID_PATTERN');
      returnToReady();
      setMode('custom');
      setPatternId(null); // An imported pattern must not silently overwrite a saved local pattern.
      setSelectedPatternId('');
      setPatternName(pattern.name);
      setPatternBeats([...pattern.beats]);
      setSettings({ ...pattern.config });
      setPatternLength(pattern.lengthBeats);
      setGridStep(pattern.beats.some((beat) => !Number.isInteger(beat)) ? 0.25 : 1);
      setSectionIndex(0);
      setCursorBeat(0);
      setEditorMessage('JSON 패턴을 가져왔습니다. 브라우저에도 보관하려면 「패턴 저장」을 눌러 주세요.');
    } catch {
      setEditorMessage('유효한 NEON PULSE 패턴 파일이 아닙니다. 파일 형식을 확인해 주세요.');
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /><span /></div>
          <div>
            <div className="brand-name">NEON <span>PULSE</span></div>
            <div className="brand-subtitle">RHYTHM CONTROL / PATTERN STUDIO</div>
          </div>
        </div>
        <div className="head-actions">
          <div className="mode-switch" role="group" aria-label="플레이 모드 선택">
            <button className={mode === 'endless' ? 'active' : ''} aria-pressed={mode === 'endless'} disabled={!isEditable} onClick={() => selectMode('endless')}>일반</button>
            <button className={mode === 'custom' ? 'active' : ''} aria-pressed={mode === 'custom'} disabled={!isEditable} onClick={() => selectMode('custom')}>커스텀</button>
          </div>
          <span className={`phase phase-${state.phase}`}><i />{phaseLabel}</span>
          <div className="score-primary"><span>SCORE</span><strong>{fmt(state.score)}</strong></div>
        </div>
      </header>

      <div className="game-layout">
        <aside className="side-panel" aria-label="게임 진행 현황">
          <p className="panel-label">SESSION DATA <span>{mode === 'custom' ? 'CUSTOM' : 'ENDLESS'}</span></p>
          <div className="metric"><span>GOOD</span><strong className="good-text">{fmt(state.good)}</strong></div>
          <div className="metric"><span>BAD</span><strong className="bad-text">{fmt(state.bad)}</strong></div>
          <div className="metric"><span>ACCURACY</span><strong>{accuracy}</strong></div>
          <div className="metric"><span>COMBO</span><strong>{fmt(state.combo)}</strong></div>
          <div className="metrics-bottom"><div className="small-indicator" /> {mode === 'custom' && isEditable ? '중앙 화면을 클릭하면 타임라인에 원이 추가됩니다.' : '타이밍에 맞춰 눌렀다가 떼세요.'}</div>
        </aside>

        <section className="play-area" aria-label="리듬게임 플레이 영역">
          <div className="stage-header">
            <span><i className="tiny-dot" /> {mode === 'custom' ? 'CUSTOM PATTERN' : 'CONTROL SURFACE'}</span>
            <span>{settings.bpm} BPM <b>·</b> {BEAT_INTERVAL_OPTIONS.find((s) => s.value === settings.beatsPerNote)?.label}</span>
          </div>
          <div className={`stage ${isRunning ? 'stage-live' : ''} ${mode === 'custom' && isEditable ? 'stage-placing' : ''}`} onPointerDown={stageDown}>
            <canvas ref={canvas} aria-hidden="true" />
            {mode === 'custom' && isEditable && previewPulse > 0 && <div key={previewPulse} className="creation-pulse" aria-hidden="true" />}
            {state.phase !== 'playing' && (
              <div className="stage-overlay" aria-hidden="true">
                <div className="overlay-chip">{state.phase === 'paused' ? 'PAUSED' : state.phase === 'finished' ? 'FINISHED' : mode === 'custom' ? 'EDIT MODE' : 'STANDBY'}</div>
                <p>{state.phase === 'paused' ? '일시정지 중입니다' : state.phase === 'finished' ? `패턴 종료 · GOOD ${state.good} / ${state.totalNotes ?? 0}` : mode === 'custom' ? `중앙 클릭으로 원 추가 · 다음 ${beatLabel(cursorBeat)}` : '시작 버튼을 눌러주세요'}</p>
              </div>
            )}
            <div className="corner corner-tl" /><div className="corner corner-tr" />
            <div className="corner corner-bl" /><div className="corner corner-br" />
          </div>
          <div className="stage-footer">
            <span>INPUT <strong>{mode === 'custom' && isEditable ? 'CLICK TO ADD NOTE' : 'CLICK / TOUCH / SPACE'}</strong></span>
            <span>{mode === 'custom' && !isEditable ? 'HITS' : 'NEXT'} <strong>{mode === 'custom' && !isEditable ? `${state.good + state.bad}/${state.totalNotes ?? patternBeats.length}` : state.phase === 'finished' ? '완료' : isEditable || !state.hasNextNote ? '—' : `${(state.nextNoteIn / 1000).toFixed(1)}s`}</strong></span>
          </div>
        </section>

        <aside className="right-panel" aria-label="조작 안내">
          <p className="panel-label">HOW TO PLAY <span>01</span></p>
          <div className="instruction"><em>01</em><div><strong>WAIT</strong><p>보라색 원이 점선 원으로 다가옵니다.</p></div></div>
          <div className="instruction"><em>02</em><div><strong>PRESS</strong><p>원의 테두리가 점선 띠에 들어오면 누르세요.</p></div></div>
          <div className="instruction"><em>03</em><div><strong>RELEASE</strong><p>테두리가 점선 띠를 벗어나기 전에 떼세요.</p></div></div>
          <div className="legend"><span className="good-text">● GOOD</span> +1점 <span className="bad-text">● BAD</span> 0점</div>
          {mode === 'custom' && <p className="custom-tip">원은 클릭으로 직접 배치하고, 해당 박자에서 순서대로 등장합니다. 음악과 카메라는 사용하지 않습니다.</p>}
        </aside>
      </div>

      <footer className="bottom-panel">
        <div className="bottom-intro"><span className="live-signal" /> <span>BEAT ENGINE</span><small>{mode === 'custom' ? `${patternBeats.length}개 원 · ${patternLength}박 패턴` : '오디오 없이 타이밍 판정 테스트'}</small></div>
        <div className="control-group">
          {mode === 'endless'
            ? <button className="control-secondary" onClick={() => setShowSettings((v) => !v)} disabled={!isEditable} aria-expanded={showSettings}>설정 <span aria-hidden="true">⚙</span></button>
            : <button className="control-secondary" onClick={() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>패턴 편집 <span aria-hidden="true">✎</span></button>}
          <button className="control-secondary" onClick={restart} disabled={state.phase === 'ready'}>초기화 <span aria-hidden="true">↺</span></button>
          <button className="control-primary" onClick={playOrPause}>{isRunning ? '일시정지' : state.phase === 'paused' ? '계속하기' : state.phase === 'finished' ? '다시 플레이' : mode === 'custom' ? '패턴 플레이' : '게임 시작'} <span aria-hidden="true">{isRunning ? 'Ⅱ' : '▶'}</span></button>
        </div>
      </footer>

      {mode === 'endless' && showSettings && isEditable && (
        <section className="settings" aria-label="게임 설정">
          <div className="settings-head"><div><strong>PLAY SETTINGS</strong><p>게임 시작 전에 변경할 수 있습니다.</p></div><button onClick={() => setShowSettings(false)} aria-label="설정 닫기">×</button></div>
          <SettingControls config={settings} onUpdate={updateSetting} />
          <p className="settings-footnote">현재 설정: {settings.bpm} BPM · {BEAT_INTERVAL_OPTIONS.find((item) => item.value === settings.beatsPerNote)?.label} · {Number((noteIntervalMs(settings) / 1000).toFixed(2))}초마다 원 생성.</p>
        </section>
      )}

      {mode === 'custom' && (
        <section className="pattern-studio" ref={editorRef} aria-label="커스텀 원 패턴 제작">
          <div className="studio-heading">
            <div>
              <span className="studio-eyebrow">PATTERN STUDIO / CLICK TO CREATE</span>
              <h2>나만의 원 패턴 만들기</h2>
              <p>원하는 박자를 클릭하면 원이 배치됩니다. 중앙 화면을 반복 클릭해 차례대로 추가할 수도 있습니다.</p>
            </div>
            <div className="studio-heading-actions">
              <button className="studio-button subtle" onClick={newPattern} disabled={!isEditable}>+ 새 패턴</button>
              <button className="studio-button accent" onClick={savePattern} disabled={!isEditable}>패턴 저장</button>
              <button className="studio-button play" onClick={playOrPause}>{isRunning ? '일시정지' : state.phase === 'paused' ? '계속' : '▶ 직접 플레이'}</button>
            </div>
          </div>

          <div className="studio-layout">
            <div className="studio-left">
              <div className="studio-card">
                <div className="studio-card-title"><strong>패턴 정보</strong><span>{patternBeats.length} NOTES</span></div>
                <label className="pattern-name-label">패턴 이름
                  <input type="text" value={patternName} maxLength={40} onChange={(event) => setPatternName(event.target.value)} disabled={!isEditable} placeholder="패턴 이름을 입력하세요" />
                </label>
                <div className="studio-summary">
                  <span>총 {patternLength}박</span><span>{totalSeconds}초 구간</span><span>{patternBeats.length}개 원</span>
                </div>
              </div>
              <div className="studio-card">
                <div className="studio-card-title"><strong>리듬 설정</strong><span>저장 시 포함</span></div>
                <SettingControls config={settings} onUpdate={updateSetting} />
                <p className="settings-footnote">간격 설정은 자동 배치에 적용됩니다. 직접 클릭한 위치는 그대로 유지됩니다.</p>
              </div>
              <div className="studio-card">
                <div className="studio-card-title"><strong>저장된 패턴</strong><span>{savedPatterns.length} / {MAX_SAVED_PATTERNS}</span></div>
                <select className="saved-select" aria-label="저장된 패턴 선택" value={selectedPatternId} onChange={(event) => setSelectedPatternId(event.target.value)} disabled={!isEditable}>
                  <option value="">패턴 선택</option>
                  {savedPatterns.map((pattern) => <option key={pattern.id} value={pattern.id}>{pattern.name} · {pattern.beats.length}개</option>)}
                </select>
                <div className="studio-small-actions">
                  <button onClick={loadPattern} disabled={!isEditable}>불러오기</button>
                  <button onClick={deletePattern} disabled={!isEditable}>저장 삭제</button>
                  <button onClick={exportPattern} disabled={!isEditable}>JSON 내보내기</button>
                  <button onClick={() => importRef.current?.click()} disabled={!isEditable}>JSON 가져오기</button>
                  <input type="file" ref={importRef} accept=".json,application/json" hidden onChange={importPattern} aria-label="패턴 JSON 파일 가져오기" />
                </div>
                <p className="local-note">브라우저에 저장됩니다. 다른 기기에서 사용하거나 보관하려면 JSON으로 내보내세요.</p>
              </div>
            </div>

            <div className="studio-timeline-card">
              <div className="studio-card-title"><strong>원 배치 타임라인</strong><span>클릭 = 추가 / 다시 클릭 = 제거</span></div>
              <div className="timeline-tools">
                <div className="section-navigation" aria-label="16박 구간 선택">
                  <button disabled={!isEditable || sectionIndex === 0} onClick={() => setSectionIndex((index) => index - 1)} aria-label="이전 16박 구간">‹</button>
                  <span>구간 <strong>{sectionIndex + 1} / {totalSections}</strong><small>{sectionIndex * 16 + 1}~{(sectionIndex + 1) * 16}박</small></span>
                  <button disabled={!isEditable || sectionIndex >= totalSections - 1} onClick={() => setSectionIndex((index) => index + 1)} aria-label="다음 16박 구간">›</button>
                </div>
                <div className="grid-precision" role="group" aria-label="박자 표시 단위">
                  <button className={gridStep === 1 ? 'selected' : ''} aria-pressed={gridStep === 1} onClick={() => setGridStep(1)}>1박 보기</button>
                  <button className={gridStep === 0.25 ? 'selected' : ''} aria-pressed={gridStep === 0.25} onClick={() => setGridStep(0.25)}>1/4박 보기</button>
                </div>
              </div>
              <div className="beat-grid-scroll" ref={beatScrollRef} tabIndex={0} aria-label="원 배치 그리드, 가로로 스크롤 가능">
                <div className={`beat-grid ${gridStep === 0.25 ? 'quarter-grid' : ''}`}>
                  {visibleBeats.map((beat) => {
                    const contained = patternBeats.filter((value) => value >= beat && value < beat + 1);
                    const cells = gridStep === 1 ? [beat] : [beat, beat + 0.25, beat + 0.5, beat + 0.75];
                    return (
                      <div className="beat-column" key={beat}>
                        <div className="beat-number">{beat + 1}</div>
                        <div className="beat-cells">
                          {cells.map((pos) => {
                            const active = patternBeats.includes(pos);
                            const selected = Math.abs(pos - cursorBeat) < 0.00001;
                            const hasFractional = gridStep === 1 && contained.some((noteBeat) => noteBeat !== beat);
                            return (
                              <button key={pos} type="button" disabled={!isEditable}
                                className={`beat-cell ${active ? 'has-note' : hasFractional ? 'has-detail' : ''} ${selected ? 'cursor-note' : ''}`}
                                onClick={() => { placeAtBeat(pos, true); setCursorBeat(pos); }}
                                aria-label={`${beatLabel(pos)} 원 ${active ? '제거' : '추가'}${hasFractional ? ', 세부박자 원 있음' : ''}`} aria-pressed={active}
                                title={`${beatLabel(pos)} / ${active ? '클릭하여 제거' : '클릭하여 원 생성'}`}>
                                <span className="beat-orb" aria-hidden="true" />
                                {gridStep === 1 && contained.length - (active ? 1 : 0) > 0 && <small className="subbeat-count">+{contained.length - (active ? 1 : 0)}</small>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="timeline-key"><span><i className="key-filled" />원이 있는 박자</span><span><i className="key-empty" />빈 박자</span><span>1/4박 보기로 세부 위치 편집</span></div>
              <div className="timeline-actions">
                <button onClick={fillBeats} disabled={!isEditable}>설정한 간격으로 자동 배치</button>
                <button onClick={() => sectionCountChange(1)} disabled={!isEditable || totalSections >= MAX_SECTIONS}>+ 16박 구간 추가</button>
                <button onClick={() => sectionCountChange(-1)} disabled={!isEditable || totalSections <= 1}>− 16박 구간 제거</button>
                <button className="danger" onClick={clearBeats} disabled={!isEditable || patternBeats.length === 0}>모두 지우기</button>
              </div>
              <p className="timeline-helper">배치된 원은 해당 박자에 등장하여 축소됩니다. 축소 중 겹치는 원도 배치할 수 있으므로, 지나치게 촘촘한 패턴은 난도가 매우 높아질 수 있습니다. 원을 배치한 뒤 <strong>직접 플레이</strong>를 눌러 확인하세요.</p>
              <div className="editor-message" role="status" aria-live="polite">{editorMessage || '타임라인에서 원을 배치하거나 중앙 원 화면을 클릭하여 시작하세요.'}</div>
            </div>
          </div>
        </section>
      )}
      <div className="sr-only" aria-live="polite">{announcement}</div>
    </div>
  );
}

export default App;
