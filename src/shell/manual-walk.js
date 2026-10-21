// The UI builds the same deterministic motion spec used by the studio compiler.
export const WALK_DIRECTIONS = [
  { label: '↖ 왼쪽 45°', turn: 45 }, { label: '↑ 직진', turn: 0 }, { label: '↗ 오른쪽 45°', turn: -45 },
  { label: '← 좌회전', turn: 90 }, { label: '↓ 뒤돌아 걷기', turn: 180 }, { label: '→ 우회전', turn: -90 },
  { label: '↙ 왼뒤 45°', turn: 135 }, { label: '↘ 오른뒤 45°', turn: -135 },
];
export function buildWalkSpec(character, segments) {
  if (!character || !segments.length || segments.length > 8) throw new Error('이동을 1~8개 추가해 주세요.');
  let x = character.x ?? 0, z = character.z ?? 0, heading = character.rot ?? 0, frame = 0;
  const use = [{ skill: 'standIdle', f0: 0, args: { at: [x, z], heading } }];
  for (const segment of segments) {
    const { distance, seconds, turn } = segment;
    if (![distance, seconds, turn].every(Number.isFinite) || distance < .5 || distance > 3 || seconds < 3 || seconds > 8) throw new Error('거리는 0.5~3m, 시간은 3~8초로 입력해 주세요.');
    heading += turn;
    x += Math.sin(heading * Math.PI / 180) * distance;
    z += Math.cos(heading * Math.PI / 180) * distance;
    if (Math.abs(x) > 10 || Math.abs(z) > 10) throw new Error('이동 경로가 무대 바깥으로 나갑니다. 거리나 방향을 줄여 주세요.');
    const arrive = frame + Math.round(seconds * 24);
    use.push({ skill: 'walkTo', f0: frame, args: { to: [x, z], arrive } });
    frame = arrive + 1;
  }
  return { schema: 'cozyclay.motion-spec.v1', fps: 24, frames: 'auto', label: '직접 조작 걷기', use };
}
