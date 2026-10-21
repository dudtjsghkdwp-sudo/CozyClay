import { useEffect, useMemo, useState } from 'react';
import { useStudioShell } from './studio-shell-context.js';
import { ANGLE_LIMITS, ANGLE_PRESETS, DEFAULT_SCENE_ANGLE, angleToExactFraming, describeAngle, framingToAngle, normalizeAngle } from './scene-camera-angle.js';

// Per-scene camera angle on the timeline. Every shot (scene/clip) on the Shots
// lane owns its own angle: pick a shot here or click it on the timeline, set
// azimuth / elevation / distance / FOV, and it is written into that shot's own
// held framing, so playback, export and generation use it for that shot only.
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
  // Selecting another shot (here or on the timeline) loads that shot's angle.
  useEffect(() => { setAngle(stored ?? DEFAULT_SCENE_ANGLE); }, [active?.id, stored]);

  function selectShot(shot) {
    s.setTlPlaying(false);
    s.setTlFrame(shot.startFrame);
    s.enterShotLook?.();
  }
  async function apply(next = angle, shot = active) {
    if (!shot) throw new Error('먼저 타임라인에서 장면(샷)을 선택해 주세요.');
    if (!character) throw new Error('카메라가 바라볼 인물이 없습니다.');
    const value = normalizeAngle(next);
    s.setTlPlaying(false);
    await action('shot.frame', { shotId: shot.id, subjectIds: [character.id], framing: { exact: angleToExactFraming(character, value) } });
    s.setTlFrame(shot.startFrame);
    s.enterShotLook?.();
    setMessage(`'${shot.name}' 장면에 카메라 각도를 적용했습니다 — ${describeAngle(value)}`);
  }
  const update = (key, raw) => setAngle(current => normalizeAngle({ ...current, [key]: Number(raw) }));

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
      <div className="manual-presets">{ANGLE_PRESETS.map(p => <button key={p.id} disabled={busy} onClick={() => setAngle(current => normalizeAngle({ ...current, ...p.angle }))}>{p.label}</button>)}</div>
      {FIELDS.map(([key, label, unit]) => <label key={key} className="manual-slider">
        <span>{label} <b>{angle[key]}{unit}</b></span>
        <input type="range" aria-label={label} min={ANGLE_LIMITS[key].min} max={ANGLE_LIMITS[key].max} step={ANGLE_LIMITS[key].step} value={angle[key]} disabled={busy} onChange={e => update(key, e.target.value)} />
      </label>)}
      <div className="manual-row">
        <button disabled={busy} onClick={() => setAngle(stored ?? DEFAULT_SCENE_ANGLE)}>되돌리기</button>
        <button className="manual-primary" disabled={busy || !character} onClick={() => perform(() => apply())}>이 장면에 각도 적용</button>
      </div>
      <p className="manual-note">적용하면 이 장면(샷)만 해당 각도로 고정되고, 다른 장면의 카메라는 바뀌지 않습니다. 재생·MP4 저장·영상 생성에 그대로 쓰이며 Ctrl+Z로 되돌릴 수 있습니다.</p>
    </>}
  </>;
}
