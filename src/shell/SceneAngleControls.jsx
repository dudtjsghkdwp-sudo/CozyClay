import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudioShell } from './studio-shell-context.js';
import { ANGLE_LIMITS, ANGLE_PRESETS, DEFAULT_SCENE_ANGLE, angleToExactFraming, describeAngle, framingToAngle, normalizeAngle, subjectPivot } from './scene-camera-angle.js';
import { exactFromView, onCameraView } from '../camera-view-sync.js';
import { fovToFocalMm } from '../shot.js';

// Per-scene camera angle on the timeline. Every shot (scene/clip) on the Shots
// lane owns its own angle: pick a shot here or click it on the timeline, set
// azimuth / elevation / distance / FOV with the sliders or by dragging the
// viewport with the mouse, and it is written into that shot's own held framing.
const FIELDS = [
  ['azimuthDeg', '방위각 (좌우 회전)', '°'],
  ['elevationDeg', '고도 (위아래)', '°'],
  ['distance', '거리', 'm'],
  ['fovDeg', '화각 (FOV)', '°'],
];

export default function SceneAngleControls({ busy, perform, action, setMessage, character }) {
  const s = useStudioShell();
  const shots = useMemo(() => [...(s.shots ?? [])].sort((a, b) => a.startFrame - b.startFrame), [s.shots]);
  const active = s.activeShot ?? null;
  const stored = useMemo(() => framingToAngle(character, active?.cameraKeys?.[0]?.framing), [active, character]);
  const [angle, setAngle] = useState(() => stored ?? DEFAULT_SCENE_ANGLE);
  const [autoApply, setAutoApply] = useState(true);
  const view = useRef(null); // last viewport framing the mouse produced
  // Selecting another shot (here or on the timeline) loads that shot's angle.
  useEffect(() => { view.current = null; setAngle(stored ?? DEFAULT_SCENE_ANGLE); }, [active?.id, stored]);

  const live = useRef({});
  live.current = { active, character, autoApply, busy, look: s.lookThroughShot, perform };
  // Mouse in the viewport -> sliders, live; on release, optionally save.
  useEffect(() => onCameraView(({ framing, final }) => {
    const { active: shot, character: subject, autoApply: auto, busy: working, look, perform: run } = live.current;
    if (!look || !subject) return;
    const next = framingToAngle(subject, framing);
    if (!next) return;
    view.current = framing;
    setAngle(next);
    if (final && auto && shot && !working) run(() => applyView(shot, framing, next));
  }), []);

  function selectShot(shot) {
    s.setTlPlaying(false);
    s.setTlFrame(shot.startFrame);
    s.enterShotLook?.();
  }
  async function applyView(shot, framing, value) {
    const subject = live.current.character;
    const exact = exactFromView(framing, subjectPivot(subject), Math.round(fovToFocalMm(value.fovDeg * Math.PI / 180) * 10) / 10);
    await action('shot.frame', { shotId: shot.id, subjectIds: [subject.id], framing: { exact } });
    setMessage(`마우스로 바꾼 구도를 '${shot.name}' 장면에 저장했습니다 — ${describeAngle(value)} (Ctrl+Z로 되돌리기)`);
  }
  async function apply(next = angle, shot = active) {
    if (!shot) throw new Error('먼저 타임라인에서 장면(샷)을 선택해 주세요.');
    if (!character) throw new Error('카메라가 바라볼 인물이 없습니다.');
    const value = normalizeAngle(next);
    s.setTlPlaying(false);
    // The mouse view, if the sliders still show it, is saved as seen (pan
    // included); a slider edit is saved as a clean orbit around the subject.
    const fromMouse = view.current && JSON.stringify(framingToAngle(character, view.current)) === JSON.stringify(value);
    if (fromMouse) await applyView(shot, view.current, value);
    else {
      await action('shot.frame', { shotId: shot.id, subjectIds: [character.id], framing: { exact: angleToExactFraming(character, value) } });
      setMessage(`'${shot.name}' 장면에 카메라 각도를 적용했습니다 — ${describeAngle(value)}`);
    }
    s.setTlFrame(shot.startFrame);
    s.enterShotLook?.();
  }
  const update = (key, raw) => { view.current = null; setAngle(current => normalizeAngle({ ...current, [key]: Number(raw) })); };

  return <>
    <h3>장면별 카메라 각도</h3>
    {!shots.length && <p className="manual-note">타임라인에 샷이 없습니다. 샷을 먼저 만들면 장면마다 각도를 따로 지정할 수 있어요.</p>}
    {shots.length > 0 && <div className="manual-shots" role="listbox" aria-label="장면 선택">
      {shots.map((shot, index) => <button key={shot.id} role="option" aria-selected={active?.id === shot.id} className={active?.id === shot.id ? 'manual-shot is-active' : 'manual-shot'} disabled={busy} onClick={() => selectShot(shot)}>
        <strong>{index + 1}. {shot.name}</strong><small>{shot.startFrame}–{shot.endFrame}f</small>
      </button>)}
    </div>}
    {active && <>
      <p className="manual-note">선택된 장면: <b>{active.name}</b> · {describeAngle(angle)}{stored ? '' : ' (아직 저장된 각도 없음)'}</p>
      <p className="manual-note">{s.lookThroughShot ? '화면에서 마우스 왼쪽 드래그: 회전 · 휠: 거리 · 휠 버튼 드래그: 이동 — 슬라이더가 함께 움직여요.' : '장면을 선택하면 샷 카메라로 전환되어 마우스로 각도를 바꿀 수 있어요.'}</p>
      <label className="manual-check"><input type="checkbox" checked={autoApply} onChange={e => setAutoApply(e.target.checked)} /> 마우스를 놓으면 이 장면에 자동 저장</label>
      <div className="manual-presets">{ANGLE_PRESETS.map(p => <button key={p.id} disabled={busy} onClick={() => { view.current = null; setAngle(current => normalizeAngle({ ...current, ...p.angle })); }}>{p.label}</button>)}</div>
      {FIELDS.map(([key, label, unit]) => <label key={key} className="manual-slider">
        <span>{label} <b>{angle[key]}{unit}</b></span>
        <input type="range" aria-label={label} min={ANGLE_LIMITS[key].min} max={ANGLE_LIMITS[key].max} step={ANGLE_LIMITS[key].step} value={angle[key]} disabled={busy} onChange={e => update(key, e.target.value)} />
      </label>)}
      <div className="manual-row">
        <button disabled={busy} onClick={() => { view.current = null; setAngle(stored ?? DEFAULT_SCENE_ANGLE); }}>되돌리기</button>
        <button className="manual-primary" disabled={busy || !character} onClick={() => perform(() => apply())}>이 장면에 각도 적용</button>
      </div>
      <p className="manual-note">적용하면 이 장면(샷)만 해당 각도로 고정되고, 다른 장면의 카메라는 바뀌지 않습니다. 재생·MP4 저장·영상 생성에 그대로 쓰이며 Ctrl+Z로 되돌릴 수 있습니다.</p>
    </>}
  </>;
}
