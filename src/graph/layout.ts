import type { NodeId } from "../state/schema";

export const POSITIONS: Record<NodeId, { x: number; y: number }> = {
  Start: { x: 400, y: 0 },
  Rent: { x: 400, y: 130 },
  Food: { x: 400, y: 260 },
  Essential: { x: 400, y: 390 },
  Income: { x: 400, y: 520 },
  Health: { x: 400, y: 650 },
  MinDebt: { x: 400, y: 780 },

  SmallEF: { x: 400, y: 910 },
  NonEssential: { x: 400, y: 1040 },

  Q_Match: { x: 400, y: 1200 },
  Match: { x: 720, y: 1200 },

  Q_HighDebt: { x: 400, y: 1410 },
  HighDebt: { x: 720, y: 1410 },

  BigEF: { x: 400, y: 1620 },

  Q_ModDebt: { x: 400, y: 1790 },
  ModDebt: { x: 720, y: 1790 },

  IRA: { x: 400, y: 2000 },

  Q_Purchase: { x: 400, y: 2160 },
  SavePurchase: { x: 720, y: 2160 },

  Q_15pct: { x: 400, y: 2370 },

  Q_401k: { x: 80, y: 2370 },
  Increase401k: { x: 80, y: 2530 },
  SelfEmp: { x: -240, y: 2530 },

  Q_HSA: { x: 400, y: 2580 },
  HSA: { x: 720, y: 2580 },

  Q_College: { x: 400, y: 2790 },
  College: { x: 720, y: 2790 },

  Options: { x: 400, y: 3000 },

  Q_Early: { x: 240, y: 3170 },
  Early: { x: 240, y: 3360 },

  Q_Goals: { x: 560, y: 3170 },
  Goals: { x: 560, y: 3360 },
};
