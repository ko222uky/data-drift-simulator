/** Loss values for axis ticks: small losses (< 0.1) need a third decimal to stay distinct. */
export const formatLossTick = (v: number) => (Math.abs(v) < 0.1 ? v.toFixed(3) : v.toFixed(2));
