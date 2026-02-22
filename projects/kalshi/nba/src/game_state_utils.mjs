export function isGameCompleted(gs) {
  // ESPN scoreboard: state is typically 'pre' | 'in' | 'post'
  return gs?.ok && gs?.provider === 'espn' && gs?.state === 'post';
}
