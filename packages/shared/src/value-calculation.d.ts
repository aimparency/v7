import type { Aim } from './types.js';
export declare function calculateAimValues(aims: Aim[]): {
    values: Map<string, number>;
    totalIntrinsic: number;
    flowShares: Map<string, number>;
    flowValues: Map<string, number>;
    costs: Map<string, number>;
    doneCosts: Map<string, number>;
    priorities: Map<string, number>;
};
//# sourceMappingURL=value-calculation.d.ts.map