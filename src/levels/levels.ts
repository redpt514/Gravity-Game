import type { LevelDef } from '../sim/types.ts';

export const LEVELS: LevelDef[] = [
  {
    id: 1, name: 'First Light',
    intro: 'Gas drifts too thin to hold together. Drop repulsors to squeeze it: where it gets dense enough, a cloud condenses.',
    seed: 101, particleCount: 1800, initialMix: { H: 1 },
    startingEnergy: 70, incomePerSec: 1.5, ambientGravity: 0.3,
    tools: ['repulsor'],
    goals: [{ type: 'clouds', count: 1, deadlineSec: 25, points: 100, label: 'Form 1 particle cloud' }],
  },
  {
    id: 2, name: 'Nursery',
    intro: 'Walls herd gas like fences: a long wall across the current dams it, and gas piles up on the upstream side. Clouds swallow the gas around them; a cloud of 40 mass becomes a planet.',
    seed: 202, particleCount: 2200, initialMix: { H: 1 },
    startingEnergy: 70, incomePerSec: 2, ambientGravity: 0.3,
    tools: ['repulsor', 'wall'],
    goals: [
      { type: 'clouds', count: 2, deadlineSec: 25, points: 100, label: 'Have 2 clouds (or bigger bodies)' },
      { type: 'planets', count: 2, deadlineSec: 55, points: 150, label: 'Grow 2 planets (mass 40)' },
    ],
  },
  {
    id: 3, name: 'Ignition',
    intro: 'Pile 120 mass into one body and it ignites as a star. Bodies grow faster in dense gas: keep squeezing gas into them. Lenses pull bodies together and feed them, but cannot make a cloud.',
    seed: 303, particleCount: 2400, initialMix: { H: 1 },
    startingEnergy: 90, incomePerSec: 2.5, ambientGravity: 0.3,
    tools: ['repulsor', 'wall', 'lens'],
    goals: [{ type: 'stars', count: 1, deadlineSec: 60, points: 250, label: 'Ignite 1 star (mass 120)' }],
  },
  {
    id: 4, name: 'Forge',
    intro: 'Stars fuse hydrogen into helium; heavier stars burn much faster. Pulses give a strong shove that fades over 20 seconds.',
    seed: 404, particleCount: 2800, initialMix: { H: 1 },
    startingEnergy: 100, incomePerSec: 2.5, ambientGravity: 0.3,
    tools: ['repulsor', 'wall', 'lens', 'pulse'],
    goals: [
      { type: 'stars', count: 1, deadlineSec: 55, points: 250, label: 'Ignite 1 star' },
      { type: 'element', el: 'He', count: 120, deadlineSec: 75, points: 300, label: 'Fuse 120 helium' },
    ],
  },
  {
    id: 5, name: 'Nova',
    intro: 'Old helium-rich gas. A star that runs low on hydrogen swells into a red giant, fusing carbon and oxygen; a giant of 250+ mass explodes as a supernova. Too light? It fades to a white dwarf, which blows up if you feed it to 320.',
    seed: 505, particleCount: 3000, initialMix: { H: 0.55, He: 0.45 },
    startingEnergy: 100, incomePerSec: 3, ambientGravity: 0.3,
    tools: ['repulsor', 'wall', 'lens', 'pulse'],
    goals: [
      { type: 'element', els: ['C', 'O'], count: 100, deadlineSec: 95, points: 400, label: 'Produce 100 carbon + oxygen (red giant)' },
      { type: 'novae', count: 1, deadlineSec: 95, points: 500, label: 'Trigger 1 supernova' },
    ],
    rewards: { black_hole: 1 },
  },
];

export function getLevel(id: number): LevelDef {
  const l = LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`unknown level ${id}`);
  return l;
}
