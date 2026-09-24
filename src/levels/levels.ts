import type { LevelDef } from '../sim/types.ts';

export const LEVELS: LevelDef[] = [
  {
    id: 1, name: 'First Light',
    intro: 'Gas drifts too thin to hold together. Drop repulsors to squeeze it: where it gets dense enough, a cloud condenses.',
    seed: 101, particleCount: 1800, initialMix: { H: 1 },
    rounds: 2, ticksPerRound: 600, startingEnergy: 70, incomePerRound: 30, ambientGravity: 0.3,
    tools: ['repulsor'],
    goals: [{ type: 'clouds', count: 1, byRound: 2, label: 'Form 1 particle cloud' }],
  },
  {
    id: 2, name: 'Nursery',
    intro: 'Walls herd gas like fences: a long wall across the current dams it, and gas piles up on the upstream side. Clouds swallow the gas around them; a cloud of 40 mass becomes a planet.',
    seed: 202, particleCount: 2200, initialMix: { H: 1 },
    rounds: 3, ticksPerRound: 600, startingEnergy: 70, incomePerRound: 40, ambientGravity: 0.3,
    tools: ['repulsor', 'wall'],
    goals: [
      { type: 'clouds', count: 2, byRound: 2, label: 'Have 2 clouds (or bigger bodies)' },
      { type: 'planets', count: 2, byRound: 3, label: 'Grow 2 planets (mass 40)' },
    ],
  },
  {
    id: 3, name: 'Ignition',
    intro: 'Pile 120 mass into one body and it ignites as a star. Bodies grow faster in dense gas: keep squeezing gas into them. Lenses pull bodies together and feed them, but cannot make a cloud.',
    seed: 303, particleCount: 2400, initialMix: { H: 1 },
    rounds: 3, ticksPerRound: 600, startingEnergy: 90, incomePerRound: 50, ambientGravity: 0.3,
    tools: ['repulsor', 'wall', 'lens'],
    goals: [{ type: 'stars', count: 1, byRound: 3, label: 'Ignite 1 star (mass 120)' }],
  },
  {
    id: 4, name: 'Forge',
    intro: 'Stars fuse hydrogen into helium; heavier stars burn much faster. Pulses give a strong one-round shove.',
    seed: 404, particleCount: 2800, initialMix: { H: 1 },
    rounds: 4, ticksPerRound: 600, startingEnergy: 100, incomePerRound: 50, ambientGravity: 0.3,
    tools: ['repulsor', 'wall', 'lens', 'pulse'],
    goals: [
      { type: 'stars', count: 1, byRound: 3, label: 'Ignite 1 star by round 3' },
      { type: 'element', el: 'He', count: 120, byRound: 4, label: 'Fuse 120 helium' },
    ],
  },
  {
    id: 5, name: 'Nova',
    intro: 'Old helium-rich gas. A star that runs low on hydrogen swells into a red giant, fusing carbon and oxygen; a giant of 250+ mass explodes as a supernova. Too light? It fades to a white dwarf, which blows up if you feed it to 320.',
    seed: 505, particleCount: 3000, initialMix: { H: 0.55, He: 0.45 },
    rounds: 5, ticksPerRound: 600, startingEnergy: 100, incomePerRound: 60, ambientGravity: 0.3,
    tools: ['repulsor', 'wall', 'lens', 'pulse'],
    goals: [
      { type: 'element', els: ['C', 'O'], count: 100, byRound: 5, label: 'Produce 100 carbon + oxygen (red giant)' },
      { type: 'novae', count: 1, byRound: 5, label: 'Trigger 1 supernova' },
    ],
    rewards: { black_hole: 1 },
  },
];

export function getLevel(id: number): LevelDef {
  const l = LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`unknown level ${id}`);
  return l;
}
