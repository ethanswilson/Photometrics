/**
 * Photometric data for real-world film/stage lighting fixtures.
 *
 * Each fixture has:
 *   - name, manufacturer, wattage, lumen output
 *   - beamAngle (50% peak intensity, half-angle from center)
 *   - fieldAngle (10% peak intensity)
 *   - candela distribution: array of [angle_degrees, relative_intensity(0-1)]
 *     sampled from IES-style goniophotometer data
 *   - sourceSize: relative apparent size (affects edge softness)
 *   - zoomRange: [min_beam, max_beam] if zoomable
 */

export const FIXTURES = {
  // ---- FRESNELS ----
  arri_650w_fresnel: {
    name: 'ARRI 650W Fresnel',
    manufacturer: 'ARRI',
    type: 'fresnel',
    wattage: 650,
    lumens: 11500,
    beamAngle: 15,      // spot
    fieldAngle: 60,     // flood
    zoomRange: [15, 60],
    sourceSize: 0.12,   // small-medium (fresnel lens)
    colorTemp: 3200,
    // Candela distribution at spot position — normalized
    // IES C0 plane, angles from nadir (center of beam)
    candelaDistribution: [
      [0, 1.0], [2, 0.99], [4, 0.97], [6, 0.94], [8, 0.90],
      [10, 0.82], [12, 0.70], [14, 0.55], [16, 0.38], [18, 0.22],
      [20, 0.12], [25, 0.05], [30, 0.02], [40, 0.005], [60, 0.001],
      [90, 0.0]
    ],
    // Distribution when flooded
    candelaDistributionFlood: [
      [0, 1.0], [5, 0.98], [10, 0.95], [15, 0.90], [20, 0.82],
      [25, 0.70], [28, 0.55], [30, 0.40], [35, 0.22], [40, 0.10],
      [50, 0.03], [60, 0.01], [90, 0.0]
    ],
    peakCandela: 18500,
    peakCandelaFlood: 3200
  },

  arri_2kw_fresnel: {
    name: 'ARRI 2K Fresnel',
    manufacturer: 'ARRI',
    type: 'fresnel',
    wattage: 2000,
    lumens: 44000,
    beamAngle: 17,
    fieldAngle: 68,
    zoomRange: [17, 68],
    sourceSize: 0.15,
    colorTemp: 3200,
    candelaDistribution: [
      [0, 1.0], [2, 0.99], [4, 0.97], [6, 0.93], [8, 0.88],
      [10, 0.78], [12, 0.65], [14, 0.48], [16, 0.32], [18, 0.18],
      [20, 0.09], [25, 0.03], [30, 0.01], [40, 0.003], [60, 0.001],
      [90, 0.0]
    ],
    candelaDistributionFlood: [
      [0, 1.0], [5, 0.97], [10, 0.93], [15, 0.87], [20, 0.78],
      [25, 0.65], [30, 0.48], [35, 0.30], [40, 0.15], [50, 0.04],
      [60, 0.01], [90, 0.0]
    ],
    peakCandela: 55000,
    peakCandelaFlood: 9500
  },

  arri_5kw_fresnel: {
    name: 'ARRI 5K Fresnel',
    manufacturer: 'ARRI',
    type: 'fresnel',
    wattage: 5000,
    lumens: 110000,
    beamAngle: 15,
    fieldAngle: 59,
    zoomRange: [15, 59],
    sourceSize: 0.18,
    colorTemp: 3200,
    candelaDistribution: [
      [0, 1.0], [2, 0.99], [4, 0.96], [6, 0.92], [8, 0.85],
      [10, 0.74], [12, 0.60], [14, 0.44], [16, 0.28], [18, 0.15],
      [20, 0.07], [25, 0.02], [30, 0.007], [40, 0.002], [60, 0.0005],
      [90, 0.0]
    ],
    candelaDistributionFlood: [
      [0, 1.0], [5, 0.97], [10, 0.92], [15, 0.85], [20, 0.74],
      [25, 0.60], [30, 0.44], [35, 0.28], [40, 0.13], [50, 0.03],
      [60, 0.008], [90, 0.0]
    ],
    peakCandela: 140000,
    peakCandelaFlood: 24000
  },

  // ---- HMI / DAYLIGHT ----
  arri_m18_hmi: {
    name: 'ARRI M18 HMI (1800W)',
    manufacturer: 'ARRI',
    type: 'fresnel',
    wattage: 1800,
    lumens: 150000,
    beamAngle: 14,
    fieldAngle: 52,
    zoomRange: [14, 52],
    sourceSize: 0.14,
    colorTemp: 5600,
    candelaDistribution: [
      [0, 1.0], [2, 0.99], [4, 0.97], [6, 0.93], [8, 0.86],
      [10, 0.76], [12, 0.62], [14, 0.45], [16, 0.29], [18, 0.16],
      [20, 0.07], [25, 0.02], [30, 0.006], [40, 0.002], [60, 0.0005],
      [90, 0.0]
    ],
    candelaDistributionFlood: [
      [0, 1.0], [5, 0.97], [10, 0.93], [15, 0.86], [20, 0.76],
      [25, 0.62], [30, 0.45], [35, 0.28], [40, 0.13], [50, 0.03],
      [60, 0.008], [90, 0.0]
    ],
    peakCandela: 190000,
    peakCandelaFlood: 33000
  },

  // ---- OPEN FACE ----
  arri_1k_open: {
    name: 'ARRI 1K Open Face',
    manufacturer: 'ARRI',
    type: 'open_face',
    wattage: 1000,
    lumens: 21500,
    beamAngle: 22,
    fieldAngle: 72,
    zoomRange: [22, 72],
    sourceSize: 0.06,   // small point source, hard light
    colorTemp: 3200,
    candelaDistribution: [
      [0, 1.0], [3, 0.97], [6, 0.92], [9, 0.84], [12, 0.72],
      [15, 0.56], [18, 0.38], [20, 0.26], [25, 0.10], [30, 0.04],
      [40, 0.01], [60, 0.002], [90, 0.0]
    ],
    candelaDistributionFlood: [
      [0, 1.0], [5, 0.96], [10, 0.90], [15, 0.80], [20, 0.68],
      [25, 0.52], [30, 0.36], [35, 0.22], [40, 0.11], [50, 0.03],
      [60, 0.008], [90, 0.0]
    ],
    peakCandela: 35000,
    peakCandelaFlood: 6000
  },

  // ---- PAR ----
  par64_nsp: {
    name: 'PAR 64 NSP (1000W)',
    manufacturer: 'Generic',
    type: 'par',
    wattage: 1000,
    lumens: 21000,
    beamAngle: 7,
    fieldAngle: 14,
    zoomRange: null,
    sourceSize: 0.04,   // very hard, small source
    colorTemp: 3200,
    candelaDistribution: [
      [0, 1.0], [1, 0.99], [2, 0.97], [3, 0.93], [4, 0.86],
      [5, 0.73], [6, 0.55], [7, 0.35], [8, 0.18], [10, 0.05],
      [12, 0.015], [15, 0.005], [20, 0.001], [30, 0.0003],
      [60, 0.0], [90, 0.0]
    ],
    peakCandela: 275000
  },

  par64_mfl: {
    name: 'PAR 64 MFL (1000W)',
    manufacturer: 'Generic',
    type: 'par',
    wattage: 1000,
    lumens: 21000,
    beamAngle: 14,
    fieldAngle: 28,
    zoomRange: null,
    sourceSize: 0.06,
    colorTemp: 3200,
    candelaDistribution: [
      [0, 1.0], [2, 0.98], [4, 0.94], [6, 0.87], [8, 0.76],
      [10, 0.60], [12, 0.42], [14, 0.25], [16, 0.13], [18, 0.06],
      [20, 0.025], [25, 0.005], [30, 0.001], [60, 0.0], [90, 0.0]
    ],
    peakCandela: 68000
  },

  // ---- ELLIPSOIDAL (ERS / LEKO) ----
  etc_source4_26deg: {
    name: 'ETC Source Four 26° (750W)',
    manufacturer: 'ETC',
    type: 'ellipsoidal',
    wattage: 750,
    lumens: 14800,
    beamAngle: 13,
    fieldAngle: 26,
    zoomRange: null,
    sourceSize: 0.03,   // very hard gate-projected beam
    colorTemp: 3200,
    candelaDistribution: [
      [0, 1.0], [2, 0.99], [4, 0.98], [6, 0.96], [8, 0.92],
      [10, 0.85], [11, 0.75], [12, 0.58], [13, 0.35], [14, 0.12],
      [15, 0.03], [16, 0.008], [18, 0.002], [20, 0.001],
      [30, 0.0], [60, 0.0], [90, 0.0]
    ],
    peakCandela: 105000
  },

  etc_source4_36deg: {
    name: 'ETC Source Four 36° (750W)',
    manufacturer: 'ETC',
    type: 'ellipsoidal',
    wattage: 750,
    lumens: 14800,
    beamAngle: 18,
    fieldAngle: 36,
    zoomRange: null,
    sourceSize: 0.03,
    colorTemp: 3200,
    candelaDistribution: [
      [0, 1.0], [3, 0.99], [6, 0.97], [9, 0.93], [12, 0.86],
      [14, 0.75], [16, 0.58], [17, 0.42], [18, 0.25], [19, 0.10],
      [20, 0.03], [22, 0.006], [25, 0.001], [30, 0.0003],
      [60, 0.0], [90, 0.0]
    ],
    peakCandela: 48000
  },

  // ---- LED PANELS (soft sources) ----
  skypanel_s60: {
    name: 'ARRI SkyPanel S60-C',
    manufacturer: 'ARRI',
    type: 'led_panel',
    wattage: 385,
    lumens: 20200,
    beamAngle: 55,
    fieldAngle: 115,
    zoomRange: null,
    sourceSize: 0.85,   // very large, very soft
    colorTemp: 5600,
    candelaDistribution: [
      [0, 1.0], [5, 0.99], [10, 0.97], [15, 0.94], [20, 0.90],
      [25, 0.84], [30, 0.76], [35, 0.66], [40, 0.55], [45, 0.44],
      [50, 0.33], [55, 0.23], [60, 0.15], [65, 0.09], [70, 0.05],
      [75, 0.025], [80, 0.01], [85, 0.004], [90, 0.001]
    ],
    peakCandela: 4800
  },

  litepanels_gemini_2x1: {
    name: 'Litepanels Gemini 2x1',
    manufacturer: 'Litepanels',
    type: 'led_panel',
    wattage: 325,
    lumens: 16200,
    beamAngle: 50,
    fieldAngle: 110,
    zoomRange: null,
    sourceSize: 0.80,
    colorTemp: 5600,
    candelaDistribution: [
      [0, 1.0], [5, 0.99], [10, 0.96], [15, 0.92], [20, 0.87],
      [25, 0.80], [30, 0.72], [35, 0.62], [40, 0.51], [45, 0.40],
      [50, 0.30], [55, 0.21], [60, 0.13], [65, 0.07], [70, 0.04],
      [75, 0.02], [80, 0.008], [85, 0.003], [90, 0.001]
    ],
    peakCandela: 3800
  },

  // ---- LED SPOT (COB) ----
  aputure_300d_ii: {
    name: 'Aputure 300d II',
    manufacturer: 'Aputure',
    type: 'led_cob',
    wattage: 350,
    lumens: 35500,
    beamAngle: 55,       // bare bulb
    fieldAngle: 110,
    zoomRange: null,
    sourceSize: 0.10,
    colorTemp: 5500,
    candelaDistribution: [
      [0, 1.0], [5, 0.98], [10, 0.94], [15, 0.88], [20, 0.79],
      [25, 0.68], [30, 0.55], [35, 0.42], [40, 0.30], [45, 0.20],
      [50, 0.12], [55, 0.06], [60, 0.03], [70, 0.008], [80, 0.002],
      [90, 0.0]
    ],
    peakCandela: 8500
  },

  // ---- PRACTICAL / TUNGSTEN ----
  // ---- OVERHEAD / SPACE LIGHTS ----
  spacelight_6k: {
    name: '6K Space Light',
    manufacturer: 'Mole-Richardson',
    type: 'spacelight',
    wattage: 6000,
    lumens: 120000,
    beamAngle: 80,
    fieldAngle: 160,
    zoomRange: null,
    sourceSize: 0.90,
    colorTemp: 3200,
    overhead: true,
    defaultMountHeight: 4.0,
    // Distribution from nadir: very wide, soft wrap-around
    candelaDistribution: [
      [0, 1.0], [10, 0.98], [20, 0.94], [30, 0.88], [40, 0.80],
      [50, 0.70], [60, 0.58], [70, 0.44], [75, 0.35], [80, 0.25],
      [85, 0.15], [90, 0.08]
    ],
    peakCandela: 9600
  },

  spacelight_2k: {
    name: '2K Space Light',
    manufacturer: 'Mole-Richardson',
    type: 'spacelight',
    wattage: 2000,
    lumens: 40000,
    beamAngle: 80,
    fieldAngle: 160,
    zoomRange: null,
    sourceSize: 0.85,
    colorTemp: 3200,
    overhead: true,
    defaultMountHeight: 3.0,
    candelaDistribution: [
      [0, 1.0], [10, 0.98], [20, 0.94], [30, 0.88], [40, 0.80],
      [50, 0.70], [60, 0.58], [70, 0.44], [75, 0.35], [80, 0.25],
      [85, 0.15], [90, 0.08]
    ],
    peakCandela: 3200
  },

  // ---- SOFT BOXES / CHIMERAS ----
  chimera_medium: {
    name: 'Chimera Medium (w/ 2K)',
    manufacturer: 'Chimera',
    type: 'softbox',
    wattage: 2000,
    lumens: 35000,
    beamAngle: 50,
    fieldAngle: 100,
    zoomRange: null,
    sourceSize: 0.75,
    colorTemp: 3200,
    overhead: true,
    defaultMountHeight: 2.5,
    // Soft box: moderately directed, smooth falloff
    candelaDistribution: [
      [0, 1.0], [5, 0.99], [10, 0.96], [15, 0.92], [20, 0.85],
      [25, 0.76], [30, 0.65], [35, 0.52], [40, 0.39], [45, 0.27],
      [50, 0.17], [55, 0.10], [60, 0.05], [70, 0.015], [80, 0.004],
      [90, 0.001]
    ],
    peakCandela: 5600
  },

  chimera_large: {
    name: 'Chimera Large (w/ 5K)',
    manufacturer: 'Chimera',
    type: 'softbox',
    wattage: 5000,
    lumens: 88000,
    beamAngle: 55,
    fieldAngle: 110,
    zoomRange: null,
    sourceSize: 0.85,
    colorTemp: 3200,
    overhead: true,
    defaultMountHeight: 3.0,
    candelaDistribution: [
      [0, 1.0], [5, 0.99], [10, 0.97], [15, 0.93], [20, 0.87],
      [25, 0.78], [30, 0.67], [35, 0.55], [40, 0.42], [45, 0.30],
      [50, 0.20], [55, 0.12], [60, 0.06], [70, 0.02], [80, 0.005],
      [90, 0.001]
    ],
    peakCandela: 8800
  },

  chimera_lantern: {
    name: 'Chimera Lantern',
    manufacturer: 'Chimera',
    type: 'lantern',
    wattage: 1000,
    lumens: 18000,
    beamAngle: 180,
    fieldAngle: 360,
    zoomRange: null,
    sourceSize: 0.70,
    colorTemp: 3200,
    overhead: true,
    defaultMountHeight: 2.5,
    // Nearly omnidirectional — lanterns wrap light everywhere
    candelaDistribution: [
      [0, 1.0], [15, 0.99], [30, 0.96], [45, 0.91], [60, 0.84],
      [75, 0.75], [90, 0.65]
    ],
    peakCandela: 1450
  },

  snapbag_s60: {
    name: 'DoPchoice SnapBag (S60)',
    manufacturer: 'DoPchoice',
    type: 'softbox',
    wattage: 385,
    lumens: 18000,
    beamAngle: 45,
    fieldAngle: 90,
    zoomRange: null,
    sourceSize: 0.80,
    colorTemp: 5600,
    overhead: true,
    defaultMountHeight: 2.0,
    // SnapBag narrows the SkyPanel slightly
    candelaDistribution: [
      [0, 1.0], [5, 0.99], [10, 0.96], [15, 0.91], [20, 0.83],
      [25, 0.73], [30, 0.61], [35, 0.48], [40, 0.35], [45, 0.23],
      [50, 0.14], [55, 0.07], [60, 0.03], [70, 0.008], [80, 0.002],
      [90, 0.0]
    ],
    peakCandela: 5700
  },

  // ---- PRACTICAL / TUNGSTEN ----
  practical_100w: {
    name: 'Practical 100W Bulb',
    manufacturer: 'Generic',
    type: 'practical',
    wattage: 100,
    lumens: 1600,
    beamAngle: 180,
    fieldAngle: 360,
    zoomRange: null,
    sourceSize: 0.03,
    colorTemp: 2700,
    // Nearly omnidirectional for 2D top-down
    candelaDistribution: [
      [0, 1.0], [15, 0.99], [30, 0.96], [45, 0.92], [60, 0.86],
      [75, 0.80], [90, 0.74], [105, 0.68], [120, 0.62], [135, 0.55],
      [150, 0.48], [165, 0.42], [180, 0.38]
    ],
    peakCandela: 130
  }
};

