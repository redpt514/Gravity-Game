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
  minBodySpacing: 7,
  maxNewCloudsPerCheck: 3,
  // ---- bodies ----
  planetMass: 40,
  starMass: 120,
  giantHFrac: 0.3,        // star_ms -> giant when H fraction below this
  giantEndHeFrac: 0.12,   // giant ends when He fraction below this
  novaMass: 250,          // giant >= this at end -> supernova, else white dwarf
  wdNovaMass: 320,        // white dwarf accreting to this mass explodes (type Ia)
  collapseMass: 600,      // any body >= this -> black hole
  fusionK: 2.2e-6,        // H->He per tick = fusionK * m^2
  giantFusionMul: 2.5,    // He->C/O rate multiplier
  novaEjectFrac: 0.6,
  novaFeFrac: 0.15,       // of ejecta, newly made Fe
  novaHeavyFrac: 0.05,    // of ejecta, newly made heavy elements
  novaSpeed: 1.8,
  bodyMobility: 0.35,     // bodies respond to field gradient this much
  bodyDrift: 0.5,         // bodies are carried by the gas current this much (black holes: 0)
  bodyDamping: 0.9,
  bodyMaxSpeed: 0.8,
  mergeFactor: 0.9,       // merge when dist < (ra+rb)*mergeFactor
  accreteMul: 1.2,        // accretion radius = radius * accreteMul + accreteAdd
  accreteAdd: 1.0,
  accreteBase: 0.02,      // max particles captured per tick = base + massMul * mass
  accreteMassMul: 0.00015,
  accreteMaxBudget: 3,
  accreteFeedMin: 0.25,   // rate multiplier = local density / cloud threshold, clamped
  accreteFeedMax: 2,
  /** body radius = a + b*sqrt(mass), per kind */
  bodyRadius: {
    cloud: [1.5, 0.4], planet: [1.0, 0.2], star_ms: [1.5, 0.25], star_giant: [2.5, 0.4],
    white_dwarf: [1.5, 0], neutron: [1.2, 0], black_hole: [2, 0.1],
  } as Record<string, [number, number]>,
  // ---- nodes ----
  wallMaxLen: 50,
  blackHoleConsumeFrac: 0.3,
  blackHoleStartMass: 100,
  // ---- scoring / bookkeeping ----
  scoreCloud: 10,
  scoreStar: 50,
  scoreNova: 200,
  scorePerElement: 1,
  logLines: 10,
  goalEvalEvery: 10,
};
export type Params = typeof P;
