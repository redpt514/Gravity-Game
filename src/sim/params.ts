/** All simulation tuning numbers live here (mutable only for tuning experiments). */
export const P = {
  // ---- particles ----
  damping: 0.92,          // velocity multiplier per tick
  accel: 1.0,             // scale on -grad(potential) -> acceleration
  maxSpeed: 2.4,          // world units / tick
  initSpeed: 0.12,
  boundMargin: 4,         // soft wall width at board edges
  boundK: 0.06,           // soft wall spring
  // ---- gas current: counter-clockwise (on screen) elliptical circulation, divergence-free ----
  swirl: 0.014,           // drive acceleration at the top/bottom edge; terminal speed ~ swirl/(1-damping)
  swirlFadeStart: 0.55,    // in (dx/a)^2+(dy/b)^2 units; current fades out toward the corners
  swirlFadeEnd: 0.95,
  // ---- pressure: gas resists being squeezed above pressureRef; holes refill only slowly ----
  densityBlurPasses: 2,   // smoothing of density (3x3 box, n passes) used for pressure + cloud detection
  pressureRef: 0,         // particles/cell; 0 = level mean density
  pressureK: 0.15,        // potential per (particles/cell) above ref
  pressureKLow: 0.15,     // ... below ref (weak suction into holes)
  // ---- self gravity: only gas denser than threshold gravitates ("density begets gravity") ----
  gravThreshold: 1.9,     // x level mean density (smoothed) above which gas self-gravitates
  gravG: 0.4,
  gravBlurR: 2,
  gravBlurPasses: 2,
  bodyGravMul: 0.1,      // body mass -> gravity source
  bodyPressureFill: 1.0,  // bodies count as reference-density gas for pressure
  // ---- ambient: weak pull toward centre + slow travelling ripples ----
  ambientScale: 0.3,
  ambientPulseAmp: 0.3,
  ambientPulsePeriod: 240, // ticks
  rippleAmp: 0.15,
  rippleWaveLen: 40,
  // ---- clouds ----
  cloudDensity: 2.4,      // x level mean density (smoothed) to condense a cloud
  cloudCaptureR: 4.5,
  cloudMinParticles: 14,
  cloudCheckEvery: 3,
  cloudSettleTicks: 15,   // no clouds in the first ticks of a level: random spawn clumps must not count
  minBodySpacing: 7,
  maxNewCloudsPerCheck: 3,
  cloudMaxBirthMass: 30,  // a new cloud captures at most this many (nearest) particles; the rest must be accreted
  // ---- lens: acts on bodies, only weakly on free gas ----
  lensGasFrac: 0.15,      // fraction of the lens potential felt by free gas
  lensNoCloudR: 1.0,      // x lens radius: no cloud condenses inside (lens only works on existing bodies)
  lensFeedMul: 1.8,       // accretion rate multiplier for bodies inside a lens radius
  lensAccreteAdd: 1.5,    // extra accretion radius for bodies inside a lens radius
  // ---- bodies ----
  planetMass: 40,
  starMass: 120,
  giantHFrac: 0.3,        // star_ms -> giant when H fraction below this
  giantEndHeFrac: 0.12,   // giant ends when He fraction below this
  novaMass: 250,          // giant >= this at end -> supernova, else white dwarf
  wdNovaMass: 320,        // white dwarf accreting to this mass explodes (type Ia)
  collapseMass: 600,      // any body >= this -> black hole
  neutronMaxMass: 200,    // neutron stars do not accrete gas; merged past this they collapse to a black hole
  fusionK: 2.2e-6,        // H->He per tick = fusionK * m^2
  giantFusionMul: 2.5,    // He->C/O rate multiplier
  novaEjectFrac: 0.6,
  novaFeFrac: 0.15,       // of ejecta, newly made Fe
  novaHeavyFrac: 0.05,    // of ejecta, newly made heavy elements
  novaSpeed: 1.8,
  bodyMobility: 0.35,     // bodies respond to field gradient this much
  bodyDrift: 0.5,         // bodies are carried by the gas current this much (black holes: 0)
  bodyDamping: 0.9,
  bodyMinCurrent: 0.5,    // bodies feel at least this fraction of the current, even in the corners (no stranding)
  bodyEdgeMargin: 3,      // soft edge push for bodies, beyond their radius
  bodyMaxSpeed: 0.8,
  mergeFactor: 0.9,       // merge when dist < (ra+rb)*mergeFactor
  accreteMul: 1.2,        // accretion radius = radius * accreteMul + accreteAdd
  accreteAdd: 1.0,
  accreteBase: 0.02,      // max particles captured per tick = base + massMul * mass
  accreteMassMul: 0.00015,
  accreteMaxBudget: 3,
  accreteFeedMin: 0.1,    // rate multiplier = local FREE-gas density / cloud threshold, clamped
  accreteFeedMax: 6,
  /** body radius = a + b*sqrt(mass), per kind */
  bodyRadius: {
    cloud: [1.5, 0.4], planet: [1.0, 0.2], star_ms: [1.5, 0.25], star_giant: [2.5, 0.4],
    white_dwarf: [1.5, 0], neutron: [1.2, 0], black_hole: [2, 0.1],
  } as Record<string, [number, number]>,
  // ---- nodes ----
  wallMaxLen: 50,
  wallMinLen: 5,
  nodeMinSpacing: 4,      // same-tool nodes (wall midpoints) must be at least this far apart
  blackHoleConsumeFrac: 0.3,
  blackHoleStartMass: 100,
  // ---- bookkeeping ----
  logLines: 10,
  eventKeepSec: 5,        // state.events keeps the last few seconds
};
export type Params = typeof P;

/**
 * POINTS: earned live when things form (and per unit of element produced), plus goal bonuses; spent on hints.
 * Every level starts with `startPoints` so the first hint is affordable before anything has formed.
 */
export const POINTS = {
  cloud: 20,
  planet: 40,
  star_ms: 100,
  star_giant: 150,
  white_dwarf: 200,
  neutron: 250,
  black_hole: 400,
  supernova: 500,
  /** per unit produced by fusion / supernovae (H is never produced) */
  element: { H: 0, He: 1, C: 2, O: 2, Fe: 5, heavy: 10 } as Record<'H' | 'He' | 'C' | 'O' | 'Fe' | 'heavy', number>,
  /** goal met: goal.points x (1 + goalEarlyBonus x remainingSec / deadlineSec) */
  goalEarlyBonus: 1,
  /** hint k (0-based, per level) costs hintCost x (1 + k) */
  hintCost: 50,
  startPoints: 50,
};