/**
 * Diffusion modifiers and their effects on beam distribution
 */
export const DIFFUSION = {
  none:   { name: 'None',                 spreadMult: 1.0, intensityLoss: 0.0,  sourceSizeAdd: 0.0 },
  light:  { name: '1/4 Frost (216)',      spreadMult: 1.3, intensityLoss: 0.08, sourceSizeAdd: 0.15 },
  medium: { name: '1/2 Frost (250)',      spreadMult: 1.6, intensityLoss: 0.15, sourceSizeAdd: 0.30 },
  heavy:  { name: 'Full Frost (129)',     spreadMult: 2.2, intensityLoss: 0.25, sourceSizeAdd: 0.55 },
  silk:   { name: 'Silk / Grid Cloth',    spreadMult: 2.8, intensityLoss: 0.35, sourceSizeAdd: 0.70 },
  opal:   { name: 'Opal (410)',           spreadMult: 3.5, intensityLoss: 0.50, sourceSizeAdd: 0.90 }
};

/**
 * Interpolate a candela distribution at an arbitrary angle.
 * Returns normalized intensity [0, 1].
 */
export function sampleDistribution(distribution, angleDeg) {
  const a = Math.abs(angleDeg);
  if (a >= distribution[distribution.length - 1][0]) return 0;
  if (a <= distribution[0][0]) return distribution[0][1];

  for (let i = 1; i < distribution.length; i++) {
    if (a <= distribution[i][0]) {
      const [a0, v0] = distribution[i - 1];
      const [a1, v1] = distribution[i];
      const t = (a - a0) / (a1 - a0);
      return v0 + t * (v1 - v0);
    }
  }
  return 0;
}

