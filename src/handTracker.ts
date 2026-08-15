/**
 * handTracker.ts
 * ==============
 * Wrapper untuk MediaPipe HandLandmarker (task-vision).
 *
 * Output: MultiHandResult berisi array of HandData (up to numHands).
 * Tiap HandData mengekspos:
 *   - landmarks[21]: normalized 0..1 (image-space: x=left→right, y=top→bottom)
 *   - thumbTip, indexTip, middleTip, middleDip: Pt2 (shortcut ke landmark tertentu)
 *   - palmCenter, handSize: untuk 3D anchor (torus)
 *
 * Aspect correction (× H/W untuk Y) TIDAK diterapkan di sini — caller
 * (compositor.ts) memilih kapan pakai sesuai mode:
 *   - mode "frame" (comp5) → apply aspectCorrectY = true
 *   - mode "2d"/"3d"/"hybrid" → apply aspectCorrectY = false
 */

import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

// 21 landmark names (sama dengan MediaPipe hand tracking standard).
export const HAND_LANDMARK_NAMES = [
  "wrist",
  "thumb_cmc", "thumb_mcp", "thumb_ip", "thumb_tip",
  "index_finger_mcp", "index_finger_pip", "index_finger_dip", "index_finger_tip",
  "middle_finger_mcp", "middle_finger_pip", "middle_finger_dip", "middle_finger_tip",
  "ring_finger_mcp", "ring_finger_pip", "ring_finger_dip", "ring_finger_tip",
  "pinky_mcp", "pinky_pip", "pinky_dip", "pinky_tip",
];

// Konstanta index untuk akses cepat.
export const LANDMARK_INDEX = {
  WRIST: 0,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_FINGER_MCP: 5,
  INDEX_FINGER_PIP: 6,
  INDEX_FINGER_TIP: 8,
  MIDDLE_FINGER_MCP: 9,
  MIDDLE_FINGER_PIP: 10,
  MIDDLE_FINGER_DIP: 11,
  MIDDLE_FINGER_TIP: 12,
  RING_FINGER_PIP: 14,
  RING_FINGER_TIP: 16,
  PINKY_PIP: 18,
  PINKY_TIP: 20,
} as const;

export interface Pt2 {
  x: number;
  y: number;
}

export interface HandData {
  detected: boolean;
  landmarks: Pt2[]; // 21 titik
  thumbTip: Pt2;
  indexTip: Pt2;
  middleTip: Pt2;
  middleDip: Pt2;
  palmCenter: Pt2;
  handSize: number;
  handedness: "Left" | "Right" | "";
}

export interface MultiHandResult {
  hands: HandData[]; // length ≤ numHands (biasanya 2)
  numDetected: number;
  videoSize: { width: number; height: number };
}

export interface HandTrackerOptions {
  modelAssetPath?: string;
  wasmBaseUrl?: string;
  numHands?: number;
  minHandDetectionConfidence?: number;
  minHandPresenceConfidence?: number;
  minTrackingConfidence?: number;
}

const FALLBACK_HAND: HandData = {
  detected: false,
  landmarks: [],
  thumbTip: { x: 0, y: 0 },
  indexTip: { x: 0, y: 0 },
  middleTip: { x: 0, y: 0 },
  middleDip: { x: 0, y: 0 },
  palmCenter: { x: 0, y: 0 },
  handSize: 0,
  handedness: "",
};

function emptyHands(numHands = 2): HandData[] {
  return Array.from({ length: numHands }, () => ({ ...FALLBACK_HAND }));
}

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private configuredNumHands = 2;
  private lastVideoTimeMs = -1;
  private lastResult: MultiHandResult = { hands: emptyHands(2), numDetected: 0, videoSize: { width: 1280, height: 720 } };

  static async create(opts: HandTrackerOptions = {}): Promise<HandTracker> {
    const wasmBaseUrl = opts.wasmBaseUrl ?? "/wasm";
    const modelAssetPath = opts.modelAssetPath ?? "/models/hand_landmarker.task";

    const fileset = await FilesetResolver.forVisionTasks(wasmBaseUrl);

    const landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath,
        delegate: "GPU",
      },
      numHands: opts.numHands ?? 2,
      minHandDetectionConfidence: opts.minHandDetectionConfidence ?? 0.5,
      minHandPresenceConfidence: opts.minHandPresenceConfidence ?? 0.5,
      minTrackingConfidence: opts.minTrackingConfidence ?? 0.5,
      runningMode: "VIDEO",
    });

    const t = new HandTracker();
    t.landmarker = landmarker;
    t.configuredNumHands = opts.numHands ?? 2;
    return t;
  }

  detect(video: HTMLVideoElement, timestampMs: number): MultiHandResult {
    if (!this.landmarker) return this.lastResult;
    if (video.readyState < 2) return this.lastResult;
    if (timestampMs === this.lastVideoTimeMs) return this.lastResult;

    this.lastVideoTimeMs = timestampMs;

    let raw: HandLandmarkerResult;
    try {
      raw = this.landmarker.detectForVideo(video, timestampMs);
    } catch (err) {
      console.warn("[handTracker] detectForVideo error:", err);
      return this.lastResult;
    }

    const W = video.videoWidth || 1280;
    const H = video.videoHeight || 720;

    const handsData: HandData[] = [];
    const n = raw.landmarks?.length ?? 0;
    for (let i = 0; i < n; i++) {
      const lm: NormalizedLandmark[] = raw.landmarks[i];
      const handednessLabel =
        raw.handednesses?.[i]?.[0]?.categoryName === "Left"
          ? "Left"
          : raw.handednesses?.[i]?.[0]?.categoryName === "Right"
            ? "Right"
            : "";
      handsData.push(buildHandData(lm, handednessLabel));
    }

    // Pad with empty hands up to configuredNumHands (index consistency)
    while (handsData.length < this.configuredNumHands) {
      handsData.push({ ...FALLBACK_HAND });
    }

    this.lastResult = {
      hands: handsData,
      numDetected: n,
      videoSize: { width: W, height: H },
    };
    return this.lastResult;
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}

function buildHandData(lm: NormalizedLandmark[], handedness: "Left" | "Right" | ""): HandData {
  const pick = (idx: number): Pt2 => ({ x: lm[idx].x, y: lm[idx].y });
  const landmarks = lm.map((p) => ({ x: p.x, y: p.y })) as Pt2[];

  const thumbTip = pick(LANDMARK_INDEX.THUMB_TIP);
  const indexTip = pick(LANDMARK_INDEX.INDEX_FINGER_TIP);
  const middleTip = pick(LANDMARK_INDEX.MIDDLE_FINGER_TIP);
  const middleDip = pick(LANDMARK_INDEX.MIDDLE_FINGER_DIP);

  // Palm center: avg wrist + middle_finger_mcp (sesuai TD MP project juga)
  const wrist = pick(LANDMARK_INDEX.WRIST);
  const middleMcp = pick(LANDMARK_INDEX.MIDDLE_FINGER_MCP);
  const palmCenter: Pt2 = {
    x: (wrist.x + middleMcp.x) / 2,
    y: (wrist.y + middleMcp.y) / 2,
  };
  const dx = wrist.x - middleMcp.x;
  const dy = wrist.y - middleMcp.y;
  const handSize = Math.hypot(dx, dy);

  return {
    detected: true,
    landmarks,
    thumbTip,
    indexTip,
    middleTip,
    middleDip,
    palmCenter,
    handSize,
    handedness,
  };
}
