import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useStudioShell } from './studio-shell-context.js';
import { REFERENCE_ACCEPT } from '../reference-media.js';
import { LIGHTING_LABEL_KO, VISION_HELP_KO, addReferenceFile, analysisToShot, analyzeCuts, rangesToSegments, referenceStore, requestVisionAnalysis, shotKeyframes } from '../reference-video.js';
import { shotsFromSegments, segmentsEndFrame } from './camera-command.js';
import { readStoredModel } from '../workflow/agent-client.js';

// 참고 영상: read framing, camera and lighting from a reference — the video
// never enters the 3D scene. Synced to the playhead; side-by-side or overlaid.
export const INSERT_SCENE_IMAGE_EVENT = 'cozyclay:insert-scene-image';
const sec = (t) => `${t.toFixed(1)}초`;
const useRefs = () => useSyncExternalStore(referenceStore.subscribe, referenceStore.get);

/** A <video>/<img> that follows the timeline playhead. */
function SyncedMedia({ item, className, style }) {
  const s = useStudioShell();
  const ref = useRef(null);
  const fps = s.tlFps || 24;
  const target = Math.max(0, s.tlFrame / fps + (item.offset || 0));
  useEffect(() => {
    const v = ref.current; if (!v || item.kind !== 'video') return;
    if (s.tlPlaying) { if (Math.abs(v.currentTime - target) > 0.25) v.currentTime = target; v.play?.().catch(() => {}); }
    else { v.pause?.(); if (Math.abs(v.currentTime - target) > 0.02) v.currentTime = Math.min(target, Math.max(0, (item.duration || target) - 0.04)); }
  }, [target, s.tlPlaying, item]);
  return item.kind === 'video'
    ? <video ref={ref} className={className} style={style} src={item.url} muted playsInline preload="auto" />
    : <img className={className} style={style} src={item.url} alt={`참고 이미지 ${item.name}`} />;
}

function Grid() {
  return <svg className="ref-grid" viewBox="0 0 3 3" preserveAspectRatio="none" aria-hidden="true">
    <path d="M1 0V3M2 0V3M0 1H3M0 2H3" stroke="#fff" strokeWidth="0.012" opacity="0.75" vectorEffect="non-scaling-stroke" />
    <path d="M1.5 1.4V1.6M1.4 1.5H1.6" stroke="#ffd34d" strokeWidth="0.02" vectorEffect="non-scaling-stroke" />
  </svg>;
}

/** Side-by-side window or full overlay inside the 3D viewport. */
export function ReferenceViewportOverlay() {
  const { view } = useRefs();
  const item = referenceStore.active();
  const host = typeof document === 'undefined' ? null : document.querySelector('.viewport');
  if (!item || view.mode === 'off' || !host) return null;
  const overlay = view.mode === 'overlay';
  return createPortal(<div className={overlay ? 'ref-overlay' : 'ref-side'} data-testid="reference-viewport" aria-label="참고 영상 미리보기">
    <div className="ref-frame" style={{ aspectRatio: `${item.width || 16} / ${item.height || 9}` }}>
      <SyncedMedia item={item} className="ref-media" style={overlay ? { opacity: view.opacity } : undefined} />
      {view.grid && <Grid />}
    </div>
    {!overlay && <span className="ref-caption">참고: {item.name}</span>}
  </div>, host);
}