/**
 * Get the active candela distribution for a fixture at a given zoom position [0,1].
 * Interpolates between spot and flood distributions.
 */
export function getDistributionAtZoom(fixture, zoomT) {
  if (!fixture.candelaDistributionFlood || !fixture.zoomRange) {
    return fixture.candelaDistribution;
  }
  // Build interpolated distribution
  const spot = fixture.candelaDistribution;
  const flood = fixture.candelaDistributionFlood;

  // Collect all unique angles
  const angleSet = new Set();
  spot.forEach(([a]) => angleSet.add(a));
  flood.forEach(([a]) => angleSet.add(a));
  const angles = [...angleSet].sort((a, b) => a - b);

  return angles.map(a => {
    const vSpot = sampleDistribution(spot, a);
    const vFlood = sampleDistribution(flood, a);
    return [a, vSpot * (1 - zoomT) + vFlood * zoomT];
  });
}

/**
 * Get peak candela at a given zoom [0,1]
 */
export function getPeakCandelaAtZoom(fixture, zoomT) {
  const cdSpot = fixture.peakCandela;
  const cdFlood = fixture.peakCandelaFlood || fixture.peakCandela;
  return cdSpot * (1 - zoomT) + cdFlood * zoomT;
}

/**
 * Apply diffusion to a distribution.
 * Returns a new distribution array.
 */
