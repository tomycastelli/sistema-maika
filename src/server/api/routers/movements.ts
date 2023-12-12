import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { dateReviver, getAllChildrenTags } from "~/lib/functions";
import {
  getAllEntities,
  getAllPermissions,
  getAllTags,
} from "~/lib/trpcFunctions";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

export const movementsRouter = createTRPCRouter({
  getCurrentAccounts: publicProcedure
    .input(
      z.object({
        linkId: z.number().int().optional().nullable(),
        linkToken: z.string().optional().nullable(),
        sharedEntityId: z.number().optional().nullable(),
        pageSize: z.number().int(),
        pageNumber: z.number().int(),
        entityId: z.number().int().optional(), // Change from array to single number
        entityTag: z.string().optional(),
        account: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const whereConditions = [];

      let isRequestValid = false;

      if (ctx.session?.user !== undefined) {
        isRequestValid = true;
      } else if (input.linkId && input.linkToken && input.sharedEntityId) {
        const link = await ctx.db.links.findUnique({
          where: {
            id: input.linkId,
            sharedEntityId: input.sharedEntityId,
            password: input.linkToken,
          },
        });

        if (link) {
          isRequestValid = true;
        }
      }

      if (!isRequestValid) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "El usuario no está registrado o el link no es válido",
        });
      }

      if (input.entityId !== undefined) {
        whereConditions.push({
          transaction: {
            OR: [
              {
                fromEntityId: input.entityId,
                toEntityId: {
                  not: input.entityId,
                },
              },
              {
                fromEntityId: {
                  not: input.entityId,
                },
                toEntityId: input.entityId,
              },
            ],
          },
        });
      }

      if (input.account !== null) {
        whereConditions.push({ account: input.account });
      }

      if (input.entityTag) {
        const tags = await getAllTags(ctx.redis, ctx.db);
        const tagAndChildren = getAllChildrenTags(input.entityTag, tags);

        whereConditions.push({
          transaction: {
            OR: [
              {
                AND: [
                  { fromEntity: { tagName: { in: tagAndChildren } } },
                  { toEntity: { tagName: { notIn: tagAndChildren } } },
                ],
              },
              {
                AND: [
                  { fromEntity: { tagName: { notIn: tagAndChildren } } },
                  { toEntity: { tagName: { in: tagAndChildren } } },
                ],
              },
            ],
          },
        });
      }

      const totalRows = await ctx.db.movements.count({
        where: {
          AND: whereConditions,
        },
      });

      const movements = await ctx.db.movements.findMany({
        where: {
          AND: whereConditions,
        },
        include: {
          transaction: {
            include: {
              operation: {
                select: {
                  id: true,
                  observations: true,
                  date: true,
                },
              },
              transactionMetadata: true,
              fromEntity: true,
              toEntity: true,
            },
          },
        },
        orderBy: {
          id: "desc",
        },
        take: input.pageSize,
        skip: (input.pageNumber - 1) * input.pageSize,
      });

      return { movements: movements, totalRows: totalRows };
    }),

  getBalancesByEntities: publicProcedure
    .input(
      z.object({
        entityId: z.number().int().optional().nullable(),
        entityTag: z.string().optional().nullable(),
        linkId: z.number().optional().nullable(),
        linkToken: z.string().optional().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      let isRequestValid = false;

      if (ctx.session?.user !== undefined) {
        const userPermissions = await getAllPermissions(
          ctx.redis,
          ctx.session,
          ctx.db,
          { userId: undefined },
        );
        const tags = await getAllTags(ctx.redis, ctx.db);

        const entities = await getAllEntities(ctx.redis, ctx.db);
        const entityTag = entities.find((e) => e.id === input.entityId)?.tag
          .name;

        if (
          userPermissions?.find(
            (p) =>
              p.name === "ADMIN" ||
              p.name === "ACCOUNTS_VISUALIZE" ||
              (p.name === "ACCOUNTS_VISUALIZE_SOME" &&
                (input.entityId
                  ? p.entitiesIds?.includes(input.entityId) ||
                    (entityTag &&
                      getAllChildrenTags(p.entitiesTags, tags).includes(
                        entityTag,
                      ))
                  : input.entityTag
                  ? getAllChildrenTags(p.entitiesTags, tags).includes(
                      input.entityTag,
                    )
                  : false)),
          )
        ) {
          isRequestValid = true;
        }
      } else if (input.linkId && input.linkToken && input.entityId) {
        const link = await ctx.db.links.findUnique({
          where: {
            id: input.linkId,
            sharedEntityId: input.entityId,
            password: input.linkToken,
          },
        });

        if (link) {
          isRequestValid = true;
        }
      }

      if (!isRequestValid) {
        if (ctx.session?.user) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message:
              "El usuario no tiene los permisos suficientes para ver esta cuenta",
          });
        } else {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "El usuario no está registrado o el link no es válido",
          });
        }
      }

      const EntitiesBalanceSchema = z.array(
        z.object({
          entityid: z.number(),
          entityname: z.string(),
          entitytag: z.string(),
          date: z.date(),
          currency: z.string(),
          movementstatus: z.boolean(),
          balance: z.number(),
        }),
      );

      const entitiesBalances = await ctx.db.$queryRaw<
        z.infer<typeof EntitiesBalanceSchema>
      >`
      SELECT
  e.id as entityId,
  e.name as entityName,
  e."tagName" as entityTag,
  DATE_TRUNC('day', COALESCE(t.date, o.date)) as date,
  t.currency,
  m.account as movementStatus,
  SUM(CASE
    WHEN t."fromEntityId" = e.id AND m."direction" = -1 THEN t."amount"
    WHEN t."toEntityId" = e.id AND m."direction" = 1 THEN t."amount"
    ELSE 0
  END) -
  SUM(CASE
    WHEN t."fromEntityId" = e.id AND m."direction" = 1 THEN t."amount"
    WHEN t."toEntityId" = e.id AND m."direction" = -1 THEN t."amount"
    ELSE 0
  END) as balance
FROM
  "Entities" e
  LEFT JOIN "Transactions" t ON e.id = t."fromEntityId" OR e.id = t."toEntityId"
  LEFT JOIN "Movements" m ON t.id = m."transactionId"
  LEFT JOIN "Operations" o ON t."operationId" = o.id
WHERE
 ${input.entityId ? Prisma.sql`e.id = ${input.entityId}` : Prisma.sql`1=1`}
 ${
   input.entityTag
     ? Prisma.sql`AND e."tagName" = ANY(${Prisma.raw(
         `ARRAY[${getAllChildrenTags(
           input.entityTag,
           await getAllTags(ctx.redis, ctx.db),
         )
           .map((tag) => `'${tag}'`)
           .join(",")}]`,
       )})`
     : Prisma.sql``
 }
GROUP BY
  e.id,
  e.name,
  e."tagName",
  DATE_TRUNC('day', COALESCE(t.date, o.date)),  -- Specify the table for the date column
  t.currency,
  m.account
ORDER BY
  DATE_TRUNC('day', COALESCE(t.date, o.date)), e.id, t.currency, m.account;
    `;

      const transformedArray = entitiesBalances
        .filter((entity) => entity.currency)
        .reduce(
          (acc, entity) => {
            const existingEntity = acc.find(
              (e) => e.entityId === entity.entityid,
            );

            if (existingEntity) {
              // Entity already exists, add balance to the respective array
              existingEntity.balances.push({
                currency: entity.currency,
                date: entity.date,
                status: entity.movementstatus,
                amount: entity.balance,
              });
            } else {
              // Entity doesn't exist, create a new entry
              const newEntity = {
                entityId: entity.entityid,
                entityName: entity.entityname,
                entityTag: entity.entitytag,
                balances: [
                  {
                    currency: entity.currency,
                    date: entity.date,
                    status: entity.movementstatus,
                    amount: entity.balance,
                  },
                ],
              };

              acc.push(newEntity);
            }

            return acc;
          },
          [] as {
            entityId: number;
            entityName: string;
            entityTag: string;
            balances: Array<{
              currency: string;
              date: Date;
              status: boolean;
              amount: number;
            }>;
          }[],
        );

      return transformedArray;
    }),
  getBalancesByEntitiesForCard: publicProcedure
    .input(
      z.object({
        entityId: z.number().int().optional().nullable(),
        entityTag: z.string().optional().nullable(),
        linkId: z.number().optional().nullable(),
        linkToken: z.string().optional().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      let isRequestValid = false;

      if (ctx.session?.user !== undefined) {
        isRequestValid = true;
      } else if (input.linkId && input.linkToken && input.entityId) {
        const link = await ctx.db.links.findUnique({
          where: {
            id: input.linkId,
            sharedEntityId: input.entityId,
            password: input.linkToken,
          },
        });

        if (link) {
          isRequestValid = true;
        }
      }

      if (!isRequestValid) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "El usuario no está registrado o el link no es válido",
        });
      }

      let cachedBalancesString: string | null = "";
      if (input.entityId) {
        cachedBalancesString = await ctx.redis.get(`balance:${input.entityId}`);
      }
      if (input.entityTag) {
        cachedBalancesString = await ctx.redis.get(
          `balance:${input.entityTag}`,
        );
      }
      if (cachedBalancesString) {
        const cachedBalances: typeof transformedArray = JSON.parse(
          cachedBalancesString,
          dateReviver(["date"]),
        );
        return cachedBalances;
      }

      const EntitiesBalanceSchema = z.array(
        z.object({
          entityid: z.number(),
          entityname: z.string(),
          entitytag: z.string(),
          date: z.date(),
          currency: z.string(),
          movementstatus: z.boolean(),
          balance: z.number(),
        }),
      );

      const entitiesBalances = await ctx.db.$queryRaw<
        z.infer<typeof EntitiesBalanceSchema>
      >`
      SELECT
  e.id as entityId,
  e.name as entityName,
  e."tagName" as entityTag,
  DATE_TRUNC('day', COALESCE(t.date, o.date)) as date,
  t.currency,
  m.account as movementStatus,
  SUM(CASE
    WHEN t."fromEntityId" = e.id AND m."direction" = -1 THEN t."amount"
    WHEN t."toEntityId" = e.id AND m."direction" = 1 THEN t."amount"
    ELSE 0
  END) -
  SUM(CASE
    WHEN t."fromEntityId" = e.id AND m."direction" = 1 THEN t."amount"
    WHEN t."toEntityId" = e.id AND m."direction" = -1 THEN t."amount"
    ELSE 0
  END) as balance
FROM
  "Entities" e
  LEFT JOIN "Transactions" t ON e.id = t."fromEntityId" OR e.id = t."toEntityId"
  LEFT JOIN "Movements" m ON t.id = m."transactionId"
  LEFT JOIN "Operations" o ON t."operationId" = o.id
WHERE
 ${input.entityId ? Prisma.sql`e.id = ${input.entityId}` : Prisma.sql`1=1`}
 ${
   input.entityTag
     ? Prisma.sql`AND e."tagName" = ANY(${Prisma.raw(
         `ARRAY[${getAllChildrenTags(
           input.entityTag,
           await getAllTags(ctx.redis, ctx.db),
         )
           .map((tag) => `'${tag}'`)
           .join(",")}]`,
       )})`
     : Prisma.sql``
 }
GROUP BY
  e.id,
  e.name,
  e."tagName",
  DATE_TRUNC('day', COALESCE(t.date, o.date)),  -- Specify the table for the date column
  t.currency,
  m.account
ORDER BY
  DATE_TRUNC('day', COALESCE(t.date, o.date)), e.id, t.currency, m.account;
    `;

      const transformedArray = entitiesBalances
        .filter((entity) => entity.currency)
        .reduce(
          (acc, entity) => {
            const existingEntity = acc.find(
              (e) => e.entityId === entity.entityid,
            );

            if (existingEntity) {
              // Entity already exists, add balance to the respective array
              existingEntity.balances.push({
                currency: entity.currency,
                date: entity.date,
                status: entity.movementstatus,
                amount: entity.balance,
              });
            } else {
              // Entity doesn't exist, create a new entry
              const newEntity = {
                entityId: entity.entityid,
                entityName: entity.entityname,
                entityTag: entity.entitytag,
                balances: [
                  {
                    currency: entity.currency,
                    date: entity.date,
                    status: entity.movementstatus,
                    amount: entity.balance,
                  },
                ],
              };

              acc.push(newEntity);
            }

            return acc;
          },
          [] as {
            entityId: number;
            entityName: string;
            entityTag: string;
            balances: Array<{
              currency: string;
              date: Date;
              status: boolean;
              amount: number;
            }>;
          }[],
        );

      if (input.entityId) {
        await ctx.redis.set(
          `balance:${input.entityId}`,
          JSON.stringify(transformedArray),
          "EX",
          180,
        );
      }
      if (input.entityTag) {
        await ctx.redis.set(
          `balance:${input.entityTag}`,
          JSON.stringify(transformedArray),
          "EX",
          180,
        );
      }

      return transformedArray;
    }),
  getMovementsByCurrency: protectedProcedure
    .input(
      z.object({
        currency: z.string(),
        entityId: z.number().int().optional(),
        entityTag: z.string().optional(),
        limit: z.number().int(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const whereConditions = [];

      if (input.entityId !== undefined) {
        whereConditions.push({
          transaction: {
            currency: input.currency,
            OR: [
              {
                fromEntityId: input.entityId,
                toEntityId: {
                  not: input.entityId,
                },
              },
              {
                fromEntityId: {
                  not: input.entityId,
                },
                toEntityId: input.entityId,
              },
            ],
          },
        });
      } else if (input.entityTag) {
        const tags = await getAllTags(ctx.redis, ctx.db);
        const tagAndChildren = getAllChildrenTags(input.entityTag, tags);

        whereConditions.push({
          transaction: {
            currency: input.currency,
            OR: [
              {
                AND: [
                  { fromEntity: { tagName: { in: tagAndChildren } } },
                  { toEntity: { tagName: { notIn: tagAndChildren } } },
                ],
              },
              {
                AND: [
                  { fromEntity: { tagName: { notIn: tagAndChildren } } },
                  { toEntity: { tagName: { in: tagAndChildren } } },
                ],
              },
            ],
          },
        });
      }

      const movements = await ctx.db.movements.findMany({
        where: {
          AND: whereConditions,
        },
        include: {
          transaction: {
            include: {
              operation: {
                select: {
                  id: true,
                  observations: true,
                  date: true,
                },
              },
              fromEntity: true,
              toEntity: true,
            },
          },
        },
        orderBy: {
          id: "desc",
        },
        take: input.limit,
      });

      return movements;
    }),
  getDetailedBalance: publicProcedure
    .input(
      z.object({
        entityId: z.number().int().optional().nullable(),
        accountType: z.boolean(),
        entityTag: z.string().optional().nullable(),
        linkId: z.number().optional().nullable(),
        linkToken: z.string().optional().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      let isRequestValid = false;

      if (ctx.session?.user !== undefined) {
        isRequestValid = true;
      } else if (input.linkId && input.linkToken && input.entityId) {
        const link = await ctx.db.links.findUnique({
          where: {
            id: input.linkId,
            sharedEntityId: input.entityId,
            password: input.linkToken,
          },
        });

        if (link) {
          isRequestValid = true;
        }
      }

      if (!isRequestValid) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "El usuario no está registrado o el link no es válido",
        });
      }

      const balanceSchema = z.array(
        z.object({
          currency: z.string(),
          entityid: z.number().int(),
          entitytag: z.string(),
          entityname: z.string(),
          status: z.boolean(),
          balance: z.number(),
        }),
      );

      if (input.entityId) {
        const balances: z.infer<typeof balanceSchema> = await ctx.db.$queryRaw`
          SELECT
            t.currency,
            e.id as entityId,
            e."tagName" as entityTag,
            e.name as entityName,
            m.account,
            SUM(CASE
              WHEN t."fromEntityId" = e.id AND m."direction" = 1 THEN t."amount"
              WHEN t."toEntityId" = e.id AND m."direction" = -1 THEN t."amount"
              ELSE 0
            END) -
            SUM(CASE
              WHEN t."fromEntityId" = e.id AND m."direction" = -1 THEN t."amount"
              WHEN t."toEntityId" = e.id AND m."direction" = 1 THEN t."amount"
              ELSE 0
            END) as balance
          FROM
            "Transactions" t
          JOIN
            "Entities" e ON t."fromEntityId" = e.id OR t."toEntityId" = e.id
          LEFT JOIN
            "Movements" m ON t.id = m."transactionId"
            WHERE
          ${Prisma.sql`(t."fromEntityId" = ${input.entityId} OR t."toEntityId" = ${input.entityId}) AND e.id != ${input.entityId} AND m.account = ${input.accountType}`}
          GROUP BY
            t.currency, e.id, e.name, m.account
        `;
        return balances;
      } else if (input.entityTag) {
        const allTags = getAllChildrenTags(
          input.entityTag,
          await getAllTags(ctx.redis, ctx.db),
        );

        const balances: z.infer<typeof balanceSchema> = await ctx.db.$queryRaw`
          SELECT
            t.currency,
            e.id as entityId,
            e."tagName" as entityTag,
            e.name as entityName,
            m.account,
            SUM(CASE
              WHEN t."fromEntityId" = e.id AND m."direction" = 1 THEN t."amount"
              WHEN t."toEntityId" = e.id AND m."direction" = -1 THEN t."amount"
              ELSE 0
            END) -
            SUM(CASE
              WHEN t."fromEntityId" = e.id AND m."direction" = -1 THEN t."amount"
              WHEN t."toEntityId" = e.id AND m."direction" = 1 THEN t."amount"
              ELSE 0
            END) as balance
          FROM
            "Transactions" t
          JOIN
            "Entities" e ON t."fromEntityId" = e.id OR t."toEntityId" = e.id
          LEFT JOIN
            "Movements" m ON t.id = m."transactionId"
            WHERE
          ${Prisma.sql`
              (
                t."fromEntityId" IN (
                  SELECT id FROM "Entities" WHERE "tagName" = ANY(${Prisma.raw(
                    `ARRAY[${allTags.map((tag) => `'${tag}'`).join(",")}]`,
                  )})
                ) AND t."toEntityId" NOT IN (
                  SELECT id FROM "Entities" WHERE "tagName" = ANY(${Prisma.raw(
                    `ARRAY[${allTags.map((tag) => `'${tag}'`).join(",")}]`,
                  )})
                )
              ) OR (
                t."toEntityId" IN (
                  SELECT id FROM "Entities" WHERE "tagName" = ANY(${Prisma.raw(
                    `ARRAY[${allTags.map((tag) => `'${tag}'`).join(",")}]`,
                  )})
                ) AND t."fromEntityId" NOT IN (
                  SELECT id FROM "Entities" WHERE "tagName" = ANY(${Prisma.raw(
                    `ARRAY[${allTags.map((tag) => `'${tag}'`).join(",")}]`,
                  )})
                )
              )
              AND e."tagName" != ANY(${Prisma.raw(
                `ARRAY[${allTags.map((tag) => `'${tag}'`).join(",")}]`,
              )})
              AND m.account = ${input.accountType}
            `}
  
          GROUP BY
            t.currency, e.id, e."tagName", e.name, m.account
        `;

        return balances.filter(
          (balance) =>
            !allTags.includes(balance.entitytag) &&
            balance.status === input.accountType,
        )!;
      } else {
        return [];
      }
    }),
});
