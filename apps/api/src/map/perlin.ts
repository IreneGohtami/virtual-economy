import { createNoise2D } from 'simplex-noise';

/**
 * Seeded pseudo-random number generator (mulberry32).
 * Takes a 32-bit seed and returns a function producing values in [0, 1).
 */
export function createSeededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Multi-octave 2D noise generator using simplex noise with seeded RNG.
 */
export interface NoiseConfig {
  seed: number;
  octaves?: number;
  persistence?: number;
  lacunarity?: number;
  scale?: number;
}

export interface NoiseGenerator {
  get(x: number, y: number): number;
}

/**
 * Creates a seeded multi-octave 2D noise generator.
 * Output is normalized to [0, 1].
 */
export function createSeededNoise(config: NoiseConfig): NoiseGenerator {
  const {
    seed,
    octaves = 4,
    persistence = 0.5,
    lacunarity = 2.0,
    scale = 0.05,
  } = config;

  const rng = createSeededRng(seed);
  const noise2D = createNoise2D(rng);

  return {
    get(x: number, y: number): number {
      let amplitude = 1;
      let frequency = scale;
      let noiseValue = 0;
      let maxAmplitude = 0;

      for (let i = 0; i < octaves; i++) {
        noiseValue += amplitude * noise2D(x * frequency, y * frequency);
        maxAmplitude += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
      }

      // Normalize from [-1, 1] to [0, 1]
      return (noiseValue / maxAmplitude + 1) / 2;
    },
  };
}
