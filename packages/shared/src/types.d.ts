import { z } from 'zod';
export declare const AimStatusSchema: z.ZodObject<{
    state: z.ZodString;
    comment: z.ZodString;
    date: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    state: string;
    comment: string;
    date: number;
}, {
    state: string;
    comment: string;
    date: number;
}>;
export type AimStatusState = string;
export declare const ConnectionSchema: z.ZodObject<{
    aimId: z.ZodString;
    relativePosition: z.ZodDefault<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
    weight: z.ZodDefault<z.ZodNumber>;
    explanation: z.ZodOptional<z.ZodString>;
    reflection: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    aimId: string;
    relativePosition: [number, number];
    weight: number;
    explanation?: string | undefined;
    reflection?: string | undefined;
}, {
    aimId: string;
    relativePosition?: [number, number] | undefined;
    weight?: number | undefined;
    explanation?: string | undefined;
    reflection?: string | undefined;
}>;
export type Connection = z.infer<typeof ConnectionSchema>;
export declare const ReflectionSchema: z.ZodObject<{
    date: z.ZodNumber;
    context: z.ZodString;
    outcome: z.ZodString;
    effectiveness: z.ZodString;
    lesson: z.ZodString;
    pattern: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    date: number;
    context: string;
    outcome: string;
    effectiveness: string;
    lesson: string;
    pattern?: string | undefined;
}, {
    date: number;
    context: string;
    outcome: string;
    effectiveness: string;
    lesson: string;
    pattern?: string | undefined;
}>;
export type Reflection = z.infer<typeof ReflectionSchema>;
export declare const AimSchema: z.ZodObject<{
    id: z.ZodString;
    text: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    reflection: z.ZodOptional<z.ZodString>;
    reflections: z.ZodDefault<z.ZodArray<z.ZodObject<{
        date: z.ZodNumber;
        context: z.ZodString;
        outcome: z.ZodString;
        effectiveness: z.ZodString;
        lesson: z.ZodString;
        pattern: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        date: number;
        context: string;
        outcome: string;
        effectiveness: string;
        lesson: string;
        pattern?: string | undefined;
    }, {
        date: number;
        context: string;
        outcome: string;
        effectiveness: string;
        lesson: string;
        pattern?: string | undefined;
    }>, "many">>;
    archived: z.ZodDefault<z.ZodBoolean>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    supportingConnections: z.ZodDefault<z.ZodArray<z.ZodObject<{
        aimId: z.ZodString;
        relativePosition: z.ZodDefault<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
        weight: z.ZodDefault<z.ZodNumber>;
        explanation: z.ZodOptional<z.ZodString>;
        reflection: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        aimId: string;
        relativePosition: [number, number];
        weight: number;
        explanation?: string | undefined;
        reflection?: string | undefined;
    }, {
        aimId: string;
        relativePosition?: [number, number] | undefined;
        weight?: number | undefined;
        explanation?: string | undefined;
        reflection?: string | undefined;
    }>, "many">>;
    incoming: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    supportedAims: z.ZodArray<z.ZodString, "many">;
    committedIn: z.ZodArray<z.ZodString, "many">;
    status: z.ZodObject<{
        state: z.ZodString;
        comment: z.ZodString;
        date: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        state: string;
        comment: string;
        date: number;
    }, {
        state: string;
        comment: string;
        date: number;
    }>;
    intrinsicValue: z.ZodDefault<z.ZodNumber>;
    cost: z.ZodDefault<z.ZodNumber>;
    loopWeight: z.ZodDefault<z.ZodNumber>;
    duration: z.ZodDefault<z.ZodNumber>;
    costVariance: z.ZodDefault<z.ZodNumber>;
    valueVariance: z.ZodDefault<z.ZodNumber>;
    calculatedValue: z.ZodOptional<z.ZodNumber>;
    calculatedCost: z.ZodOptional<z.ZodNumber>;
    calculatedDoneCost: z.ZodOptional<z.ZodNumber>;
    calculatedPriority: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    id: string;
    status: {
        state: string;
        comment: string;
        date: number;
    };
    text: string;
    reflections: {
        date: number;
        context: string;
        outcome: string;
        effectiveness: string;
        lesson: string;
        pattern?: string | undefined;
    }[];
    archived: boolean;
    tags: string[];
    supportingConnections: {
        aimId: string;
        relativePosition: [number, number];
        weight: number;
        explanation?: string | undefined;
        reflection?: string | undefined;
    }[];
    supportedAims: string[];
    committedIn: string[];
    intrinsicValue: number;
    cost: number;
    loopWeight: number;
    duration: number;
    costVariance: number;
    valueVariance: number;
    reflection?: string | undefined;
    description?: string | undefined;
    incoming?: string[] | undefined;
    calculatedValue?: number | undefined;
    calculatedCost?: number | undefined;
    calculatedDoneCost?: number | undefined;
    calculatedPriority?: number | undefined;
}, {
    id: string;
    status: {
        state: string;
        comment: string;
        date: number;
    };
    text: string;
    supportedAims: string[];
    committedIn: string[];
    reflection?: string | undefined;
    description?: string | undefined;
    reflections?: {
        date: number;
        context: string;
        outcome: string;
        effectiveness: string;
        lesson: string;
        pattern?: string | undefined;
    }[] | undefined;
    archived?: boolean | undefined;
    tags?: string[] | undefined;
    supportingConnections?: {
        aimId: string;
        relativePosition?: [number, number] | undefined;
        weight?: number | undefined;
        explanation?: string | undefined;
        reflection?: string | undefined;
    }[] | undefined;
    incoming?: string[] | undefined;
    intrinsicValue?: number | undefined;
    cost?: number | undefined;
    loopWeight?: number | undefined;
    duration?: number | undefined;
    costVariance?: number | undefined;
    valueVariance?: number | undefined;
    calculatedValue?: number | undefined;
    calculatedCost?: number | undefined;
    calculatedDoneCost?: number | undefined;
    calculatedPriority?: number | undefined;
}>;
export declare const PhaseSchema: z.ZodObject<{
    id: z.ZodString;
    from: z.ZodNumber;
    to: z.ZodNumber;
    order: z.ZodOptional<z.ZodNumber>;
    parent: z.ZodNullable<z.ZodString>;
    childPhaseIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    commitments: z.ZodArray<z.ZodString, "many">;
    name: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    from: number;
    to: number;
    parent: string | null;
    commitments: string[];
    name: string;
    order?: number | undefined;
    childPhaseIds?: string[] | undefined;
}, {
    id: string;
    from: number;
    to: number;
    parent: string | null;
    commitments: string[];
    name: string;
    order?: number | undefined;
    childPhaseIds?: string[] | undefined;
}>;
export declare const AimStateSchema: z.ZodObject<{
    key: z.ZodString;
    color: z.ZodString;
    ongoing: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    key: string;
    color: string;
    ongoing: boolean;
}, {
    key: string;
    color: string;
    ongoing: boolean;
}>;
export declare const ProjectMetaSchema: z.ZodObject<{
    name: z.ZodString;
    color: z.ZodString;
    statuses: z.ZodOptional<z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        color: z.ZodString;
        ongoing: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        key: string;
        color: string;
        ongoing: boolean;
    }, {
        key: string;
        color: string;
        ongoing: boolean;
    }>, "many">>;
    dataModelVersion: z.ZodOptional<z.ZodNumber>;
    phaseCursors: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    phaseActiveLevel: z.ZodOptional<z.ZodNumber>;
    rootPhaseIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    name: string;
    color: string;
    statuses?: {
        key: string;
        color: string;
        ongoing: boolean;
    }[] | undefined;
    dataModelVersion?: number | undefined;
    phaseCursors?: Record<string, number> | undefined;
    phaseActiveLevel?: number | undefined;
    rootPhaseIds?: string[] | undefined;
}, {
    name: string;
    color: string;
    statuses?: {
        key: string;
        color: string;
        ongoing: boolean;
    }[] | undefined;
    dataModelVersion?: number | undefined;
    phaseCursors?: Record<string, number> | undefined;
    phaseActiveLevel?: number | undefined;
    rootPhaseIds?: string[] | undefined;
}>;
export declare const SystemStatusSchema: z.ZodObject<{
    computeCredits: z.ZodNumber;
    funds: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    computeCredits: number;
    funds: number;
}, {
    computeCredits: number;
    funds: number;
}>;
export interface Hint {
    key: string;
    action: string;
}
export type Aim = z.infer<typeof AimSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type AimStatus = z.infer<typeof AimStatusSchema>;
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;
export type SystemStatus = z.infer<typeof SystemStatusSchema>;
export type SearchAimResult = Aim & {
    score?: number;
};
//# sourceMappingURL=types.d.ts.map