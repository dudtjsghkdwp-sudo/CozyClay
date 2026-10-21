import { useEffect, useRef, useState } from 'react';
import { useStudioShell } from './studio-shell-context.js';
import { WALK_DIRECTIONS, buildWalkSpec } from './manual-walk.js';
import streetObjects from './korean-street-objects.json';
import SceneAngleControls from './SceneAngleControls.jsx';
import './manual-previs.css';

export default function ManualPrevisPanel() {
  const s = useStudioShell();
  const [open, setOpen] = useState(true);
  const [distance, setDistance] = useState(1.5);
  const [seconds, setSeconds] = useState(4);
  const [segments, setSegments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('방향을 순서대로 추가한 뒤 걷기 적용을 누르세요.');
  const [error, setError] = useState(false);
  const streetAttempted = useRef(new Set());
  const character = s.characters[s.activeCharIndex] ?? s.characters[0];
  useEffect(() => {
    if (s.projectName !== '길거리' || s.projectStartupOpen || s.sceneObjects.length) return;
    if (streetAttempted.current.has(s.activeSceneId)) return;
    streetAttempted.current.add(s.activeSceneId);
    s.appContext.bus.run('objects.replace', { objects: streetObjects }, { origin: 'ui' }).then(r => {
      if (!r?.ok) { setError(true); setMessage(r?.error?.message ?? '거리 배경을 불러오지 못했습니다.'); }
      else setMessage('한국 길거리 배경을 장면에 추가했습니다. 카메라를 마우스로 돌려 확인해 보세요.');
    }).catch(e => { setError(true); setMessage(e.message); });
  }, [s.projectName, s.projectStartupOpen, s.activeSceneId, s.sceneObjects.length]);
  if (s.embedMode) return null;
  async function action(id, args = {}) {
    const r = await s.appContext.bus.run(id, args, { origin: 'ui' });
    if (!r?.ok) throw new Error(r?.error?.message ?? '변경을 적용하지 못했습니다.');
    return r;
  }
  async function perform(work) {
    if (busy) return;
    setBusy(true); setError(false);
    try { await work(); } catch (e) { setError(true); setMessage(e.uiMessage || e.message || '작업에 실패했습니다.'); }
    finally { setBusy(false); }
  }
  function append(direction) {
    try {
      const next = [...segments, { ...direction, distance: Number(distance), seconds: Number(seconds) }];
      buildWalkSpec(character, next); setSegments(next); setError(false);
      setMessage(`${next.length}개 이동을 준비했습니다. 걷기 적용을 누르세요.`);
    } catch (e) { setError(true); setMessage(e.message); }
  }
  async function applyWalk() {
    const spec = buildWalkSpec(character, segments);
    s.setTlPlaying(false); setMessage('발동작을 계산하고 있습니다…');
    const r = await action('motion.compile', { characterId: character.id, spec, install: true });
    const frames = r.output?.frames ?? r.output?.frameCount;
    const planned = segments.reduce((n, part) => n + Math.round(part.seconds * 24) + 1, 1);
    const needed = Math.max(s.tlFrameCount, frames || planned);
    if (needed > s.tlFrameCount) {
      await action('shot.setTimeline', { frameCount: needed });
      const last = [...s.shots].sort((a, b) => b.endFrame - a.endFrame)[0];
      if (last) await action('shot.setRange', { shotId: last.id, range: { startFrame: last.startFrame, endFrameExclusive: needed } });
    }
    s.setTlFrame(0); s.enterShotLook();
    const qa = r.output?.qa;
    setMessage(qa?.ok === false ? '걷기를 적용했습니다. 일부 자세·충돌 점검 경고가 있으니 재생으로 확인하세요.' : '걷기를 적용했습니다. 재생으로 확인하고 MP4로 저장하세요.');
  }
  async function saveCamera() {
    if (!s.activeShot) throw new Error('먼저 타임라인에서 샷을 선택해 주세요.');
    s.setTlPlaying(false);
    await action('shot.addKey', { shotId: s.activeShot.id, frame: s.tlFrame });
    await action('shot.setCameraMode', { shotId: s.activeShot.id, mode: 'keys' });
    setMessage(`${s.tlFrame}프레임의 구도를 저장했습니다. 이 샷은 저장한 키 사이를 이동합니다.`);
  }
  async function exportVideo() {
    s.setTlPlaying(false); setMessage('MP4를 만들고 있습니다. 창을 닫지 마세요…');
    const r = await action('export.shotVideo', { scope: 'timeline' });
    setMessage(`저장 완료: ${r.output.fileName} — 브라우저 다운로드를 확인하세요.`);
  }
  return <section className="manual-previs" aria-label="직접 프리비즈 조작">
    <button className="manual-heading" onClick={() => setOpen(!open)} aria-expanded={open}>직접 조작 · 카메라 / 걷기 / 영상 <span>{open ? '−' : '+'}</span></button>
    {open && <div className="manual-body">
      <h3>1. 카메라</h3>
      <div className="manual-row"><button disabled={busy || Boolean(s.sceneObjects.length)} onClick={() => perform(async () => { await action('objects.replace', { objects: streetObjects }); setMessage('한국 길거리 배경을 추가했습니다.'); })}>한국 길거리 배경 추가</button></div>
      <div className="manual-row"><button disabled={busy} onClick={() => { s.enterShotLook(); setMessage('마우스로 구도를 바꾼 뒤 현재 구도 저장을 누르세요.'); }}>마우스로 카메라 조절</button><button disabled={busy || !s.lookThroughShot} onClick={() => perform(saveCamera)}>현재 구도 저장</button></div>
      <p>Alt + 왼쪽 드래그: 회전 · 휠: 앞뒤<br/>휠 버튼 드래그: 상하좌우 · 오른쪽 드래그: 시선<br/>오른쪽 누른 채 W/A/S/D: 이동 · Q/E: 위아래</p>
      <p className="manual-note">타임라인에서 프레임을 고른 뒤 구도를 저장하세요. 저장한 샷은 자동 레일 대신 카메라 키를 사용합니다.</p>
      <SceneAngleControls busy={busy} perform={perform} action={action} setMessage={setMessage} character={character} />
      <h3>2. 인물 걷기</h3>
      <div className="manual-row"><label>거리 (m)<input aria-label="이동 거리" type="number" min="0.5" max="3" step="0.5" value={distance} onChange={e => setDistance(e.target.value)} /></label><label>시간 (초)<input aria-label="이동 시간" type="number" min="3" max="8" step="1" value={seconds} onChange={e => setSeconds(e.target.value)} /></label></div>
      <div className="manual-directions">{WALK_DIRECTIONS.map(d => <button key={d.turn} disabled={busy || !character || segments.length >= 8} onClick={() => append(d)}>{d.label}</button>)}</div>
      <p className="manual-note">인물이 향한 방향 기준입니다. 뒤돌아 걷기는 180° 돌아 이동합니다. 시간은 목표 도착 시간이며 보폭에 따라 달라질 수 있습니다.</p>
      <ol>{segments.map((part, i) => <li key={i}>{part.label} · {part.distance}m · {part.seconds}초</li>)}</ol>
      <div className="manual-row"><button disabled={busy || !segments.length} onClick={() => setSegments(segments.slice(0, -1))}>마지막 단계 취소</button><button className="manual-primary" disabled={busy || !segments.length} onClick={() => perform(applyWalk)}>걷기 적용</button></div>
      <p className="manual-note">적용하면 선택한 인물의 기존 모션을 이 순서로 교체합니다. Ctrl+Z로 되돌릴 수 있습니다.</p>
      <h3>3. 확인 / 저장</h3>
      <div className="manual-row"><button disabled={busy} onClick={() => { s.setTlFrame(0); s.setTlPlaying(true); }}>처음부터 재생</button><button disabled={busy} onClick={() => s.setTlPlaying(false)}>일시정지</button></div>
      <button className="manual-primary manual-export" disabled={busy || !s.shots.length} onClick={() => perform(exportVideo)}>{busy ? '작업 중…' : '전체 영상 MP4로 저장'}</button>
      <p role={error ? 'alert' : 'status'} className={error ? 'manual-error' : 'manual-status'}>{message}</p>
    </div>}
  </section>;
}
