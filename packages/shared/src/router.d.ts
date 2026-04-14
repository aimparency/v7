export declare const router: import("@trpc/server").TRPCRouterBuilder<{
    ctx: object;
    meta: object;
    errorShape: import("@trpc/server").TRPCDefaultErrorShape;
    transformer: false;
}>;
export declare const publicProcedure: import("@trpc/server").TRPCProcedureBuilder<object, object, object, import("@trpc/server").TRPCUnsetMarker, import("@trpc/server").TRPCUnsetMarker, import("@trpc/server").TRPCUnsetMarker, import("@trpc/server").TRPCUnsetMarker, false>;
export declare const appRouter: import("@trpc/server").TRPCBuiltRouter<{
    ctx: object;
    meta: object;
    errorShape: import("@trpc/server").TRPCDefaultErrorShape;
    transformer: false;
}, import("@trpc/server").TRPCDecorateCreateRouterOptions<{
    aim: import("@trpc/server").TRPCBuiltRouter<{
        ctx: object;
        meta: object;
        errorShape: import("@trpc/server").TRPCDefaultErrorShape;
        transformer: false;
    }, import("@trpc/server").TRPCDecorateCreateRouterOptions<{
        create: import("@trpc/server").TRPCMutationProcedure<{
            input: {
                aim: {
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
                };
                projectPath: string;
            };
            output: never;
            meta: object;
        }>;
        get: import("@trpc/server").TRPCQueryProcedure<{
            input: {
                aimId: string;
                projectPath: string;
            };
            output: never;
            meta: object;
        }>;
        list: import("@trpc/server").TRPCQueryProcedure<{
            input: {
                projectPath: string;
            };
            output: never;
            meta: object;
        }>;
        update: import("@trpc/server").TRPCMutationProcedure<{
            input: {
                aimId: string;
                aim: {
                    status?: {
                        state: string;
                        comment: string;
                        date: number;
                    } | undefined;
                    reflection?: string | undefined;
                    text?: string | undefined;
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
                    supportedAims?: string[] | undefined;
                    committedIn?: string[] | undefined;
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
                };
                projectPath: string;
            };
            output: never;
            meta: object;
        }>;
        delete: import("@trpc/server").TRPCMutationProcedure<{
            input: {
                aimId: string;
                projectPath: string;
            };
            output: never;
            meta: object;
        }>;
        commitToPhase: import("@trpc/server").TRPCMutationProcedure<{
            input: {
                aimId: string;
                projectPath: string;
                phaseId: string;
                insertionIndex?: number | undefined;
            };
            output: never;
            meta: object;
        }>;
        removeFromPhase: import("@trpc/server").TRPCMutationProcedure<{
            input: {
                aimId: string;
                projectPath: string;
                phaseId: string;
            };
            output: never;
            meta: object;
        }>;
    }>>;
    phase: import("@trpc/server").TRPCBuiltRouter<{
        ctx: object;
        meta: object;
        errorShape: import("@trpc/server").TRPCDefaultErrorShape;
        transformer: false;
    }, import("@trpc/server").TRPCDecorateCreateRouterOptions<{
        create: import("@trpc/server").TRPCMutationProcedure<{
            input: {
                projectPath: string;
                phase: {
                    from: number;
                    to: number;
                    parent: string | null;
                    commitments: string[];
                    name: string;
                    order?: number | undefined;
                    childPhaseIds?: string[] | undefined;
                };
            };
            output: never;
            meta: object;
        }>;
        get: import("@trpc/server").TRPCQueryProcedure<{
            input: {
                projectPath: string;
                phaseId: string;
            };
            output: never;
            meta: object;
        }>;
        list: import("@trpc/server").TRPCQueryProcedure<{
            input: {
                projectPath: string;
                parentPhaseId?: string | null | undefined;
            };
            output: never;
            meta: object;
        }>;
        update: import("@trpc/server").TRPCMutationProcedure<{
            input: {
                projectPath: string;
                phaseId: string;
                phase: {
                    from?: number | undefined;
                    to?: number | undefined;
                    order?: number | undefined;
                    parent?: string | null | undefined;
                    childPhaseIds?: string[] | undefined;
                    commitments?: string[] | undefined;
                    name?: string | undefined;
                };
            };
            output: never;
            meta: object;
        }>;
        reorder: import("@trpc/server").TRPCMutationProcedure<{
            input: {
                projectPath: string;
                phaseId: string;
                newIndex: number;
            };
            output: never;
            meta: object;
        }>;
        delete: import("@trpc/server").TRPCMutationProcedure<{
            input: {
                projectPath: string;
                phaseId: string;
            };
            output: never;
            meta: object;
        }>;
    }>>;
    project: import("@trpc/server").TRPCBuiltRouter<{
        ctx: object;
        meta: object;
        errorShape: import("@trpc/server").TRPCDefaultErrorShape;
        transformer: false;
    }, import("@trpc/server").TRPCDecorateCreateRouterOptions<{
        getMeta: import("@trpc/server").TRPCQueryProcedure<{
            input: {
                projectPath: string;
            };
            output: never;
            meta: object;
        }>;
        updateMeta: import("@trpc/server").TRPCMutationProcedure<{
            input: {
                meta: {
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
                };
                projectPath: string;
            };
            output: never;
            meta: object;
        }>;
        migrateCommittedIn: import("@trpc/server").TRPCMutationProcedure<{
            input: {
                projectPath: string;
            };
            output: never;
            meta: object;
        }>;
    }>>;
}>>;
export type AppRouter = typeof appRouter;
//# sourceMappingURL=router.d.ts.map