/**
 * Canonical frame <-> board. Plans (calibration bot, hint engine) are written in a frame where u runs along the
 * long edge, v across it, and the gas current along v=0 flows toward -u; this maps them onto any board shape
 * and current direction.
 */
export class Frame {
  readonly L: number; readonly S: number;
  private readonly tall: boolean; private readonly flip: boolean;
  private readonly W: number; private readonly H: number;
  constructor(W: number, H: number, swirl: number) {
    this.W = W; this.H = H;
    this.tall = H > W;
    this.flip = swirl < 0;
    this.L = this.tall ? H : W;
    this.S = this.tall ? W : H;
  }
  toBoard(u: number, v: number): { x: number; y: number } {
    const uu = this.flip ? this.L - u : u;
    return this.tall ? { x: this.W - v, y: uu } : { x: uu, y: v };
  }
  toCanon(x: number, y: number): { u: number; v: number } {
    const u = this.tall ? y : x, v = this.tall ? this.W - x : y;
    return { u: this.flip ? this.L - u : u, v };
  }
}
