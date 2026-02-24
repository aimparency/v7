import { initTRPC } from '@trpc/server';

const trpcFactory = initTRPC.context<{}>().create();

export type RouterBuilder = Pick<typeof trpcFactory, 'router' | 'procedure'>;
export type BaseProcedure = typeof trpcFactory.procedure;