export default function ReferenceVideoPanel({ busy, perform, action, setMessage, character }) {
  const s = useStudioShell();
  const { items, view } = useRefs();
  const item = referenceStore.active();
  const fileRef = useRef(null);
  const [progress, setProgress] = useState(null);
  const [aiNote, setAiNote] = useState('');
  const fps = s.tlFps || 24;
  const setView = (patch) => referenceStore.set((st) => ({ view: { ...st.view, ...patch } }));

  async function add(files) {
    for (const file of files) {
      setMessage(`${file.name} 불러오는 중…`);
      const added = await addReferenceFile(file);
      setMessage(`참고 ${added.kind === 'video' ? '영상' : '이미지'} 추가: ${added.name}. 장면에는 넣지 않고 구도·카메라·조명 참고용으로만 써요.`);
    }
  }
  async function findCuts() {
    if (item.kind !== 'video') throw new Error('컷 찾기는 영상에서만 할 수 있어요.');
    setProgress(0); setMessage('컷(장면 전환)을 찾는 중…');
    try {
      const { cuts, shots } = await analyzeCuts(item, { onProgress: setProgress });
      referenceStore.update(item.id, { cuts, shots });
      setMessage(`컷 ${cuts.length}개를 찾아 ${shots.length}개 샷으로 나눴어요. 필요하면 샷별 설명을 고친 뒤 ‘참고 영상 컷에 맞춰 샷 나누기’를 누르세요.`);
    } finally { setProgress(null); }
  }
  async function splitShots() {
    if (!character) throw new Error('카메라가 바라볼 인물이 없습니다.');
    const segments = rangesToSegments(item.shots, fps, item.offset || 0);
    if (!segments.length) throw new Error('먼저 ‘컷 찾기’를 눌러 주세요.');
    s.setTlPlaying(false);
    const needed = segmentsEndFrame(segments);
    if (needed > s.tlFrameCount) await action('shot.setTimeline', { frameCount: needed });
    await action('shot.replace', { shots: shotsFromSegments(s.shots, segments, character) });
    s.setTlFrame(segments[0].startFrame); s.enterShotLook?.();
    setMessage(`참고 영상과 같은 타이밍으로 ${segments.length}개 샷을 만들었어요. 샷별 설명의 카메라 단어(정면/측면/로우/클로즈업…)가 각도로 들어가요. Ctrl+Z로 되돌릴 수 있어요.`);
  }
  async function analyze() {
    const model = readStoredModel();
    if (!model) throw new Error('에이전트 패널에서 먼저 모델을 연결해 주세요. ' + VISION_HELP_KO);
    const shots = item.kind === 'image' ? [{ start: 0, end: Math.max(1, s.tlFrameCount / fps), heuristic: '' }] : item.shots;
    if (!shots?.length) throw new Error('먼저 ‘컷 찾기’를 눌러 주세요.');
    setAiNote(''); setMessage(`키프레임 ${shots.length}장을 ${model} 모델에 보내 분석 중… (로컬 CPU 모델은 몇 분 걸릴 수 있어요)`);
    try {
      const images = await shotKeyframes(item, shots);
      const result = await requestVisionAnalysis({ model, images });
      const next = shots.map((shot, i) => { const a = analysisToShot(result[i] ?? result[result.length - 1]); return { ...shot, text: a.text, angle: a.angle, size: a.size, lightingPreset: a.lightingPreset }; });
      referenceStore.update(item.id, { shots: next });
      setMessage(`분석 완료: ${next.length}개 샷. 설명을 고칠 수 있고, ‘컷에 맞춰 샷 나누기’로 카메라 각도를 적용해요.`);
    } catch (e) { if (e.textOnly) setAiNote(e.message); throw e; }
  }
  const editShot = (i, patch) => referenceStore.update(item.id, (it) => ({ shots: it.shots.map((sh, j) => j === i ? { ...sh, ...patch } : sh) }));

  return <>
    <h3>참고 영상 (구도·카메라·조명 참고)</h3>
    <p className="manual-note">영상/이미지는 장면에 넣지 않고 옆에 띄워 구도를 맞추는 데 써요. 타임라인 재생 위치에 맞춰 함께 움직여요. (프로젝트 파일에는 저장되지 않아요)</p>
    <input ref={fileRef} type="file" hidden multiple accept={REFERENCE_ACCEPT} aria-label="참고 영상 파일" onChange={(e) => { const files = [...e.target.files]; e.target.value = ''; perform(() => add(files)); }} />
    <div className="manual-row"><button disabled={busy} onClick={() => fileRef.current?.click()}>참고 영상/이미지 추가</button>
      {item && <button disabled={busy} onClick={() => { referenceStore.remove(item.id); setMessage('참고 자료를 목록에서 뺐어요.'); }}>목록에서 빼기</button>}</div>
    {items.length > 1 && <select aria-label="참고 자료 선택" value={item?.id ?? ''} onChange={(e) => referenceStore.set({ activeId: e.target.value })}>{items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}</select>}
    {item && <>
      <div className="ref-panel-preview"><SyncedMedia item={item} className="ref-media" /></div>
      <p className="manual-note">{item.kind === 'video' ? `영상 ${sec(item.duration)} · ${item.width}×${item.height}` : `이미지 ${item.width}×${item.height}`}</p>
      <div className="manual-row" role="group" aria-label="참고 영상 보기 방식">
        {[['off', '숨기기'], ['side', '나란히 보기'], ['overlay', '겹쳐 보기']].map(([mode, label]) => <button key={mode} aria-pressed={view.mode === mode} className={view.mode === mode ? 'manual-primary' : ''} onClick={() => { setView({ mode }); if (mode !== 'off') s.enterShotLook?.(); }}>{label}</button>)}
      </div>
      {view.mode === 'overlay' && <label className="manual-slider">투명도 {Math.round(view.opacity * 100)}%<input type="range" min="0.1" max="1" step="0.05" value={view.opacity} onChange={(e) => setView({ opacity: Number(e.target.value) })} /></label>}
      <label className="manual-check"><input type="checkbox" checked={view.grid} onChange={(e) => setView({ grid: e.target.checked })} /> 3분할 격자 표시</label>
      {item.kind === 'video' && <label className="manual-slider">시작 위치 보정 {sec(item.offset || 0)}<input type="range" min="0" max={Math.max(0, item.duration)} step="0.1" value={item.offset || 0} onChange={(e) => referenceStore.update(item.id, { offset: Number(e.target.value) })} /></label>}
      <p className="manual-note">카메라를 마우스로 돌려 참고 영상과 구도를 맞춘 뒤 ‘이 장면에 각도 적용’이나 ‘현재 구도 저장’을 누르세요.</p>
      <div className="manual-row">
        {item.kind === 'video' && <button disabled={busy} onClick={() => perform(findCuts)}>{progress != null ? `컷 찾는 중 ${Math.round(progress * 100)}%` : '컷 찾기'}</button>}
        <button disabled={busy || (item.kind === 'video' && !item.shots.length)} onClick={() => perform(analyze)}>구도·카메라·조명 분석 (AI)</button>
        {item.kind === 'image' && <button disabled={busy} onClick={() => { globalThis.dispatchEvent(new CustomEvent(INSERT_SCENE_IMAGE_EVENT, { detail: { file: item.file } })); setMessage('이미지를 장면에 판(컷아웃)으로 넣었어요. Ctrl+Z로 되돌릴 수 있어요.'); }}>장면에 이미지로 넣기</button>}
      </div>
      {aiNote && <p className="manual-error">{aiNote}</p>}
      {item.shots.length > 0 && <>
        <ol className="ref-shots">{item.shots.map((shot, i) => <li key={i}>
          <button className="ref-shot-time" onClick={() => { s.setTlPlaying(false); s.setTlFrame(Math.max(0, Math.round((shot.start - (item.offset || 0)) * fps))); }}>{sec(shot.start)}–{sec(shot.end)}</button>
          {shot.heuristic && <small> {shot.heuristic}</small>}
          <textarea rows={2} aria-label={`샷 ${i + 1} 설명`} value={shot.text} placeholder="예: 측면 로우 앵글 클로즈업 · 움직임: 돌리 인 · 조명: 역광 소프트" onChange={(e) => editShot(i, { text: e.target.value, angle: null })} />
          {shot.lightingPreset && <button disabled={busy} onClick={() => perform(async () => { await action('stage.applyLighting', { preset: shot.lightingPreset }); setMessage(`조명 프리셋 ‘${LIGHTING_LABEL_KO[shot.lightingPreset]}’을 적용했어요. 조명은 장면 전체에 하나라서 샷마다 따로 저장되지는 않아요.`); })}>조명 ‘{LIGHTING_LABEL_KO[shot.lightingPreset] ?? shot.lightingPreset}’ 적용</button>}
        </li>)}</ol>
        <button className="manual-primary manual-export" disabled={busy} onClick={() => perform(splitShots)}>참고 영상 컷에 맞춰 샷 나누기 ({item.shots.length}개)</button>
      </>}
    </>}
  </>;
}