export function applyDiffusion(distribution, diffusionKey, extraSoftness) {
  const diff = DIFFUSION[diffusionKey] || DIFFUSION.none;
  const totalSpread = diff.spreadMult + extraSoftness * 0.02;
  const intensityScale = 1.0 - diff.intensityLoss - extraSoftness * 0.002;

  return distribution.map(([angle, value]) => {
    // Compress the angle axis (making the distribution wider)
    const newAngle = angle / totalSpread;
    const newValue = sampleDistribution(distribution, newAngle) * Math.max(0, intensityScale);
    return [angle, newValue];
  });
}

/**
 * Pack a candela distribution into a Float32 texture row (256 samples from 0-180°).
 */
export function distributionToTextureData(distribution) {
  const size = 256;
  const data = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const angle = (i / (size - 1)) * 180;
    data[i] = sampleDistribution(distribution, angle);
  }
  return data;
}

/**
 * Convert color temperature (K) to RGB [0-1].
 * Attempt at Planckian locus approximation.
 */
export function cctToRGB(kelvin) {
  const temp = kelvin / 100;
  let r, g, b;

  if (temp <= 66) {
    r = 1.0;
    g = Math.max(0, Math.min(1, (99.4708025861 * Math.log(temp) - 161.1195681661) / 255));
  } else {
    r = Math.max(0, Math.min(1, (329.698727446 * Math.pow(temp - 60, -0.1332047592)) / 255));
    g = Math.max(0, Math.min(1, (288.1221695283 * Math.pow(temp - 60, -0.0755148492)) / 255));
  }

  if (temp >= 66) {
    b = 1.0;
  } else if (temp <= 19) {
    b = 0.0;
  } else {
    b = Math.max(0, Math.min(1, (138.5177312231 * Math.log(temp - 10) - 305.0447927307) / 255));
  }

  return [r, g, b];
}
