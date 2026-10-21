import { useMemo, useState } from 'react';
import { useStudioShell } from './studio-shell-context.js';
import { COMMAND_HELP, parseCameraCommand, segmentsEndFrame, shotsFromSegments } from './camera-command.js';

// AI-free camera command input: type time ranges and angle words, preview
// the parsed shots, apply them to the timeline in one step (one Ctrl+Z).
const toSec = (frame, fps) => `${(frame / fps).toFixed(frame % fps ? 1 : 0)}초`;

export default function CameraCommandBox({ busy, perform, action, setMessage, character }) {
  const s = useStudioShell();
  const fps = s.tlFps || 24;
  const [text, setText] = useState('');
  const parsed = useMemo(() => text.trim() ? parseCameraCommand(text, { fps, frameCount: s.tlFrameCount || fps * 10 }) : null, [text, fps, s.tlFrameCount]);
  const ready = parsed && parsed.segments.length > 0 && parsed.errors.length === 0;

  async function apply() {
    if (!character) throw new Error('카메라가 바라볼 인물이 없습니다.');
    s.setTlPlaying(false);
    const needed = segmentsEndFrame(parsed.segments);
    if (needed > s.tlFrameCount) await action('shot.setTimeline', { frameCount: Math.max(24, needed) });
    const shots = shotsFromSegments(s.shots, parsed.segments, character);
    await action('shot.replace', { shots });
    s.setTlFrame(parsed.segments[0].startFrame);
    s.enterShotLook?.();
    setMessage(`${parsed.segments.length}개 장면의 카메라 각도를 타임라인에 적용했습니다. Ctrl+Z로 되돌릴 수 있어요.`);
  }

  return <>
    <h3>카메라 명령 입력 (AI 없이)</h3>
    <textarea className="manual-command" rows={3} aria-label="카메라 명령" value={text} disabled={busy}
      placeholder={COMMAND_HELP} onChange={e => setText(e.target.value)} />
    <details className="manual-note"><summary>사용법 / 예시</summary>
      <pre className="manual-help">{COMMAND_HELP}</pre>
      시간: 0-5초, 0~5초, 0-48f(프레임) · 각도: 정면, 앞 3/4, 측면, 후면(뒷모습), 뒤 3/4, 로우, 하이, 탑뷰, 아이레벨 · 크기: 클로즈업, 미디엄, 풀샷(와이드) · 숫자: 거리 3, 높이 30, 회전 45, 화각 35 · 줄바꿈이나 쉼표로 구분 · “N초마다 여러 각도”는 타임라인 전체를 N초씩 나눠 여러 각도를 번갈아 넣어요. 겹치는 기존 샷은 새 샷으로 바뀝니다.
    </details>
    {parsed && <div className="manual-preview" aria-live="polite">
      {parsed.segments.length > 0 && <ol>{parsed.segments.map((seg, i) => <li key={i}>{toSec(seg.startFrame, fps)}–{toSec(seg.endFrame + 1, fps)} · {seg.label} <small>(회전 {seg.angle.azimuthDeg}° · 높이 {seg.angle.elevationDeg}° · 거리 {seg.angle.distance}m)</small></li>)}</ol>}
      {parsed.errors.map((err, i) => <p key={i} className="manual-error">{err.text ? `“${err.text}” — ` : ''}{err.message}</p>)}
    </div>}
    <button className="manual-primary manual-export" disabled={busy || !ready} onClick={() => perform(apply)}>{ready ? `${parsed.segments.length}개 장면 적용` : '명령을 입력하면 미리보기가 나와요'}</button>
  </>;
}
