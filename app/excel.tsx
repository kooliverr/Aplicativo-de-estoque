"use client";
import { useRef, useState } from "react";

type Row = {
  name: string;
  code: string;
  brand: string;
  category: string;
  unit: string;
  quantity: number;
  minimum: number;
};

const columns = [
  "Nome",
  "Código de referência",
  "Marca",
  "Categoria",
  "Unidade",
  "Quantidade",
  "Estoque mínimo",
];

const normalize = (s: string) =>
  s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

async function book() {
  const { Workbook } = await import("exceljs");
  return new Workbook();
}

export default function Excel({
  admin,
  reload,
}: {
  admin: boolean;
  reload: () => Promise<void>;
}) {
  const [rows, stage] = useState<Row[]>([]);
  const [note, say] = useState("");
  const [busy, wait] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function run(fn: () => Promise<void>) {
    wait(true);
    say("");
    try {
      await fn();
    } catch (e) {
      say(e instanceof Error ? e.message : "Operação indisponível.");
    } finally {
      wait(false);
    }
  }

  async function download(template: boolean) {
    const b = await book();
    const s = b.addWorksheet("Estoque");
    const headers = columns.concat("Situação");
    s.columns = headers.map((header, i) => ({
      header,
      width: [32, 24, 20, 24, 12, 16, 18, 18][i] || 20,
    }));
    s.getColumn(2).numFmt = "@";

    if (template) {
      // Exemplo ilustrativo de preenchimento para materiais elétricos
      s.addRow([
        "Cabo Flexível 2,5mm² 750V Azul",
        "CAB-25-AZ",
        "Sil",
        "Cabos & Fios",
        "m",
        100,
        20,
        "Exemplo",
      ]);
      s.addRow([
        "Disjuntor Bipolar Din 20A Curva C",
        "DISJ-20A-BIP",
        "Schneider",
        "Disjuntores & Proteção",
        "un",
        15,
        5,
        "Exemplo",
      ]);
      s.addRow([
        "Terminal Tubular Ilhós 2,5mm²",
        "TERM-ILH-25",
        "Intelli",
        "Conectores & Terminais",
        "un",
        500,
        100,
        "Exemplo",
      ]);
    } else {
      const r = await fetch("/api/products", { cache: "no-store" });
      if (!r.ok) throw Error("Faça login novamente para exportar.");
      const list = (await r.json()) as Row[];
      for (const p of list) {
        s.addRow([
          p.name,
          p.code,
          p.brand,
          p.category || "Outros",
          p.unit,
          p.quantity / 1000,
          p.minimum / 1000,
          p.quantity === 0
            ? "Esgotado"
            : p.quantity <= p.minimum
            ? "Baixo"
            : "Regular",
        ]);
      }
    }

    s.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    s.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF21513E" },
    };
    s.views = [{ state: "frozen", ySplit: 1 }];

    const buffer = await b.xlsx.writeBuffer();
    const blob = new Blob([buffer as ArrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = template ? "modelo-estoque-eletrica.xlsx" : "estoque-eletrica.xlsx";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function read(file: File) {
    stage([]);
    if (file.size > 5 * 1024 * 1024)
      throw Error("Use um arquivo .xlsx de até 5 MB.");
    const b = await book();
    await b.xlsx.load(await file.arrayBuffer());
    const s = b.getWorksheet("Estoque") ?? b.worksheets[0];
    if (!s || s.rowCount > 2001)
      throw Error("Use até 2.000 materiais por planilha.");

    const indexes: Record<string, number> = {};
    s.getRow(1).eachCell((v, i) => {
      const norm = normalize(v.text);
      for (const c of columns) {
        if (norm === normalize(c)) indexes[c] = i;
      }
    });

    const required = ["Nome", "Código de referência", "Marca", "Unidade", "Quantidade", "Estoque mínimo"];
    for (const c of required) {
      if (!indexes[c]) throw Error("Coluna obrigatória ausente na planilha: " + c);
    }

    const data: Row[] = [];
    const codes = new Set<string>();

    s.eachRow((r, i) => {
      if (i === 1) return;
      const name = r.getCell(indexes["Nome"]).text.trim();
      const code = r.getCell(indexes["Código de referência"]).text.trim();
      const brand = r.getCell(indexes["Marca"]).text.trim();
      const category = indexes["Categoria"] ? r.getCell(indexes["Categoria"]).text.trim() : "Outros";
      const unit = r.getCell(indexes["Unidade"]).text.trim();
      const q = r.getCell(indexes["Quantidade"]).text.trim();
      const m = r.getCell(indexes["Estoque mínimo"]).text.trim();

      if (!name && !code && !brand) return;

      if ([name, code, brand, unit, q, m].some((_, idx) => r.getCell(idx + 1).type === 6)) {
        throw Error("Linha " + i + ": substitua fórmulas pelos respectivos valores.");
      }

      const parse = (v: string) =>
        /^\d+(?:[.,]\d{1,3})?$/.test(v)
          ? Math.round(Number(v.replace(",", ".")) * 1000)
          : NaN;

      const quantity = parse(q);
      const minimum = parse(m);

      if (
        ![name, code, brand].every((v) => v.length && v.length <= 120) ||
        !["un", "m", "cx", "rl", "par"].includes(unit.toLowerCase()) ||
        ![quantity, minimum].every((v) => Number.isSafeInteger(v) && v <= 1e12)
      ) {
        throw Error(
          "Revise a linha " +
            i +
            ". Use unidade un, m, cx, rl ou par e quantidades numéricas válidas."
        );
      }

      if (codes.has(code.toUpperCase())) {
        throw Error("Referência repetida na linha " + i + ": " + code);
      }
      codes.add(code.toUpperCase());

      data.push({
        name,
        code,
        brand,
        category: category || "Outros",
        unit: unit.toLowerCase(),
        quantity,
        minimum,
      });
    });

    if (!data.length) throw Error("A planilha está vazia ou não contém materiais.");
    stage(data);
  }

  async function save() {
    const r = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rows),
    });
    const data = await r.json();
    if (!r.ok) throw Error(data.error);
    stage([]);
    say(data.count + " materiais cadastrados com sucesso.");
    await reload();
  }

  return (
    <section className="excel">
      <div>
        <b>Planilha Excel</b>
        <button disabled={busy} onClick={() => run(() => download(false))}>
          Exportar estoque
        </button>
        {admin && (
          <>
            <button disabled={busy} onClick={() => run(() => download(true))}>
              Baixar modelo (.xlsx)
            </button>
            <button disabled={busy} onClick={() => input.current?.click()}>
              Importar .xlsx
            </button>
            <input
              type="file"
              hidden
              accept=".xlsx"
              ref={input}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) run(() => read(file));
              }}
            />
          </>
        )}
      </div>
      {rows.length > 0 && (
        <p>
          {rows.length} materiais prontos para cadastrar. Primeiras referências:{" "}
          {rows.slice(0, 3).map((p) => p.code).join(", ")}.{" "}
          <button disabled={busy} onClick={() => run(save)}>
            Confirmar importação
          </button>{" "}
          <button disabled={busy} onClick={() => stage([])}>
            Cancelar
          </button>
        </p>
      )}
      {note && <p role="status">{note}</p>}
    </section>
  );
}
