"use client";

import { type ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
import moment from "moment";
import Link from "next/link";
import { type FC } from "react";
import { generateTableData } from "~/lib/functions";
import { cn } from "~/lib/utils";
import { currenciesOrder, dateFormatting, mvTypeFormatting } from "~/lib/variables";
import { useCuentasStore } from "~/stores/cuentasStore";
import { api } from "~/trpc/react";
import { type RouterInputs, type RouterOutputs } from "~/trpc/shared";
import { Icons } from "../components/ui/Icons";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { DataTable } from "./DataTable";
import LoadingAnimation from "../components/LoadingAnimation";

interface SummarizedBalancesProps {
  initialBalancesForCard: RouterOutputs["movements"]["getBalancesByEntitiesForCard"];
  initialBalancesInput: RouterInputs["movements"]["getBalancesByEntitiesForCard"];
  initialMovements: RouterOutputs["movements"]["getCurrentAccounts"];
  selectedTag: string | undefined;
  selectedEntityId: number | undefined;
  tags: RouterOutputs["tags"]["getAll"];
  uiColor: string | undefined
}

const SummarizedBalances: FC<SummarizedBalancesProps> = ({
  initialBalancesForCard,
  initialBalancesInput,
  initialMovements,
  selectedTag,
  selectedEntityId,
  tags,
  uiColor
}) => {
  const {
    selectedCurrency,
    setSelectedCurrency,
    isInverted,
    timeMachineDate,
  } = useCuentasStore();

  const dayInPast = moment(timeMachineDate).format(dateFormatting.day);

  initialBalancesInput.dayInPast = dayInPast

  const { data: balancesForCard, isFetching } = api.movements.getBalancesByEntitiesForCard.useQuery(initialBalancesInput, {
    initialData: initialBalancesForCard,
    refetchOnWindowFocus: false,
  })

  const queryInput: RouterInputs["movements"]["getCurrentAccounts"] = {
    currency: selectedCurrency,
    pageSize: 5,
    pageNumber: 1,
    entityTag: selectedTag,
    entityId: selectedEntityId,
  };

  queryInput.dayInPast = dayInPast;

  const { data: movements, isLoading } =
    api.movements.getCurrentAccounts.useQuery(queryInput, {
      initialData: initialMovements,
      refetchOnWindowFocus: false,
    });

  const tableData = generateTableData(
    movements.movements,
    selectedEntityId,
    selectedTag,
    tags,
  );

  const columns: ColumnDef<(typeof tableData)[number]>[] = [
    {
      accessorKey: "id",
      header: "ID",
    },
    {
      accessorKey: "selectedEntity",
      header: "Origen",
    },
    {
      accessorKey: "otherEntity",
      header: "Entidad",
    },
    {
      accessorKey: "otherEntityId",
      header: "Entidad ID",
      filterFn: "equals",
    },
    {
      accessorKey: "type",
      header: "Tipo",
      cell: ({ row }) => {
        const rowType = row.getValue("type")
        if (typeof rowType === "string") {
          return <p className="font-medium">{mvTypeFormatting.get(rowType)}</p>;
        }
      },
    },
    {
      accessorKey: "account",
      header: "Cuenta",
      cell: ({ row }) => {
        let cuenta = "";
        if (row.getValue("account") === true) {
          cuenta = "Caja";
        }
        if (row.getValue("account") === false) {
          cuenta = "Cuenta corriente";
        }
        return <p className="font-medium">{cuenta}</p>;
      },
    },
    {
      accessorKey: "currency",
      header: "Divisa",
      filterFn: "equals",
    },
    {
      accessorKey: "ingress",
      header: () => <div className="text-right">Entrada</div>,
      cell: ({ row }) => {
        const amount = parseFloat(row.getValue("ingress"));
        const formatted = new Intl.NumberFormat("es-AR").format(amount);
        return amount !== 0 ? (
          <div className="text-right font-medium">
            {" "}
            <span className="font-light text-muted-foreground">
              {tableData[row.index]!.currency.toUpperCase()}
            </span>{" "}
            {formatted}
          </div>
        ) : null;
      },
    },
    {
      accessorKey: "egress",
      header: () => <div className="text-right">Salida</div>,
      cell: ({ row }) => {
        const amount = parseFloat(row.getValue("egress"));
        const formatted = new Intl.NumberFormat("es-AR").format(amount);
        return amount !== 0 ? (
          <div className="text-right font-medium">
            {" "}
            <span className="font-light text-muted-foreground">
              {tableData[row.index]!.currency.toUpperCase()}
            </span>{" "}
            {formatted}
          </div>
        ) : null;
      },
    },
    {
      accessorKey: "balance",
      header: () => <div className="text-right">Saldo</div>,
      cell: ({ row }) => {
        const amount = parseFloat(row.getValue("balance"));
        const formatted = new Intl.NumberFormat("es-AR").format(amount);
        return (
          <div className="text-right font-medium">
            {" "}
            <span className="font-light text-muted-foreground">
              {tableData[row.index]!.currency.toUpperCase()}
            </span>{" "}
            {formatted}
          </div>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const movement = row.original;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Abrir menú</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Acciones</DropdownMenuLabel>
              <Link
                prefetch={false}
                href={`/operaciones/gestion/${movement.operationId}`}
              >
                <DropdownMenuItem>
                  <p>Ver operación</p>
                  <Icons.externalLink className="h-4 text-black" />
                </DropdownMenuItem>
              </Link>
              <Link href={{ pathname: "/cuentas", query: { entidad: movement.otherEntityId } }}>
                <DropdownMenuItem>
                  <p>Ver otra cuenta</p>
                  <Icons.currentAccount className="h-4" />
                </DropdownMenuItem>
              </Link>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const safeBalancesForCard = balancesForCard ?? []

  return (
    <div className="flex flex-col space-y-8">
      <div className="grid w-full grid-cols-2 gap-8 lg:grid-cols-3">
        {!isFetching ?
          safeBalancesForCard.sort(
            (a, b) =>
              currenciesOrder.indexOf(a.currency) -
              currenciesOrder.indexOf(b.currency),
          )
            .map((item) => (
              <Card
                key={item.currency}
                onClick={() => setSelectedCurrency(item.currency)}
                style={{ borderColor: item.currency === selectedCurrency ? uiColor : undefined }}
                className={cn(
                  "border-2 transition-all hover:scale-105 hover:cursor-pointer hover:shadow-md hover:shadow-primary",
                )}
              >
                <CardHeader>
                  <CardTitle>{item.currency.toUpperCase()}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col space-y-4">
                    {item.balances
                      .sort((a, b) =>
                        a.account === b.account ? 0 : a.account ? 1 : -1,
                      )
                      .map((balance) => (
                        <div
                          key={balance.amount}
                          className="flex flex-col space-y-2"
                        >
                          <p>{balance.account ? "Caja" : "Cuenta corriente"}</p>
                          <p className="text-xl font-semibold">
                            {new Intl.NumberFormat("es-AR").format(
                              balance.amount === 0 ? 0 : !isInverted ? balance.amount : -balance.amount,
                            )}
                          </p>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )) : (<LoadingAnimation text="Cargando balances" />)}
      </div>
      <div className="flex mx-auto">
        {selectedCurrency ? (
          <Card>
            <CardHeader>
              <CardTitle>Movimientos recientes</CardTitle>
              <CardDescription>
                {selectedCurrency.toUpperCase()}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p>Cargando...</p>
              ) : movements.totalRows > 0 ? (
                <DataTable
                  columns={columns}
                  data={tableData.map((row) => {
                    if (!isInverted) {
                      return row;
                    } else {
                      return {
                        ...row,
                        selectedEntity: row.otherEntity,
                        selectedEntityId: row.otherEntityId,
                        otherEntity: row.selectedEntity,
                        otherEntityId: row.otherEntityId,
                        ingress: row.egress,
                        egress: row.ingress,
                        balance: -row.balance,
                      };
                    }
                  })}
                />
              ) : (
                <p>Seleccioná una divisa</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Elegir divisa</CardTitle>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  );
};

export default SummarizedBalances;
